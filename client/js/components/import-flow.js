// Import par lien en deux temps : 1) analyse de l'adresse, 2) vérification par l'utilisateur avant ajout.
// Les informations viennent d'un site tiers : tout est affiché échappé (html``), jamais interprété.
import { api } from '../api.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { CATEGORIES } from '../services/budget.js';
import { html, raw } from '../lib/html.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

const STATUS = { reserve: 'Réservé', a_reserver: 'À réserver' };

const urlStep = html`
  <div class="field">
    <label for="i-url">Lien de la réservation</label>
    <input class="input" id="i-url" name="url" type="url" inputmode="url" placeholder="https://..." autocomplete="off" required>
    <small class="hint">Hôtel, restaurant, activité, vol... Nous lisons seulement les informations publiques de la page. Rien n'est inventé : vous vérifiez tout avant d'ajouter.</small>
  </div>`;

const tag = (found) => (found ? html`<span class="found">trouvé sur le site</span>` : '');

function reviewStep(result, trips, activeId) {
  const f = result.fields;
  const src = result.sources;
  const other = result.priceFound && result.amountEur === null ? result.priceFound : null;
  return html`
    <input type="hidden" name="sourceUrl" value="${result.url}">
    <p class="import-summary">${result.found > 0
      ? html`<strong>${result.found} ${result.found > 1 ? 'informations trouvées' : 'information trouvée'}</strong> sur ${result.host}. Vérifiez et complétez.`
      : html`<strong>Aucune information exploitable</strong> sur ${result.host}. Complétez à la main : le lien sera conservé.`}</p>
    ${result.warnings.filter((w) => !w.startsWith('Aucune')).map((w) => html`<p class="import-note">${w}</p>`)}
    <div class="form-grid">
      <div class="field span-2"><label for="i-trip">Voyage</label>
        <select class="select full" id="i-trip" name="tripId">${trips.map((t) => html`<option value="${t.id}" ${t.id === activeId ? raw('selected') : ''}>${t.name}</option>`)}</select></div>
      <div class="field span-2"><label for="i-name">Nom ${tag(src.name)}</label><input class="input" id="i-name" name="name" value="${f.name ?? ''}" maxlength="120" required></div>
      <div class="field"><label for="i-cat">Catégorie ${tag(f.category)}</label>
        <select class="select full" id="i-cat" name="category">
          ${f.category ? '' : html`<option value="" selected>Choisir...</option>`}
          ${CATEGORIES.map((c) => html`<option value="${c.id}" ${f.category === c.id ? raw('selected') : ''}>${c.label}</option>`)}
        </select></div>
      <div class="field"><label for="i-status">Statut</label>
        <select class="select full" id="i-status" name="status">${Object.entries(STATUS).map(([id, label]) => html`<option value="${id}" ${id === 'a_reserver' ? raw('selected') : ''}>${label}</option>`)}</select></div>
      <div class="field span-2"><label for="i-amount">Montant en euros ${tag(result.amountEur !== null)}</label>
        <input class="input" id="i-amount" name="amountEur" inputmode="decimal" value="${result.amountEur ?? ''}" placeholder="Laissez vide si inconnu">
        ${other ? html`<small class="hint warn">Prix trouvé : ${other.amount} ${other.currency ?? '(devise non indiquée)'}. Saisissez le montant en euros ; la conversion automatique arrive à l'étape 5.</small>` : ''}</div>
      <div class="field span-2"><label for="i-loc">Lieu ${tag(f.location)}</label><input class="input" id="i-loc" name="location" value="${f.location ?? ''}" maxlength="200"></div>
      <div class="field"><label for="i-start">Du ${tag(f.startDate)}</label><input class="input" id="i-start" name="startsOn" type="date" value="${f.startDate ?? ''}"></div>
      <div class="field"><label for="i-end">Au ${tag(f.endDate)}</label><input class="input" id="i-end" name="endsOn" type="date" value="${f.endDate ?? ''}"></div>
    </div>`;
}

export async function openImport() {
  let trips = [];
  try {
    trips = await api.listTrips();
  } catch (err) {
    return toast(err.message);
  }
  if (trips.length === 0) {
    toast("Créez d'abord un voyage pour y ajouter des réservations.");
    location.hash = '#/voyages';
    return undefined;
  }
  const activeId = trips.some((t) => t.id === getActiveTripId()) ? getActiveTripId() : trips[0].id;
  let step = 'url';

  return openDialog({
    title: 'Importer depuis un lien',
    content: urlStep,
    submitLabel: 'Analyser le lien',
    onSubmit: async (v, dlg) => {
      if (step === 'url') {
        const result = await api.importUrl(v.url); // les erreurs (captcha, adresse refusée...) s'affichent dans la boîte
        dlg.querySelector('.dialog-body').innerHTML = String(reviewStep(result, trips, activeId));
        dlg.querySelector('[type="submit"]').textContent = 'Ajouter au voyage';
        dlg.querySelector('.dialog-title').textContent = 'Vérifier avant d\'ajouter';
        dlg.querySelector('#i-name')?.focus();
        step = 'review';
        return false;
      }
      const payload = {
        name: v.name, category: v.category, status: v.status,
        amountEur: v.amountEur?.trim() === '' ? null : v.amountEur,
        location: v.location, startsOn: v.startsOn, endsOn: v.endsOn, sourceUrl: v.sourceUrl,
      };
      await api.createBooking(v.tripId, payload);
      setActiveTripId(v.tripId);
      toast('Réservation ajoutée depuis le lien.');
      if (location.hash === '#/reservations') window.dispatchEvent(new HashChangeEvent('hashchange'));
      else location.hash = '#/reservations';
      return undefined;
    },
  });
}
