// Signalement du dépassement de budget pendant la session : un bandeau durable (masquable) et un avertissement
// qui apparaît quand le dépassement est nouveau ou s'aggrave (ajout, modification, import, nouvel affichage).
import { budgetNotice } from '../services/budget.js';
import { html } from '../lib/html.js';
import { toast } from './toast.js';

const memory = new Map();
const read = (key) => {
  try { return Number(sessionStorage.getItem(key)) || 0; } catch { return memory.get(key) ?? 0; }
};
const write = (key, value) => {
  try { sessionStorage.setItem(key, String(value)); } catch { memory.set(key, value); }
};
const seenKey = (tripId) => `tp.overSeen.${tripId}`;
const hiddenKey = (tripId) => `tp.overHidden.${tripId}`;

// À appeler chaque fois qu'un résumé est (re)calculé pour un voyage.
export function announceBudget(tripId, summary) {
  const notice = budgetNotice(summary, read(seenKey(tripId)));
  write(seenKey(tripId), notice ? notice.overBy : 0);
  if (notice?.announce) toast(`Attention : ${notice.title.toLowerCase()}. Cliquez pour ajuster vos réservations.`, 9000, 'warn', '#/reservations');
}

// Bandeau en haut de page tant que le budget est dépassé ; masqué jusqu'à ce que le dépassement augmente.
export function budgetBanner(tripId, summary) {
  const notice = budgetNotice(summary);
  if (!notice || notice.overBy <= read(hiddenKey(tripId))) return '';
  return html`
    <div class="budget-banner" role="alert" data-budget-banner>
      <span class="bb-mark" aria-hidden="true">!</span>
      <a class="bb-text bb-link" href="#/reservations" title="Ouvrir les réservations pour corriger"><strong>${notice.title}</strong><span>${notice.text}</span></a>
      <a class="btn btn-soft btn-sm" href="#/simulateur">Simuler</a>
      <button type="button" class="bb-close" data-budget-hide="${tripId}" data-over="${notice.overBy}" aria-label="Masquer cet avertissement">×</button>
    </div>`;
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-budget-hide]');
    if (!btn) return;
    write(hiddenKey(btn.dataset.budgetHide), Number(btn.dataset.over) || 0);
    btn.closest('[data-budget-banner]')?.remove();
  });
}
