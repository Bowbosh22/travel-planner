// Import par lien en deux temps : 1) analyse de l'adresse, 2) vérification par l'utilisateur avant ajout.
// Les informations viennent d'un site tiers : tout est affiché échappé (html``), jamais interprété.
import { api } from '../api.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { amountFieldHtml, amountPayload, loadCurrencies, wireAmountField } from './amount-field.js';
import { CATEGORIES } from '../services/budget.js';
import { html, raw } from '../lib/html.js';
import { formatShortDate } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

const STATUS = { reserve: 'Réservé', a_reserver: 'À réserver' };

const urlStep = (value = '') => html`
  <div class="field">
    <label for="i-url">Lien de la réservation</label>
    <input class="input" id="i-url" name="url" type="url" inputmode="url" placeholder="https://..." autocomplete="off" value="${value}" required>
    <button type="button" class="btn btn-soft paste-btn" data-paste>Coller le lien copié</button>
    <small class="hint">Hôtel, restaurant, activité, vol... Nous lisons seulement les informations publiques de la page. Rien n'est inventé : vous vérifiez tout avant d'ajouter.</small>
  </div>`;

const tag = (found) => (found ? html`<span class="found">trouvé sur le site</span>` : '');

const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Mini destination proposée d'office : celle dont les dates contiennent le séjour, sinon celle citée dans le lieu ou le nom.
function guessStop(stops, fields) {
  const d = fields.startDate;
  if (d) { const hit = stops.filter((s) => s.startDate && s.endDate && d >= s.startDate && d <= s.endDate); if (hit.length === 1) return hit[0].id; }
  const text = norm(`${fields.location ?? ''} ${fields.name ?? ''}`);
  const hit = stops.filter((s) => s.name && text.includes(norm(s.name)));
  return hit.length === 1 ? hit[0].id : '';
}

// Choix de la mini destination : affiché seulement si le voyage en a (la liste suit le voyage choisi).
const stopFieldHtml = (stops, selected) => (stops.length ? html`
  <label for="i-stop">Mini destination ${selected ? html`<span class="found">proposée</span>` : ''}</label>
  <select class="select full" id="i-stop" name="stopId">
    <option value="">Aucune (voyage en général)</option>
    ${stops.map((s) => html`<option value="${s.id}" ${s.id === selected ? raw('selected') : ''}>${s.name}${s.startDate && s.endDate ? ` · ${formatShortDate(s.startDate)} – ${formatShortDate(s.endDate)}` : ''}</option>`)}
  </select>
  <small class="hint">Où ranger ce lien ? Il sera rattaché à cette mini destination.</small>` : '');

function reviewStep(result, trips, activeId, currencies, stops = []) {
  const f = result.fields;
  const src = result.sources;
  const pf = result.priceFound;
  const supported = pf?.currency && currencies.some((c) => c.code === pf.currency);
  // Prix trouvé dans une devise gérée : montant et devise préremplis (converti en euros à l'ajout, taux figé).
  const initial = supported ? { amount: pf.amount, currency: pf.currency } : { amount: '', currency: 'EUR' };
  const priceNote = !pf ? '' : supported ? '' : pf.currency
    ? `Prix trouvé : ${pf.amount} ${pf.currency}. Cette devise n'est pas gérée : saisissez le montant dans une devise proposée.`
    : `Prix trouvé : ${pf.amount}, sans devise indiquée. Choisissez la devise et vérifiez le montant.`;
  const prefilled = supported ? html`<span class="found">trouvé sur le site</span>` : '';
  return html`
    <input type="hidden" name="sourceUrl" value="${result.url}">
    <p class="import-summary">${result.found > 0
      ? html`<strong>${result.found} ${result.found > 1 ? 'informations trouvées' : 'information trouvée'}</strong> sur ${result.host}. Vérifiez et complétez.`
      : html`<strong>Aucune information exploitable</strong> sur ${result.host}. Complétez à la main : le lien sera conservé.`}</p>
    ${result.warnings.filter((w) => !w.startsWith('Aucune')).map((w) => html`<p class="import-note">${w}</p>`)}
    <div class="form-grid">
      <div class="field span-2"><label for="i-trip">Voyage</label>
        <select class="select full" id="i-trip" name="tripId">${trips.map((t) => html`<option value="${t.id}" ${t.id === activeId ? raw('selected') : ''}>${t.name}</option>`)}</select></div>
      <div class="field span-2" id="i-stop-wrap">${stopFieldHtml(stops, guessStop(stops, f))}</div>
      <div class="field span-2"><label for="i-name">Nom ${tag(src.name)}</label><input class="input" id="i-name" name="name" value="${f.name ?? ''}" maxlength="120" required></div>
      <div class="field"><label for="i-cat">Catégorie ${tag(f.category)}</label>
        <select class="select full" id="i-cat" name="category">
          ${f.category ? '' : html`<option value="" selected>Choisir...</option>`}
          ${CATEGORIES.map((c) => html`<option value="${c.id}" ${f.category === c.id ? raw('selected') : ''}>${c.label}</option>`)}
        </select></div>
      <div class="field"><label for="i-status">Statut</label>
        <select class="select full" id="i-status" name="status">${Object.entries(STATUS).map(([id, label]) => html`<option value="${id}" ${id === 'a_reserver' ? raw('selected') : ''}>${label}</option>`)}</select></div>
      ${amountFieldHtml(currencies, initial)}
      ${prefilled ? html`<p class="hint span-2">Prix ${prefilled}</p>` : ''}
      ${priceNote ? html`<p class="hint warn span-2">${priceNote}</p>` : ''}
      <div class="field span-2"><label for="i-loc">Lieu ${tag(f.location)}</label><input class="input" id="i-loc" name="location" value="${f.location ?? ''}" maxlength="200"></div>
      <div class="field"><label for="i-start">Du ${tag(f.startDate)}</label><input class="input" id="i-start" name="startsOn" type="date" value="${f.startDate ?? ''}"></div>
      <div class="field"><label for="i-end">Au ${tag(f.endDate)}</label><input class="input" id="i-end" name="endsOn" type="date" value="${f.endDate ?? ''}"></div>
    </div>`;
}

// Données lues par le favori sur la page de l'utilisateur → même écran de vérification que l'import par lien.
function captureResult(c) {
  const warnings = [];
  let priceFound = null;
  if (c.price?.kind === 'night') warnings.push(`Seul un prix par nuit a été lu (« ${c.price.label} »), pas le total : saisissez le total du séjour.`);
  else if (c.price) {
    priceFound = { amount: c.price.amount, currency: c.price.currency };
    if (c.price.label) warnings.push(`Lu sur la page : « ${c.price.label} ». Vérifiez le montant.`);
  }
  const dates = c.startDate && c.endDate;
  const found = [c.name, c.location, c.category, dates, priceFound].filter(Boolean).length;
  return {
    url: c.url, host: c.host || 'la page', found, priceFound, warnings,
    fields: { name: c.name || null, location: c.location || null, category: c.category || null, startDate: c.startDate || null, endDate: c.endDate || null },
    sources: { name: Boolean(c.name) },
  };
}

// Recharge la liste des mini destinations quand on change de voyage dans l'écran de vérification.
async function loadStops(tripId) {
  try { return await api.listStops(tripId); } catch { return []; }
}
function wireTrip(dlg, fields) {
  dlg.querySelector('#i-trip')?.addEventListener('change', async (e) => {
    const stops = await loadStops(e.target.value);
    const wrap = dlg.querySelector('#i-stop-wrap');
    if (wrap) wrap.innerHTML = String(stopFieldHtml(stops, guessStop(stops, fields)));
  });
}

// « Coller le lien copié » : lit le presse-papiers (sur un geste de l'utilisateur) et lance l'analyse.
function wirePaste(dlg) {
  dlg.querySelector('[data-paste]')?.addEventListener('click', async () => {
    try {
      const m = String(await navigator.clipboard.readText()).match(/https?:\/\/[^\s<>"']+/i);
      if (!m) return toast("Aucun lien trouvé dans ce que vous avez copié. Copiez d'abord le lien du logement.", 4500);
      dlg.querySelector('#i-url').value = m[0];
      dlg.querySelector('[type="submit"]')?.click();
    } catch { toast('Collez le lien dans le champ : appui long, puis « Coller ».', 4500); }
    return undefined;
  });
}

export async function openImport({ capture, sharedUrl } = {}) {
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
  const currencies = await loadCurrencies();
  const activeId = trips.some((t) => t.id === getActiveTripId()) ? getActiveTripId() : trips[0].id;
  let step = capture ? 'review' : 'url';
  const captured = capture ? captureResult(capture) : null;
  const capStops = capture ? await loadStops(activeId) : [];

  return openDialog({
    title: capture ? 'Vérifier avant d\'ajouter' : 'Importer depuis un lien',
    content: capture ? reviewStep(captured, trips, activeId, currencies, capStops) : urlStep(sharedUrl ?? ''),
    submitLabel: capture ? 'Ajouter au voyage' : 'Analyser le lien',
    onMount: capture ? (dlg) => { wireAmountField(dlg); wireTrip(dlg, captured.fields); dlg.querySelector('#i-name')?.focus(); }
      : sharedUrl ? (dlg) => { dlg.querySelector('[type="submit"]')?.click(); } // lien partagé : analyse lancée tout de suite
      : (dlg) => wirePaste(dlg),
    onSubmit: async (v, dlg) => {
      if (step === 'url') {
        const result = await api.importUrl(v.url); // les erreurs (captcha, adresse refusée...) s'affichent dans la boîte
        const stops = await loadStops(activeId);
        dlg.querySelector('.dialog-body').innerHTML = String(reviewStep(result, trips, activeId, currencies, stops));
        wireTrip(dlg, result.fields);
        dlg.querySelector('[type="submit"]').textContent = 'Ajouter au voyage';
        dlg.querySelector('.dialog-title').textContent = 'Vérifier avant d\'ajouter';
        wireAmountField(dlg);
        dlg.querySelector('#i-name')?.focus();
        step = 'review';
        return false;
      }
      const payload = {
        name: v.name, category: v.category, status: v.status,
        ...amountPayload(v),
        location: v.location, startsOn: v.startsOn, endsOn: v.endsOn, sourceUrl: v.sourceUrl,
        ...(v.stopId ? { stopId: v.stopId } : {}),
      };
      await api.createBooking(v.tripId, payload);
      setActiveTripId(v.tripId);
      toast(capture ? 'Réservation ajoutée depuis votre page.' : 'Réservation ajoutée depuis le lien.');
      if (location.hash === '#/reservations') window.dispatchEvent(new HashChangeEvent('hashchange'));
      else location.hash = '#/reservations';
      return undefined;
    },
  });
}
