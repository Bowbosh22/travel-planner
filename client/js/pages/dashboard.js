import { openDialog } from '../components/dialog.js';
import { openShare } from '../components/share-dialog.js';
import { createLayoutEditor } from '../components/dash-layout.js';
import { api } from '../api.js';
import { summarize, tripTiming, CATEGORIES } from '../services/budget.js';
import { mountCharts } from '../components/budget-charts.js';
import { seriesColor } from '../components/charts.js';
import { announceBudget, budgetBanner } from '../components/budget-alert.js';
import { openImport } from '../components/import-flow.js';
import { toast } from '../components/toast.js';
import { loadLeaflet } from './carte.js';
import { bearing, distanceKm, flightMinutes, formatDuration, greatCircle } from '../lib/geo.js';
import { loadCountries, countryAt } from '../lib/countries.js';
import { addBasemap } from '../lib/basemap.js';
import { stopCardHtml } from './etapes.js';
import { html, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatEUR, formatMoney, formatPercent, formatRange, formatLongDate, daysBetween, plural, displayCurrencyName } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Dashboard';

const STATUS_LABELS = { preparation: 'Préparation', confirme: 'Confirmé', en_cours: 'En cours', termine: 'Terminé' };
const BOOKING_STATUS = { reserve: 'Réservé', a_reserver: 'À réserver' };
const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? '';
const WEATHER_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  partly: '<circle cx="8" cy="8" r="3"/><path d="M8 2v1M2 8h1M3.8 3.8l.7.7M12.2 3.8l-.7.7"/><path d="M8 19h9a4 4 0 100-8 5 5 0 00-9.6 1A3.5 3.5 0 008 19z"/>',
  cloud: '<path d="M7 19h10a4 4 0 100-8 5.5 5.5 0 00-10.6 1.3A3.4 3.4 0 007 19z"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
  rain: '<path d="M7 15h10a4 4 0 100-8 5.5 5.5 0 00-10.6 1.3A3.4 3.4 0 007 15z"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>',
  snow: '<path d="M7 14h10a4 4 0 100-8 5.5 5.5 0 00-10.6 1.3A3.4 3.4 0 007 14z"/><path d="M9 18h.01M13 20h.01M17 18h.01"/>',
  storm: '<path d="M7 14h10a4 4 0 100-8 5.5 5.5 0 00-10.6 1.3A3.4 3.4 0 007 14z"/><path d="M12 14l-2 4h3l-2 4"/>',
};
const weatherIcon = (kind) => `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WEATHER_ICONS[kind] ?? WEATHER_ICONS.cloud}</svg>`;
const creditText = (p) => (p.source === 'unsplash' ? `Photo : ${p.author} / Unsplash` : 'Photo : Wikipédia');
const todayLong = () => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

function pickTrip(trips, today) {
  const saved = trips.find((t) => t.id === getActiveTripId());
  if (saved) return saved;
  const upcoming = trips.filter((t) => t.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  return upcoming[0] ?? trips[0] ?? null;
}

// Anneau du budget : engagé (prévu) en clair, payé en foncé ; rouge si le budget est dépassé.
function ring(s) {
  const C = 2 * Math.PI * 52;
  const arc = (pct) => `${(Math.min(Math.max(pct, 0), 100) / 100) * C} ${C}`;
  const over = s.available < 0;
  return html`
    <svg class="ring" viewBox="0 0 140 140" role="img" aria-label="${formatPercent(s.engagedPct)} du budget engagé, dont ${formatPercent(s.paidPct)} déjà payé">
      <circle cx="70" cy="70" r="52" class="ring-track"/>
      <circle cx="70" cy="70" r="52" class="ring-engaged ${over ? 'over' : ''}" stroke-dasharray="${arc(s.engagedPct)}" transform="rotate(-90 70 70)"/>
      <circle cx="70" cy="70" r="52" class="ring-paid" stroke-dasharray="${arc(s.paidPct)}" transform="rotate(-90 70 70)"/>
      <text x="70" y="68" text-anchor="middle" class="ring-big">${formatPercent(s.engagedPct)}</text>
      <text x="70" y="88" text-anchor="middle" class="ring-small">engagé</text>
    </svg>`;
}

export async function mount(el, { user }) {
  const today = api.today();
  const trips = await api.listTrips();
  const trip = pickTrip(trips, today);

  if (!trip) {
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Bonjour, ${user.firstName}</h1><p>Aucun voyage pour le moment.</p></div></header>
      <div class="card empty"><h2>Créez votre premier voyage</h2><p>Renseignez une destination, des dates et un budget en euros pour commencer.</p><a class="btn btn-primary" href="#/voyages">Créer un voyage</a></div>`);
    return () => {};
  }

  const [bookings, stops, stays] = await Promise.all([api.listBookings(trip.id), api.listStops(trip.id).catch(() => []), api.listStays(trip.id).catch(() => [])]);
  const summary = summarize(trip, bookings);
  announceBudget(trip.id, summary);
  const timing = tripTiming(trip, today, daysBetween);
  const nextId = trips.filter((t) => t.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]?.id;
  const nights = daysBetween(trip.startDate, trip.endDate);
  const heroLabel = trip.id === nextId ? 'Prochain voyage' : STATUS_LABELS[trip.status] ?? 'Voyage';
  const hasData = summary.count > 0 && summary.forecast > 0;
  const live = bookings.filter((b) => b.status !== 'annule');
  const upcoming = [...live].sort((a, b) => (a.startsOn ?? '9999').localeCompare(b.startsOn ?? '9999')).slice(0, 3);
  const placed = live.filter((b) => b.geoDone && b.lat !== null);
  const photos = (trip.photos ?? []).filter((p) => p?.url && p?.link);
  const startAt = photos.length ? Math.floor(Math.random() * photos.length) : 0; // une photo différente à chaque visite
  let view = trip.origin ? 'route' : 'country'; // carte : trajet aérien ou pays
  const n = Number(trip.travelers) || 1;
  let names = [...(trip.companions ?? [])];
  let travelers = n;
  let adding = false;
  let expanded = false; // « +N » déplie tous les prénoms (pour pouvoir en retirer)
  let members = (trip.members ?? []).filter((m) => m.id !== user.id).map((m) => m.firstName); // comptes qui partagent le voyage
  const peopleMarkup = () => {
    const others = Math.max(travelers - 1 - names.length - members.length, 0); // personnes sans prénom renseigné
    const shown = expanded || names.length <= 2 ? names : names.slice(0, 1); // une seule ligne : 2 prénoms, ou 1 prénom + « +N »
    const extra = names.length - shown.length + others;
    return String(html`
      <span class="muted small-line">${names.length || others || members.length ? 'Voyage avec' : 'Voyage en solo'}</span>
      ${adding ? html`<form id="people-form" class="people-form"><label class="sr-only" for="people-input">Prénom</label><input id="people-input" class="input" maxlength="40" placeholder="Prénom" autocomplete="off" required><button class="btn btn-primary btn-sm" type="submit">OK</button></form>`
        : html`<div class="people-row">
            ${members.map((nm) => html`<span class="chip-person chip-account" title="${nm} partage ce voyage"><span class="cp-name">${nm}</span></span>`)}
            ${shown.map((nm, i) => html`<span class="chip-person" title="${nm}"><span class="cp-name">${nm}</span><button type="button" class="cp-x" data-people-remove="${i}" aria-label="Retirer ${nm}">×</button></span>`)}
            ${names.length > 2 ? html`<button type="button" class="chip-person chip-more" data-people-more title="${names.join(', ')}">${expanded ? 'Réduire' : `+${extra}`}</button>`
              : others > 0 ? html`<span class="chip-person chip-more" title="Personnes sans prénom">+${others}</span>` : ''}
            <button type="button" class="chip-add chip-share" data-people-share aria-label="Partager le voyage" title="Partager le voyage par lien">${icon('share', 13)}</button>
            <button type="button" class="chip-add" data-people-add aria-label="Ajouter une personne" title="Ajouter une personne">+</button>
          </div>`}`);
  };
  const countdown = timing.phase === 'upcoming' ? { big: timing.days, small: plural(timing.days, 'jour restant', 'jours restants') } : null;

  el.innerHTML = String(html`
    <header class="page-head">
      <div>
        <h1>Bonjour, ${user.firstName}</h1>
        <p>${trips.length} ${plural(trips.length, 'voyage organisé', 'voyages organisés')} · ${todayLong()}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-soft" href="/api/trips/${trip.id}/export.pdf" download title="Récapitulatif du voyage en PDF">Exporter en PDF</a>
        <label class="sr-only" for="trip-select">Voyage affiché</label>
        <select id="trip-select" class="select">
          ${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}
        </select>
        <button type="button" class="btn btn-soft" data-action="customize" title="Déplacer, redimensionner ou masquer les widgets">${icon('sliders', 16)}<span class="btn-label">Personnaliser</span></button>
        <button type="button" class="btn btn-primary" data-action="import">${icon('plus', 16)}Importer depuis un lien</button>
        <a class="avatar" href="#/parametres" aria-label="Paramètres du compte" title="${user.firstName}">${String(user.firstName).slice(0, 1).toUpperCase()}</a>
      </div>
    </header>

    ${budgetBanner(trip.id, summary)}

    <div class="dash-grid">
      <section class="hero hero-big ${photos.length ? 'has-photo' : ''}" data-w="hero" aria-label="Voyage affiché">
        ${photos.map((p, i) => html`<div class="hero-photo ${i === startAt ? 'on' : ''}" style="background-image:url('${p.url}')"></div>`)}
        ${photos.length ? html`<div class="hero-shade"></div>` : ''}
        <span class="hero-tag">${icon('pin', 14)} ${trip.destination}${trip.country ? html`, ${trip.country}` : ''}</span>
        ${countdown ? html`<div class="hero-count"><strong>${countdown.big}</strong><span>${countdown.small}</span></div>` : html`<div class="hero-count"><span>${timing.text}</span></div>`}
        <div class="hero-body">
          <div class="hero-label">${heroLabel}</div>
          <h2>${trip.destination}</h2>
          <p>${formatRange(trip.startDate, trip.endDate)} · ${nights} ${plural(nights, 'nuit', 'nuits')} · <span id="hero-travelers">${trip.travelers} ${plural(trip.travelers, 'voyageur', 'voyageurs')}</span></p>
          <div class="hero-chips">
            <a class="btn btn-hero" href="#/voyages">Ouvrir le voyage</a>
            <span class="hero-chip">${summary.count} ${plural(summary.count, 'réservation', 'réservations')}</span>
            <span class="hero-chip">Budget ${formatEUR(summary.budget)}</span>
            ${photos.length ? '' : html`<button type="button" class="hero-chip hero-chip-btn" data-action="find-image">Chercher une photo</button>`}
          </div>
          ${photos.length ? html`<a class="photo-credit" id="photo-credit" href="${photos[startAt].link}" target="_blank" rel="noopener noreferrer">${creditText(photos[startAt])}</a>` : ''}
        </div>
      </section>

      <section class="card mini mini-weather" data-w="weather" aria-label="Heure et météo à la destination">
            <div class="mini-clock"><strong id="dest-time">--:--</strong><span class="muted small-line">Heure à ${trip.destination.split(',')[0]}</span></div>
            <div class="mini-temp" id="dest-weather"><span class="muted small-line">Météo…</span></div>
          </section>
          <section class="card mini mini-people" id="people" data-w="people" aria-label="Voyageurs">${raw(peopleMarkup())}</section>
        <section class="card" data-w="budget" aria-label="Budget du voyage">
          <h3 class="card-head">Budget du voyage <span class="muted small-line">en ${displayCurrencyName()}</span></h3>
          <div class="budget-split">
            ${ring(summary)}
            <dl class="kv-list">
              <div><dt>Budget initial</dt><dd>${formatEUR(summary.budget)}</dd></div>
              <div><dt>Prévisionnel</dt><dd>${formatEUR(summary.forecast)}</dd></div>
              <div><dt>Payé</dt><dd>${formatEUR(summary.paid)}</dd></div>
              <div><dt>Reste à payer</dt><dd>${formatEUR(summary.toPay)}</dd></div>
              <div><dt>Disponible</dt><dd class="${summary.available < 0 ? 'danger-text' : ''}">${formatEUR(summary.available)}</dd></div>
            </dl>
          </div>
        </section>

        <section class="card map-mini" data-w="map" aria-label="Carte du voyage">
          <div class="card-head"><h3>Carte du voyage <button type="button" class="link-btn small-line" data-map-open>Agrandir</button></h3>
            <div class="seg" role="group" aria-label="Type de carte">
              <button type="button" data-map-view="route" aria-pressed="${view === 'route'}">Trajet aérien</button>
              <button type="button" data-map-view="country" aria-pressed="${view === 'country'}">Pays</button>
            </div>
          </div>
          <div id="dash-map" class="dash-map" role="img" aria-label="Carte du trajet et du pays de destination"></div>
          <p class="map-caption muted small-line" id="map-caption">Chargement de la carte…</p>
        </section>
      <section class="card dash-stops" data-w="stops" aria-label="Destinations du voyage">
        <h3 class="card-head">${icon('compass', 16)} Mini destinations <a class="small-link" href="#/etapes">${stops.length ? 'Tout voir' : 'Ajouter'}</a></h3>
        ${stops.length ? html`<div class="stop-grid">${stops.map((st) => stopCardHtml(st, bookings, stays, today))}</div>`
          : html`<p class="muted">Découpez le voyage en villes (ex. Kuala Lumpur, Penang…) : dates, budget et comparateur de logements pour chacune.</p>`}
      </section>
      ${hasData ? html`
        <section class="card" data-w="categories" aria-label="Dépenses par catégorie">
          <h3 class="card-head">Par catégorie <span class="muted small-line">prévu</span></h3>
          <div class="donut-row">
            <div class="chart-box h-donut">
              <canvas id="chart-donut" role="img" aria-label="Répartition des dépenses prévues par catégorie"></canvas>
              <div class="chart-center"><strong>${formatEUR(summary.forecast)}</strong><span>prévu</span></div>
            </div>
            <ul class="legend-list">
              ${summary.byCategory.map((c, i) => html`<li><span class="dot" style="background:${raw(seriesColor(i))}"></span><span class="label">${c.label}</span><span class="value">${formatEUR(c.forecast)}</span></li>`)}
            </ul>
          </div>
        </section>` : html`
        <section class="card empty" data-w="categories">
          <h3>Aucune dépense</h3><p>Ajoutez vos réservations : le budget se met à jour automatiquement.</p>
          <a class="btn btn-primary" href="#/reservations">Ajouter une réservation</a>
        </section>`}

      <section class="card" data-w="upcoming" aria-label="Prochaines réservations">
          <h3 class="card-head">Prochaines réservations <a class="small-link" href="#/reservations">Voir tout</a></h3>
          ${upcoming.length ? html`<ul class="mini-bookings">${upcoming.map((b) => html`
            <li>
              <div class="mb-main"><strong>${b.name}</strong>
                <span class="muted small-line">${[b.startsOn ? formatLongDate(b.startsOn) : catLabel(b.category), b.location].filter(Boolean).join(' · ')}</span></div>
              <div class="mb-amount">${b.amountEur === null ? '—' : formatMoney(b.amountEur)}</div>
              <span class="badge badge-b-${b.status}">${BOOKING_STATUS[b.status] ?? ''}</span>
            </li>`)}</ul>`
            : html`<p class="muted">Aucune réservation. <a class="small-link" href="#/reservations">Ajouter une réservation</a></p>`}
      </section>

      ${hasData ? html`
        <section class="card" data-w="paid" aria-label="Prévu et payé">
          <div class="card-head"><h3>Prévu et payé</h3>
            <div class="legend"><span><i class="dot" style="background:var(--s4)"></i>Prévu</span><span><i class="dot" style="background:var(--s1)"></i>Payé</span></div>
          </div>
          <div class="chart-box h-bars"><canvas id="chart-bars" role="img" aria-label="Comparaison du prévu et du payé par catégorie"></canvas></div>
        </section>` : ''}

    <section class="card" data-w="alerts" aria-label="À surveiller">
      <h2>À surveiller</h2>
      <ul class="alerts">
        ${summary.alerts.length
          ? summary.alerts.map((a) => html`<li class="alert alert-${a.level}"><span class="dot"></span><span><strong>${a.title}</strong> : ${a.text}</span></li>`)
          : html`<li class="alert alert-ok"><span class="dot"></span><span>Tout est en ordre pour ce voyage.</span></li>`}
      </ul>
    </section>
    </div>
  `);

  const refreshPeople = () => { const box = el.querySelector('#people'); if (box) box.innerHTML = peopleMarkup(); };
  async function savePeople(next) {
    try {
      const t = await api.setCompanions(trip.id, next);
      names = t.companions; travelers = t.travelers;
      const h = el.querySelector('#hero-travelers');
      if (h) h.textContent = `${travelers} ${plural(travelers, 'voyageur', 'voyageurs')}`;
    } catch (err) { toast(err.message || 'Enregistrement impossible.', 5000, 'warn'); }
    adding = false;
    refreshPeople();
  }
  const onSubmit = (e) => {
    if (e.target.id !== 'people-form') return;
    e.preventDefault();
    const v = e.target.querySelector('input').value.trim();
    if (v) savePeople([...names, v]); else { adding = false; refreshPeople(); }
  };
  const onKey = (e) => { if (e.key === 'Escape' && adding) { adding = false; refreshPeople(); } };
  el.addEventListener('submit', onSubmit);
  el.addEventListener('keydown', onKey);
  let redraw = () => {};
  const layoutEditor = createLayoutEditor(el, { onLayout: () => setTimeout(() => miniMap?.invalidateSize(), 60) }); // ordre, tailles et widgets masqués choisis par l'utilisateur
  const onClick = async (e) => {
    if (layoutEditor.onClick(e)) return;
    const so = e.target.closest('[data-open]');
    if (so) { try { sessionStorage.setItem('tp-open-stop', so.dataset.open); } catch { /* sans stockage : vue d'ensemble */ } location.hash = '#/etapes'; return; }
    if (e.target.closest('[data-people-share]')) {
      return openShare(trip, { user, onChange: (t) => { if (t) { trip.members = t.members; trip.inviteToken = t.inviteToken; members = t.members.filter((m) => m.id !== user.id).map((m) => m.firstName); refreshPeople(); } else { location.reload(); } } });
    }
    const addBtn = e.target.closest('[data-people-add]');
    if (addBtn) { adding = true; refreshPeople(); el.querySelector('#people-input')?.focus(); return; }
    if (e.target.closest('[data-people-more]')) { expanded = !expanded; refreshPeople(); return; }
    const rm = e.target.closest('[data-people-remove]');
    if (rm) { await savePeople(names.filter((_, i) => i !== Number(rm.dataset.peopleRemove))); return; }
    const mv = e.target.closest('[data-map-view]');
    if (mv) { view = mv.dataset.mapView; redraw(); return; }
    if (e.target.closest('#dash-map') || e.target.closest('[data-map-open]')) { openBig(); return; }
    if (e.target.closest('[data-action="import"]')) return openImport();
    const find = e.target.closest('[data-action="find-image"]');
    if (find) {
      find.disabled = true; find.textContent = 'Recherche…';
      try {
        const r = await api.refreshTripImage(trip.id);
        if (!r.found) toast(`Aucune photo trouvée sur Wikipédia pour « ${trip.destination} ». Essayez le nom de la ville seul (ex. Lisbonne).`, 7000, 'warn');
      } catch (err) {
        toast(`Recherche impossible : ${err.message || 'erreur du serveur'}.`, 7000, 'warn');
      }
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  };
  el.addEventListener('click', onClick);
  el.querySelector('#trip-select').addEventListener('change', (e) => {
    setActiveTripId(e.target.value);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  const unmountCharts = mountCharts(el, summary, trip, hasData);

  // Carte de l'accueil (lecture seule) : trajet aérien (arc de grand cercle) ou vue du pays.
  let miniMap = null;
  let openBig = () => {};
  let alive = true;
  const caption = (text) => { const c = el.querySelector('#map-caption'); if (c) c.textContent = text; };
  (async () => {
    let geo = trip.geo;
    if (!geo && !trip.geoDone) {
      try { geo = await api.geocodeTrip(trip.id); } catch { geo = null; }
    }
    const L = await loadLeaflet().catch(() => null);
    const box = el.querySelector('#dash-map');
    if (!alive || !box || !L) { if (alive) caption('Carte indisponible.'); return; }
    const countries = await loadCountries(); // contours pour surligner les pays en orange
    const makeMap = (box, { big = false, cap }) => {
      const miniMap = L.map(box, big ? { scrollWheelZoom: true, zoomSnap: 0.25 } : { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, attributionControl: true, zoomSnap: 0.25 });
      addBasemap(L, miniMap);
      const layer = L.layerGroup().addTo(miniMap);
      const ORANGE = { color: '#F0A25A', weight: 1.5, fillColor: '#F0A25A', fillOpacity: 0.45, interactive: false };
      const highlight = (pt) => {
        const f = countryAt(countries, pt);
        if (f) L.geoJSON(f, { style: ORANGE }).addTo(layer);
        else L.circle([pt.lat, pt.lng], { ...ORANGE, radius: 35000 }).addTo(layer); // petit pays / île : zone orange autour du lieu
      };
      const place = (pt, label, dir = 'top') => L.circleMarker([pt.lat, pt.lng], { radius: 6, weight: 2, color: '#fff', fillColor: '#F0A25A', fillOpacity: 1, interactive: false }).bindTooltip(label, { permanent: true, direction: dir, offset: dir === 'left' ? [-8, 0] : dir === 'right' ? [8, 0] : dir === 'top' ? [0, -6] : [0, 6], className: 'map-label' }).addTo(layer);
      const city = (t) => String(t).split(',')[0];

      const redraw = (view) => {
        if (!alive) return;
        layer.clearLayers();
        (big ? el.ownerDocument.querySelector('dialog') : el).querySelectorAll('[data-map-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mapView === view)));
        if (!geo?.dest) { miniMap.setView([20, 0], 1); cap('Destination introuvable sur la carte.'); return; }
        if (view === 'route') {
          if (!trip.origin) { place(geo.dest, city(trip.destination)); miniMap.setView([geo.dest.lat, geo.dest.lng], 5); cap('Ajoutez votre ville de départ dans « Mes voyages » pour voir le trajet.'); return; }
          if (!geo.origin) { place(geo.dest, city(trip.destination)); miniMap.setView([geo.dest.lat, geo.dest.lng], 5); cap(`Ville de départ « ${trip.origin} » introuvable.`); return; }
          highlight(geo.origin); highlight(geo.dest);
          const arc = greatCircle(geo.origin, geo.dest);
          L.polyline(arc, { color: '#F0A25A', weight: 3, dashArray: '8 7', interactive: false }).addTo(layer);
          const eastward = geo.dest.lng >= geo.origin.lng; // les étiquettes se placent côté extérieur, loin du tracé
          place(geo.origin, city(trip.origin), eastward ? 'left' : 'right');
          place(geo.dest, city(trip.destination), eastward ? 'right' : 'left');
          const mid = Math.floor(arc.length / 2);
          const rot = bearing(arc[mid - 1], arc[mid + 1]);
          L.marker(arc[mid], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'plane-ic', iconSize: [28, 28], iconAnchor: [14, 14], html: `<svg viewBox="0 0 24 24" width="28" height="28" style="transform:rotate(${rot}deg)" aria-hidden="true"><path fill="currentColor" d="M12 2c.8 0 1.5.9 1.5 2v5.5l7.5 4.5v2l-7.5-2.2V19l2 1.5V22l-3.5-1-3.5 1v-1.5l2-1.5v-5.2L3 16v-2l7.5-4.5V4c0-1.1.7-2 1.5-2z"/></svg>` }) }).addTo(layer);
          miniMap.fitBounds(L.latLngBounds(arc), { padding: [90, 50] });
          if (!big) miniMap.setZoom(Math.max(miniMap.getZoom() - 0.75, 0.5)); // plus de recul : on voit les pays autour
          const km = distanceKm(geo.origin, geo.dest);
          cap(`${city(trip.origin)} → ${city(trip.destination)} · ≈ ${Math.round(km).toLocaleString('fr-FR')} km · ≈ ${formatDuration(flightMinutes(km))} de vol`);
        } else {
          highlight(geo.dest);
          place(geo.dest, city(trip.destination));
          placed.forEach((b) => L.circleMarker([b.lat, b.lng], { radius: 4, weight: 1, color: '#fff', fillColor: '#9FD3C2', fillOpacity: 1, interactive: false }).addTo(layer));
          if (geo.box) miniMap.fitBounds([[geo.box[0], geo.box[1]], [geo.box[2], geo.box[3]]], { padding: [20, 20] });
          else miniMap.setView([geo.dest.lat, geo.dest.lng], 5);
          if (!big) miniMap.setZoom(Math.max(miniMap.getZoom() - 1.25, 0.5)); // dézoom : le pays dans son contexte
          cap(trip.country || city(trip.destination));
        }
      };

      return { map: miniMap, redraw };
    };
    const mini = makeMap(box, { cap: caption });
    miniMap = mini.map;
    redraw = () => mini.redraw(view);
    openBig = () => {
      let bigView = view; let inst = null;
      openDialog({ title: 'Carte du voyage', cancelLabel: 'Fermer', content: html`<div class="big-map-head"><div class="seg" role="group" aria-label="Type de carte"><button type="button" data-map-view="route" aria-pressed="${view === 'route'}">Trajet aérien</button><button type="button" data-map-view="country" aria-pressed="${view === 'country'}">Pays</button></div></div><div id="big-map" class="big-map"></div><p class="map-caption muted small-line" id="big-caption"></p>`,
        onMount: (dlg) => {
          dlg.classList.add('dialog-wide');
          inst = makeMap(dlg.querySelector('#big-map'), { big: true, cap: (t) => { const c = dlg.querySelector('#big-caption'); if (c) c.textContent = t; } });
          inst.map.invalidateSize(); inst.redraw(bigView);
          dlg.addEventListener('click', (e) => { const mv = e.target.closest('[data-map-view]'); if (mv) { bigView = mv.dataset.mapView; inst.redraw(bigView); } });
          dlg.addEventListener('close', () => inst.map.remove());
        } });
    };
    redraw();
  })();

  // Heure locale et météo de la destination (chargées après l'affichage ; discrètes si indisponibles).
  let clock = null;
  api.getWeather(trip.id).then((w) => {
    if (!alive) return;
    const box = el.querySelector('#dest-weather');
    const timeEl = el.querySelector('#dest-time');
    if (!w || !box || !timeEl) { if (box) box.innerHTML = '<span class="muted small-line">Météo indisponible</span>'; return; }
    box.innerHTML = String(html`<span class="wx-icon">${raw(weatherIcon(w.kind))}</span><span class="wx-text"><strong>${w.tempC}°C</strong><span class="muted small-line">${w.label}</span></span>`);
    const fmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: w.timezone });
    const tick = () => { timeEl.textContent = fmt.format(new Date()); };
    tick();
    clock = setInterval(tick, 30000);
  }).catch(() => {
    const box = el.querySelector('#dest-weather');
    if (box) box.innerHTML = '<span class="muted small-line">Météo indisponible</span>';
  });

  // Les photos défilent doucement (sauf si le système demande moins d'animations).
  let slideshow = null;
  const layers = [...el.querySelectorAll('.hero-photo')];
  if (layers.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let at = startAt;
    slideshow = setInterval(() => {
      layers[at].classList.remove('on');
      at = (at + 1) % layers.length;
      layers[at].classList.add('on');
      const credit = el.querySelector('#photo-credit');
      if (credit) { credit.href = photos[at].link; credit.textContent = creditText(photos[at]); }
    }, 9000);
  }

  return () => {
    alive = false;
    clearInterval(slideshow);
    clearInterval(clock);
    layoutEditor.destroy();
    el.removeEventListener('click', onClick);
    el.removeEventListener('submit', onSubmit);
    el.removeEventListener('keydown', onKey);
    unmountCharts();
    miniMap?.remove();
  };
}
