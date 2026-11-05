// Étapes d'un voyage (ex. plusieurs villes en Malaisie) : un mini tableau de bord par destination
// (dates, nuits, décompte, budget, carte) et un comparateur de logements trié par prix.
import { api } from '../api.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { amountFieldHtml, amountPayload, loadCurrencies, wireAmountField } from '../components/amount-field.js';
import { toast } from '../components/toast.js';
import { summarize } from '../services/budget.js';
import { html, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { addBasemap } from '../lib/basemap.js';
import { formatMoney, formatRange, formatShortDate, formatLongDate, formatCurrency, daysBetween, plural } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';
import { loadLeaflet } from './carte.js';

export const title = 'Mini destinations';

const MAX_LINKS = 8;
const MY_CURRENCIES = new Set(['EUR', 'USD', 'XAF', 'XOF', 'MYR']);

const nightsOf = (s) => Math.max(daysBetween(s.startDate, s.endDate), 0);

function timing(s, today) {
  if (today < s.startDate) {
    const d = daysBetween(today, s.startDate);
    return { kind: 'avenir', label: d === 1 ? 'Demain' : `Dans ${d} jours` };
  }
  if (today > s.endDate) return { kind: 'termine', label: 'Terminée' };
  return { kind: 'en_cours', label: `En cours · jour ${daysBetween(s.startDate, today) + 1}/${daysBetween(s.startDate, s.endDate) + 1}` };
}

const stopBudget = (bookings, stopId) => {
  const mine = bookings.filter((b) => b.stopId === stopId && b.status !== 'annule');
  return { items: mine, total: mine.reduce((n, b) => n + (typeof b.amountEur === 'number' ? b.amountEur : 0), 0) };
};

// Prix croissant, sans prix à la fin (le serveur trie déjà ainsi ; on garde cet ordre après chaque modification locale).
const byPrice = (a, b) => (a.amountEur ?? Infinity) - (b.amountEur ?? Infinity);

// Carte-tableau de bord d'une destination (aussi utilisée sur l'accueil).
export function stopCardHtml(s, bookings, stays, today) {
  const t = timing(s, today);
  const n = nightsOf(s);
  const bud = stopBudget(bookings, s.id);
  const list = stays.filter((x) => x.stopId === s.id).sort(byPrice);
  const chosen = list.find((x) => x.chosen);
  const priced = list.filter((x) => x.amountEur !== null);
  let lodging;
  if (chosen) lodging = html`<strong>${chosen.name}</strong><span class="muted">Logement retenu${chosen.amountEur !== null ? ` · ${formatMoney(chosen.amountEur)}` : ''}</span>`;
  else if (list.length) lodging = html`<strong>${list.length} ${plural(list.length, 'logement', 'logements')} à comparer</strong><span class="muted">${priced.length ? `dès ${formatMoney(priced[0].amountEur)}` : 'prix à renseigner'}</span>`;
  else lodging = html`<strong>Aucun logement</strong><span class="muted">Ajoutez des liens à comparer</span>`;
  return html`
    <article class="card stop-card">
      <button type="button" class="stop-card-main" data-open="${s.id}" aria-label="Ouvrir la destination ${s.name}">
        <div class="stop-card-top"><h2>${s.name}</h2><span class="badge badge-stop-${t.kind}">${t.label}</span></div>
        <p class="muted">${formatRange(s.startDate, s.endDate)} · ${n} ${plural(n, 'nuit', 'nuits')}</p>
        <div class="stop-mini">
          <div><span class="metric-label">Budget</span><strong>${formatMoney(bud.total)}</strong><span class="muted">${bud.items.length} ${plural(bud.items.length, 'réservation', 'réservations')}</span></div>
          <div><span class="metric-label">Logement</span>${lodging}</div>
        </div>
      </button>
    </article>`;
}


const stopForm = (s = {}) => html`
  <div class="form-grid">
    <div class="field span-2"><label for="s-name">Ville ou lieu</label><input class="input" id="s-name" name="name" value="${s.name ?? ''}" maxlength="120" placeholder="Penang" required></div>
    <div class="field"><label for="s-start">Arrivée</label><input class="input" id="s-start" name="startDate" type="date" value="${s.startDate ?? ''}" required></div>
    <div class="field"><label for="s-end">Départ</label><input class="input" id="s-end" name="endDate" type="date" value="${s.endDate ?? ''}" required></div>
  </div>`;

const stayForm = (st = {}, currencies = []) => html`
  <div class="form-grid">
    <div class="field span-2"><label for="y-name">Nom du logement</label><input class="input" id="y-name" name="name" value="${st.name ?? ''}" maxlength="120" required></div>
    <div class="field span-2"><label for="y-url">Lien <span class="opt">(facultatif)</span></label><input class="input" id="y-url" name="url" type="url" value="${st.url ?? ''}" maxlength="500" placeholder="https://..."></div>
    ${amountFieldHtml(currencies, { amount: st.amount, currency: st.currency ?? 'EUR', editing: st.id ? st : null })}
    <p class="hint span-2">Indiquez le prix total du séjour pour les dates de la destination : le tableau calcule le prix par nuit.</p>
    <div class="field"><label for="y-rating">Note /10 <span class="opt">(facultatif)</span></label><input class="input" id="y-rating" name="rating" inputmode="decimal" value="${st.rating ?? ''}" placeholder="8,5"></div>
    <div class="field"><label for="y-loc">Quartier <span class="opt">(facultatif)</span></label><input class="input" id="y-loc" name="location" value="${st.location ?? ''}" maxlength="200"></div>
    <div class="field span-2"><label for="y-notes">Remarques <span class="opt">(facultatif)</span></label><input class="input" id="y-notes" name="notes" value="${st.notes ?? ''}" maxlength="500" placeholder="Petit-déjeuner inclus, annulation gratuite…"></div>
  </div>`;

export async function mount(el) {
  const today = api.today();
  const trips = await api.listTrips();
  let trip = trips.find((t) => t.id === getActiveTripId()) ?? trips[0] ?? null;
  let stops = [];
  let stays = [];
  let bookings = [];
  let openId = null; // destination affichée en détail
  try { openId = sessionStorage.getItem('tp-open-stop'); sessionStorage.removeItem('tp-open-stop'); } catch { /* sans stockage : vue d'ensemble */ }
  let map = null;
  let alive = true;
  let drawSeq = 0;

  if (!trip) {
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Mini destinations</h1></div></header>
      <section class="card empty"><h2>Aucun voyage</h2><p>Créez d'abord un voyage pour y ajouter des destinations.</p>
        <a class="btn btn-primary" href="#/voyages">Créer un voyage</a></section>`);
    return () => {};
  }

  const killMap = () => { if (map) { map.remove(); map = null; } };

  const staysOf = (id) => stays.filter((x) => x.stopId === id).sort(byPrice);

  // ---------- Carte (étapes ou détail d'une destination) ----------
  async function drawMap(points) {
    const seq = ++drawSeq;
    const box = el.querySelector('#stop-map');
    if (!box) return;
    if (!points.length) { box.innerHTML = '<div class="empty-map"><p class="muted">Les destinations apparaîtront ici une fois localisées.</p></div>'; return; }
    try {
      const L = await loadLeaflet();
      if (!alive || seq !== drawSeq || !box.isConnected) return;
      killMap();
      box.innerHTML = '';
      map = L.map(box, { scrollWheelZoom: false }).setView([points[0].lat, points[0].lng], 6);
      addBasemap(L, map, { switcher: true });
      const latlngs = [];
      for (const p of points) {
        L.marker([p.lat, p.lng], { title: p.label, alt: p.label }).bindPopup(`<strong>${html`${p.label}`}</strong>${p.sub ? `<br>${html`${p.sub}`}` : ''}`).addTo(map);
        latlngs.push([p.lat, p.lng]);
      }
      if (points[0].route && latlngs.length > 1) L.polyline(latlngs, { color: '#f97316', weight: 3, opacity: 0.8, dashArray: '6 8' }).addTo(map);
      if (latlngs.length === 1) map.setView(latlngs[0], 11);
      else map.fitBounds(L.latLngBounds(latlngs).pad(0.25));
    } catch { /* carte indisponible : le reste de la page fonctionne */ }
  }

  // Localise les destinations pas encore trouvées (une par une : le serveur espace les appels).
  async function locateStops(list) {
    for (const s of list.filter((x) => !x.geoDone)) {
      if (!alive) return;
      try {
        const u = await api.geocodeStop(s.id);
        stops = stops.map((x) => (x.id === u.id ? u : x));
      } catch { return; }
    }
  }

  const overviewPoints = () => stops.filter((s) => s.lat !== null).map((s) => ({ lat: s.lat, lng: s.lng, label: s.name, sub: formatRange(s.startDate, s.endDate), route: true }));

  // ---------- Vue d'ensemble : une carte-tableau de bord par destination ----------
  const stopCard = (s) => stopCardHtml(s, bookings, stays, today);

  function renderOverview() {
    const total = stops.reduce((n, s) => n + stopBudget(bookings, s.id).total, 0);
    const nights = stops.reduce((n, s) => n + nightsOf(s), 0);
    el.innerHTML = String(html`
      <header class="page-head">
        <div><h1>Mini destinations</h1><p>${stops.length ? `${stops.length} ${plural(stops.length, 'destination', 'destinations')} · ${nights} ${plural(nights, 'nuit', 'nuits')} · ${formatMoney(total)} de réservations rattachées` : 'Découpez le voyage en villes, chacune avec son budget et ses logements.'}</p></div>
        <div class="page-actions">
          <label class="sr-only" for="trip-select">Voyage</label>
          <select id="trip-select" class="select">${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}</select>
          <button type="button" class="btn btn-primary" data-act="new-stop">${icon('plus', 16)}Ajouter une destination</button>
        </div>
      </header>
      ${stops.length === 0 ? html`
        <section class="card empty"><h2>Aucune destination</h2><p>Ex. pour la Malaisie : Kuala Lumpur, Penang, Langkawi… Chaque destination a ses dates, son budget, sa carte et son comparateur de logements.</p>
          <button type="button" class="btn btn-primary" data-act="new-stop">${icon('plus', 16)}Ajouter la première destination</button></section>` : html`
        <section class="card stops-map-card" aria-label="Carte des destinations"><div id="stop-map" class="stop-map"></div></section>
        <div class="stop-grid">${stops.map(stopCard)}</div>`}`);
    killMap();
    if (stops.length) {
      drawMap(overviewPoints());
      const pending = stops.filter((s) => !s.geoDone);
      if (pending.length) locateStops(stops).then(() => { if (alive && !openId) drawMap(overviewPoints()); });
    }
  }

  // ---------- Détail d'une destination ----------
  function renderDetail() {
    const s = stops.find((x) => x.id === openId);
    if (!s) { openId = null; return renderOverview(); }
    const t = timing(s, today);
    const n = nightsOf(s);
    const bud = stopBudget(bookings, s.id);
    const list = staysOf(s.id);
    const cheapest = list.find((x) => x.amountEur !== null);
    const chosen = list.find((x) => x.chosen);
    const row = (x) => {
      const perNight = x.amountEur !== null && n > 0 ? x.amountEur / n : null;
      const foreign = x.currency !== 'EUR' && x.amount !== null;
      return html`
        <tr class="${x.chosen ? 'is-chosen' : ''}" data-stay="${x.id}">
          <td data-label="Logement">
            <div class="stay-name">${x.url ? html`<a href="${x.url}" target="_blank" rel="noopener noreferrer nofollow">${x.name}</a>` : x.name}
              ${x.chosen ? html`<span class="badge badge-ok">Retenu</span>` : ''}${!x.chosen && cheapest && x.id === cheapest.id && list.filter((y) => y.amountEur !== null).length > 1 ? html`<span class="badge">Le moins cher</span>` : ''}</div>
            ${x.location || x.notes ? html`<div class="muted stay-sub">${[x.location, x.notes].filter(Boolean).join(' · ')}</div>` : ''}
          </td>
          <td data-label="Prix" class="num">${x.amountEur === null ? html`<span class="muted">À renseigner</span>` : html`<strong>${formatMoney(x.amountEur)}</strong>${foreign ? html`<div class="muted stay-sub">${formatCurrency(x.amount, x.currency)}</div>` : ''}`}</td>
          <td data-label="Par nuit" class="num">${perNight === null ? '—' : formatMoney(perNight)}</td>
          <td data-label="Note" class="num">${x.rating === null ? '—' : `${String(x.rating).replace('.', ',')}/10`}</td>
          <td class="stay-actions">
            ${x.chosen
              ? html`<button type="button" class="btn btn-ghost btn-sm" data-unchoose="${x.id}">Retirer le choix</button>`
              : html`<button type="button" class="btn btn-soft btn-sm" data-choose="${x.id}">Retenir</button>`}
            <button type="button" class="btn btn-ghost btn-sm" data-edit-stay="${x.id}" aria-label="Modifier ${x.name}">Modifier</button>
            <button type="button" class="btn btn-ghost btn-sm danger-text" data-del-stay="${x.id}" aria-label="Supprimer ${x.name}">Supprimer</button>
          </td>
        </tr>`;
    };
    el.innerHTML = String(html`
      <header class="page-head">
        <div><button type="button" class="btn btn-ghost btn-sm back-btn" data-act="back">← Toutes les destinations</button>
          <h1>${s.name}</h1><p>${formatRange(s.startDate, s.endDate)}</p></div>
        <div class="page-actions">
          <button type="button" class="btn btn-soft" data-act="edit-stop">Modifier</button>
          <button type="button" class="btn btn-ghost danger-text" data-act="del-stop">Supprimer</button>
        </div>
      </header>
      <section class="card summary-strip stop-kpis" aria-label="Résumé de la destination">
        <div><div class="metric-label">Dates</div><strong>${formatShortDate(s.startDate)} → ${formatShortDate(s.endDate)}</strong></div>
        <div><div class="metric-label">Durée</div><strong>${n} ${plural(n, 'nuit', 'nuits')}</strong></div>
        <div><div class="metric-label">Décompte</div><strong>${t.label}</strong></div>
        <div><div class="metric-label">Budget de la destination</div><strong>${formatMoney(bud.total)}</strong></div>
      </section>
      <section class="card stop-budget" aria-label="Budget de la destination">
        <h2 class="section-title in-card">Budget de la destination</h2>
        ${(() => {
          const sm = summarize(trip, bud.items);
          const share = trip.budgetEur > 0 ? Math.round((sm.forecast / trip.budgetEur) * 100) : 0;
          return html`
            <div class="summary-strip three">
              <div><div class="metric-label">Prévu</div><strong>${formatMoney(sm.forecast)}</strong></div>
              <div><div class="metric-label">Payé</div><strong>${formatMoney(sm.paid)}</strong></div>
              <div><div class="metric-label">Reste à payer</div><strong>${formatMoney(sm.toPay)}</strong></div>
            </div>
            <p class="hint">${share} % du budget du voyage${n > 0 && sm.forecast > 0 ? ` · ${formatMoney(sm.forecast / n)} par nuit` : ''}</p>
            ${sm.byCategory.length ? html`<ul class="stop-cats">${sm.byCategory.map((c) => html`<li><span>${c.label}</span>
              <div class="bar"><div class="bar-paid" style="width:${sm.forecast ? (c.paid / sm.forecast) * 100 : 0}%"></div><div class="bar-reserved" style="width:${sm.forecast ? ((c.forecast - c.paid) / sm.forecast) * 100 : 0}%"></div></div>
              <strong>${formatMoney(c.forecast)}</strong></li>`)}</ul>` : html`<p class="muted">Aucune dépense rattachée pour l'instant.</p>`}`;
        })()}
      </section>
      <div class="stop-detail-grid">
        <section class="card"><h2 class="section-title in-card">Carte</h2><div id="stop-map" class="stop-map stop-map-sm"></div></section>
        <section class="card"><h2 class="section-title in-card">Réservations de la destination</h2>
          ${bud.items.length ? html`<ul class="stop-bookings">${bud.items.map((b) => html`<li><span>${b.name}</span><strong>${b.amountEur === null ? '—' : formatMoney(b.amountEur)}</strong>
              <button type="button" class="btn btn-ghost btn-sm" data-detach="${b.id}" aria-label="Détacher ${b.name} de la destination">Détacher</button></li>`)}</ul>`
            : html`<p class="muted">Aucune réservation rattachée. Choisissez la destination dans le formulaire d'une réservation, ou rattachez-en une ci-dessous.</p>`}
          ${bookings.filter((b) => !b.stopId && b.status !== 'annule').length ? html`
            <div class="attach-row"><label class="sr-only" for="attach-sel">Rattacher une réservation</label>
              <select id="attach-sel" class="select">${bookings.filter((b) => !b.stopId && b.status !== 'annule').map((b) => html`<option value="${b.id}">${b.name}</option>`)}</select>
              <button type="button" class="btn btn-soft btn-sm" data-attach>Rattacher</button></div>` : ''}
        </section>
      </div>
      <section class="card">
        <div class="card-head"><h2 class="section-title in-card">Comparateur de logements <span class="muted">· trié par prix</span></h2>
          <div class="page-actions">
            <button type="button" class="btn btn-soft" data-act="links">Ajouter des liens</button>
            <button type="button" class="btn btn-ghost" data-act="new-stay">Saisir à la main</button>
          </div></div>
        ${chosen ? html`<p class="hint">Logement retenu : <strong>${chosen.name}</strong> — une réservation « logement » a été créée dans Réservations.</p>` : ''}
        ${list.length ? html`<div class="table-wrap"><table class="stay-table">
          <thead><tr><th>Logement</th><th class="num">Prix</th><th class="num">Par nuit</th><th class="num">Note</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${list.map(row)}</tbody></table></div>`
          : html`<p class="muted">Collez plusieurs liens (Booking, Airbnb, Agoda…) : chaque lien devient une ligne du tableau, classée du moins cher au plus cher.</p>`}
      </section>`);
    killMap();
    const pts = [];
    if (s.lat !== null) pts.push({ lat: s.lat, lng: s.lng, label: s.name, sub: 'Étape' });
    drawMap(pts);
    if (!s.geoDone) {
      locateStops([s]).then(() => { if (alive && openId === s.id) drawMap(stops.filter((x) => x.id === s.id && x.lat !== null).map((x) => ({ lat: x.lat, lng: x.lng, label: x.name, sub: 'Étape' }))); });
    }
  }

  const render = () => (openId ? renderDetail() : renderOverview());

  const load = async () => {
    [stops, stays, bookings] = await Promise.all([api.listStops(trip.id), api.listStays(trip.id), api.listBookings(trip.id)]);
    render();
  };

  // ---------- Dialogues ----------
  const openStopDialog = (existing) => {
    const last = stops.at(-1);
    const seed = existing ?? { startDate: last?.endDate ?? trip.startDate, endDate: last?.endDate ?? trip.startDate };
    return openDialog({
      title: existing ? "Modifier la destination" : 'Nouvelle destination',
      content: stopForm(seed),
      submitLabel: existing ? 'Enregistrer' : 'Ajouter',
      onSubmit: async (v) => {
        const body = { name: v.name, startDate: v.startDate, endDate: v.endDate };
        if (existing) await api.updateStop(existing.id, body);
        else { const s = await api.createStop(trip.id, body); openId = s.id; }
        toast(existing ? 'Destination modifiée.' : 'Destination ajoutée.');
        await load();
      },
    });
  };

  const openStayDialog = async (existing) => openDialog({
    title: existing ? 'Modifier le logement' : 'Nouveau logement',
    content: stayForm(existing ?? {}, await loadCurrencies()),
    onMount: (dlg) => wireAmountField(dlg, { editing: existing ?? null }),
    submitLabel: existing ? 'Enregistrer' : 'Ajouter',
    onSubmit: async (v) => {
      const body = { name: v.name, url: v.url, ...amountPayload(v), rating: v.rating, location: v.location, notes: v.notes };
      if (existing) await api.updateStay(existing.id, body);
      else await api.createStay(openId, body);
      toast(existing ? 'Logement modifié.' : 'Logement ajouté.');
      await load();
    },
  });

  // Plusieurs liens d'un coup : chaque lien est analysé ; rien n'est inventé (un lien illisible garde seulement son nom de site).
  const openLinksDialog = () => openDialog({
    title: 'Ajouter des liens de logements',
    submitLabel: 'Importer les liens',
    content: html`
      <div class="field"><label for="l-urls">Un lien par ligne <span class="opt">(jusqu'à ${MAX_LINKS})</span></label>
        <textarea class="input" id="l-urls" name="urls" rows="6" placeholder="https://www.booking.com/hotel/…&#10;https://www.airbnb.fr/rooms/…" required></textarea></div>
      <p class="hint">Les informations lues sur chaque page (nom, lieu, prix) sont à vérifier : le prix affiché est celui de la page, pas forcément le total du séjour. Certains sites bloquent la lecture : le logement est alors ajouté sans prix, à compléter.</p>
      <div id="l-progress" class="muted" aria-live="polite"></div>`,
    onSubmit: async (v, dlg) => {
      const urls = [...new Set(String(v.urls).split(/\s+/).map((u) => u.trim()).filter(Boolean))];
      if (!urls.length) throw new Error('Collez au moins un lien.');
      if (urls.length > MAX_LINKS) throw new Error(`${MAX_LINKS} liens au maximum à la fois.`);
      for (const u of urls) { try { const p = new URL(u); if (!/^https?:$/.test(p.protocol)) throw new Error('x'); } catch { throw new Error(`Lien invalide : ${u}`); } }
      const prog = dlg.querySelector('#l-progress');
      const sid = openId;
      let ok = 0; let partial = 0; let failed = 0;
      for (let i = 0; i < urls.length; i++) {
        prog.textContent = `Analyse ${i + 1}/${urls.length}…`;
        let r = null;
        try { r = await api.importUrl(urls[i]); } catch { r = null; }
        const host = (() => { try { return new URL(urls[i]).hostname.replace(/^www\./, ''); } catch { return 'Logement'; } })();
        const body = { name: r?.fields?.name || host, url: urls[i] };
        if (r?.fields?.location) body.location = r.fields.location;
        const pf = r?.priceFound;
        if (pf && MY_CURRENCIES.has(pf.currency) && pf.amount > 0) { body.amount = pf.amount; body.currency = pf.currency; }
        else if (pf) body.notes = `Prix affiché sur la page : ${pf.amount}${pf.currency ? ` ${pf.currency}` : ''} (à convertir)`;
        try { await api.createStay(sid, body); } catch (err) { prog.textContent = err.message; throw err; }
        if (r && body.amount !== undefined) ok += 1; else if (r) partial += 1; else failed += 1;
      }
      toast(`${urls.length} ${plural(urls.length, 'lien ajouté', 'liens ajoutés')}${ok ? ` · ${ok} avec prix` : ''}${partial + failed ? ` · ${partial + failed} à compléter` : ''}.`);
      await load();
    },
  });

  // ---------- Événements ----------
  const guard = async (fn) => { try { await fn(); } catch (err) { toast(err.message); } };

  const onClick = (e) => {
    const t = e.target.closest('button, [data-open]');
    if (!t) return;
    const d = t.dataset;
    if (d.open) { openId = d.open; render(); window.scrollTo?.({ top: 0 }); return; }
    if (d.act === 'back') { openId = null; render(); return; }
    if (d.act === 'new-stop') { openStopDialog(null); return; }
    const s = stops.find((x) => x.id === openId);
    if (d.act === 'edit-stop' && s) { openStopDialog(s); return; }
    if (d.act === 'del-stop' && s) {
      confirmDialog({ title: 'Supprimer cette destination ?', text: `« ${s.name} » et ses logements comparés seront supprimés. Les réservations rattachées sont conservées (détachées de la destination).`, onConfirm: async () => { await api.deleteStop(s.id); openId = null; toast('Destination supprimée.'); await load(); } });
      return;
    }
    if (d.act === 'links') { openLinksDialog(); return; }
    if (d.act === 'new-stay') { guard(() => openStayDialog(null)); return; }
    if (d.editStay) { guard(() => openStayDialog(stays.find((x) => x.id === d.editStay))); return; }
    if (d.delStay) {
      const x = stays.find((y) => y.id === d.delStay);
      confirmDialog({ title: 'Supprimer ce logement ?', text: `« ${x.name} » sera retiré du comparateur.${x.chosen ? ' La réservation créée est conservée dans Réservations.' : ''}`, onConfirm: async () => { await api.deleteStay(x.id); toast('Logement supprimé.'); await load(); } });
      return;
    }
    if (d.choose) { guard(async () => { await api.chooseStay(d.choose); toast('Logement retenu : réservation ajoutée.'); await load(); }); return; }
    if (d.unchoose) { guard(async () => { await api.unchooseStay(d.unchoose); toast('Choix retiré.'); await load(); }); return; }
    if (d.detach) { guard(async () => { await api.setBookingStop(d.detach, null); await load(); }); return; }
    if (d.attach !== undefined) {
      const id = el.querySelector('#attach-sel')?.value;
      if (id) guard(async () => { await api.setBookingStop(id, openId); await load(); });
    }
  };

  const onChange = (e) => {
    if (e.target.id !== 'trip-select') return;
    trip = trips.find((x) => x.id === e.target.value);
    setActiveTripId(trip.id);
    openId = null;
    guard(load);
  };

  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  const cleanup = () => { alive = false; killMap(); el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); };

  await load();
  return cleanup;
}
