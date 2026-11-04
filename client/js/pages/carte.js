// Carte : les lieux des réservations sur OpenStreetMap (Leaflet). Gratuit, sans compte.
// Les coordonnées sont calculées par le serveur (une seule fois par lieu, puis mémorisées).
import { api } from '../api.js';
import { CATEGORIES } from '../services/budget.js';
import { html, raw } from '../lib/html.js';
import { formatCurrency, formatLongDate } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Carte';

let leafletReady = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletReady ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = '/vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletReady = null; reject(new Error('Carte indisponible.')); };
    document.head.append(js);
  });
  return leafletReady;
}

const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? '';

export async function mount(el) {
  const trips = await api.listTrips();
  const trip = trips.find((t) => t.id === getActiveTripId()) ?? trips[0] ?? null;

  if (!trip) {
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Carte</h1></div></header>
      <section class="card empty"><h2>Aucun voyage</h2><p>Créez un voyage pour voir ses lieux sur la carte.</p><a class="btn btn-primary" href="#/voyages">Créer un voyage</a></section>`);
    return () => {};
  }

  const all = (await api.listBookings(trip.id)).filter((b) => b.status !== 'annule');
  const withPlace = all.filter((b) => b.location);
  const noPlace = all.filter((b) => !b.location);
  let alive = true;
  let map = null;
  const markers = new Map();

  el.innerHTML = String(html`
    <header class="page-head">
      <div><h1>Carte</h1><p>${trip.name} · lieux de vos réservations (OpenStreetMap).</p></div>
      <div class="page-actions">
        <label class="sr-only" for="trip-select">Voyage</label>
        <select id="trip-select" class="select">${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}</select>
      </div>
    </header>
    ${withPlace.length === 0 ? html`
      <section class="card empty"><h2>Aucun lieu renseigné</h2><p>Ajoutez un lieu (ville, adresse, nom d'hôtel) à vos réservations : elles apparaissent sur la carte.</p><a class="btn btn-primary" href="#/reservations">Voir les réservations</a></section>`
    : html`
      <div class="map-grid">
        <div class="card map-card"><div id="map" class="map" role="application" aria-label="Carte des lieux du voyage"></div><p id="map-status" class="muted small-line" aria-live="polite"></p></div>
        <section class="card" aria-label="Lieux">
          <h2 class="section-title in-card">Lieux</h2>
          <ul class="place-list" id="place-list">${withPlace.map((b) => html`
            <li data-id="${b.id}"><button type="button" class="place-btn" data-focus>
              <strong>${b.name}</strong><span class="muted small-line">${b.location}</span><span class="place-state muted small-line" data-state>${b.geoDone ? (b.lat === null ? 'Lieu introuvable : précisez-le dans la réservation.' : '') : 'Localisation en cours…'}</span>
            </button></li>`)}</ul>
          ${noPlace.length ? html`<h3 class="sim-sub">Sans lieu</h3><ul class="legend-list">${noPlace.map((b) => html`<li><span class="label">${b.name}</span></li>`)}</ul><p class="muted small-line">Ajoutez un lieu dans la réservation pour la voir sur la carte.</p>` : ''}
        </section>
      </div>`}`);

  const onChange = (e) => {
    if (e.target.id !== 'trip-select') return;
    setActiveTripId(e.target.value);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  el.addEventListener('change', onChange);
  const cleanup = () => { alive = false; el.removeEventListener('change', onChange); el.removeEventListener('click', onClick); map?.remove(); };

  const status = (msg) => { const s = el.querySelector('#map-status'); if (s) s.textContent = msg; };
  const stateOf = (id) => el.querySelector(`[data-id="${id}"] [data-state]`);

  const popup = (b) => {
    const box = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = b.name;
    const sub = document.createElement('div');
    sub.textContent = [catLabel(b.category), b.location].filter(Boolean).join(' · ');
    box.append(name, sub);
    if (b.startsOn) { const d = document.createElement('div'); d.textContent = b.endsOn && b.endsOn !== b.startsOn ? `${formatLongDate(b.startsOn)} → ${formatLongDate(b.endsOn)}` : formatLongDate(b.startsOn); box.append(d); }
    if (b.amount !== null) { const m = document.createElement('div'); m.textContent = formatCurrency(b.amount, b.currency); box.append(m); }
    return box;
  };

  const addMarker = (L, b, lat, lng) => {
    const m = L.marker([lat, lng], { title: b.name, alt: b.name }).addTo(map).bindPopup(popup(b));
    markers.set(b.id, m);
    stateOf(b.id).textContent = '';
  };
  const fit = (L) => {
    const pts = [...markers.values()].map((m) => m.getLatLng());
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2));
  };

  function onClick(e) {
    const li = e.target.closest('[data-focus]')?.closest('[data-id]');
    const m = li && markers.get(li.dataset.id);
    if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 14)); m.openPopup(); }
  }
  el.addEventListener('click', onClick);

  if (withPlace.length) {
    try {
      const L = await loadLeaflet();
      if (!alive) return cleanup;
      map = L.map(el.querySelector('#map'), { scrollWheelZoom: false }).setView([20, 0], 2);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(map);

      for (const b of withPlace) if (b.geoDone && b.lat !== null) addMarker(L, b, b.lat, b.lng);
      fit(L);

      // Lieux pas encore localisés : un par un (le serveur espace les appels d'une seconde, comme l'exige OpenStreetMap).
      const pending = withPlace.filter((b) => !b.geoDone);
      for (let i = 0; i < pending.length && alive; i++) {
        status(`Localisation des lieux… ${i + 1}/${pending.length}`);
        try {
          const r = await api.geocodeBooking(pending[i].id);
          if (!alive) break;
          if (r.found) { addMarker(L, pending[i], r.lat, r.lng); fit(L); }
          else stateOf(pending[i].id).textContent = 'Lieu introuvable : précisez-le dans la réservation.';
        } catch (err) {
          status(err.message);
          pending.slice(i).forEach((b) => { const s = stateOf(b.id); if (s) s.textContent = 'Non localisé pour le moment.'; });
          break;
        }
        if (i === pending.length - 1 && alive) status('');
      }
      if (alive && !pending.length) status(markers.size ? '' : 'Aucun lieu n\'a pu être localisé.');
    } catch (err) {
      status(err.message);
    }
  }
  return cleanup;
}
