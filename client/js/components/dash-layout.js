// Disposition personnalisable du tableau de bord : ordre, taille (S / M / L / pleine largeur) et widgets masqués.
// Tout se fait sur les éléments déjà affichés (aucun rechargement : la carte et les graphiques restent en place).
import { getLayout, savePrefs, WIDGET_LABELS, DEFAULT_LAYOUT } from '../prefs.js';
import { toast } from './toast.js';
import { html } from '../lib/html.js';

const SIZES = [['S', 'Petit'], ['M', 'Moyen'], ['L', 'Grand'], ['F', 'Pleine largeur']];
const SIZE_TEXT = { S: 'S', M: 'M', L: 'L', F: 'XL' };

export function applyLayout(grid, layout = getLayout()) {
  const hidden = new Set(layout.hidden);
  grid.querySelectorAll('[data-w]').forEach((w) => {
    const id = w.dataset.w;
    w.style.order = String(layout.order.indexOf(id));
    w.dataset.size = layout.sizes[id] ?? DEFAULT_LAYOUT.sizes[id] ?? 'S';
    w.hidden = hidden.has(id);
  });
}

export function createLayoutEditor(el, { onLayout } = {}) {
  const grid = el.querySelector('.dash-grid');
  let layout = getLayout();
  let editing = false;
  let timer = null;
  let bar = null;

  const present = () => new Set([...grid.querySelectorAll('[data-w]')].map((w) => w.dataset.w)); // widgets réellement affichés pour ce voyage
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => { if (!(await savePrefs({ layout }))) toast('Disposition enregistrée sur cet appareil seulement (connexion au serveur impossible).', 4000, 'warn'); }, 500);
  };
  const apply = () => { applyLayout(grid, layout); onLayout?.(); if (editing) draw(); };

  const move = (id, dir) => {
    const visible = layout.order.filter((x) => present().has(x) && !layout.hidden.includes(x));
    const i = visible.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= visible.length) return;
    const a = layout.order.indexOf(visible[i]); const b = layout.order.indexOf(visible[j]);
    [layout.order[a], layout.order[b]] = [layout.order[b], layout.order[a]];
    apply(); persist();
  };

  function draw() {
    grid.classList.toggle('editing', editing);
    grid.querySelectorAll('.w-tools').forEach((n) => n.remove());
    bar?.remove(); bar = null;
    if (!editing) return;
    grid.querySelectorAll('[data-w]').forEach((w) => {
      const id = w.dataset.w;
      const tools = document.createElement('div');
      tools.className = 'w-tools';
      tools.innerHTML = String(html`
        <span class="w-name">${WIDGET_LABELS[id]}</span>
        <button type="button" data-w-move="-1" aria-label="Déplacer avant" title="Déplacer avant">←</button>
        <button type="button" data-w-move="1" aria-label="Déplacer après" title="Déplacer après">→</button>
        <span class="w-sizes" role="group" aria-label="Taille">${SIZES.map(([k, label]) => html`<button type="button" data-w-size="${k}" aria-pressed="${(layout.sizes[id] ?? 'S') === k}" aria-label="${label}" title="${label}">${SIZE_TEXT[k]}</button>`)}</span>
        <button type="button" data-w-hide aria-label="Masquer" title="Masquer ce widget">Masquer</button>`);
      tools.dataset.for = id;
      w.prepend(tools);
    });
    const hiddenHere = layout.hidden.filter((id) => present().has(id));
    bar = document.createElement('div');
    bar.className = 'w-bar card';
    bar.innerHTML = String(html`
      <div><strong>Personnalisation du tableau de bord</strong>
        <p class="muted small-line">Utilisez ← → pour déplacer, S / M / L / XL pour la taille, « Masquer » pour retirer un widget.</p>
        ${hiddenHere.length ? html`<p class="w-hidden">Masqués : ${hiddenHere.map((id) => html`<button type="button" class="chip-add" data-w-show="${id}">+ ${WIDGET_LABELS[id]}</button>`)}</p>` : ''}</div>
      <div class="w-bar-actions"><button type="button" class="btn btn-soft btn-sm" data-w-reset>Disposition d'origine</button><button type="button" class="btn btn-primary btn-sm" data-w-done>Terminer</button></div>`);
    grid.before(bar);
  }

  const onClick = (e) => {
    const t = e.target.closest('[data-w-move],[data-w-size],[data-w-hide],[data-w-show],[data-w-reset],[data-w-done],[data-action="customize"]');
    if (!t) return false;
    const id = t.closest('.w-tools')?.dataset.for;
    if (t.matches('[data-action="customize"]')) { editing = !editing; draw(); if (editing) grid.scrollIntoView({ block: 'start', behavior: 'smooth' }); return true; }
    if (t.matches('[data-w-done]')) { editing = false; draw(); return true; }
    if (t.matches('[data-w-move]')) { move(id, Number(t.dataset.wMove)); return true; }
    if (t.matches('[data-w-size]')) { layout.sizes[id] = t.dataset.wSize; apply(); persist(); return true; }
    if (t.matches('[data-w-hide]')) { if (!layout.hidden.includes(id)) layout.hidden.push(id); apply(); persist(); return true; }
    if (t.matches('[data-w-show]')) { layout.hidden = layout.hidden.filter((x) => x !== t.dataset.wShow); apply(); persist(); return true; }
    if (t.matches('[data-w-reset]')) { layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT)); apply(); clearTimeout(timer); savePrefs({ layout: null }); toast('Disposition d\'origine rétablie.'); return true; }
    return false;
  };

  applyLayout(grid, layout);
  return { onClick, isEditing: () => editing, destroy: () => clearTimeout(timer) };
}
