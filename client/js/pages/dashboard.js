import { api } from '../api.js';
import { summarize, tripTiming, CATEGORIES } from '../services/budget.js';
import { mountCharts } from '../components/budget-charts.js';
import { seriesColor } from '../components/charts.js';
import { announceBudget, budgetBanner } from '../components/budget-alert.js';
import { openImport } from '../components/import-flow.js';
import { toast } from '../components/toast.js';
import { loadLeaflet } from './carte.js';
import { html, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatEUR, formatMoney, formatPercent, formatRange, formatLongDate, daysBetween, plural } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Dashboard';

const STATUS_LABELS = { preparation: 'Préparation', confirme: 'Confirmé', en_cours: 'En cours', termine: 'Terminé' };
const BOOKING_STATUS = { reserve: 'Réservé', a_reserver: 'À réserver' };
const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? '';
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

  const bookings = await api.listBookings(trip.id);
  const summary = summarize(trip, bookings);
  announceBudget(trip.id, summary);
  const timing = tripTiming(trip, today, daysBetween);
  const nextId = trips.filter((t) => t.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]?.id;
  const nights = daysBetween(trip.startDate, trip.endDate);
  const heroLabel = trip.id === nextId ? 'Prochain voyage' : STATUS_LABELS[trip.status] ?? 'Voyage';
  const hasData = summary.count > 0 && summary.forecast > 0;
  const live = bookings.filter((b) => b.status !== 'annule');
  const upcoming = [...live].sort((a, b) => (a.startsOn ?? '9999').localeCompare(b.startsOn ?? '9999')).slice(0, 4);
  const placed = live.filter((b) => b.geoDone && b.lat !== null);
  const photos = (trip.photos ?? []).filter((p) => p?.url && p?.link);
  const startAt = photos.length ? Math.floor(Math.random() * photos.length) : 0; // une photo différente à chaque visite
  const countdown = timing.phase === 'upcoming' ? { big: timing.days, small: plural(timing.days, 'jour restant', 'jours restants') } : null;

  el.innerHTML = String(html`
    <header class="page-head">
      <div>
        <h1>Bonjour, ${user.firstName}</h1>
        <p>${trips.length} ${plural(trips.length, 'voyage organisé', 'voyages organisés')} · ${todayLong()}</p>
      </div>
      <div class="page-actions">
        <label class="sr-only" for="trip-select">Voyage affiché</label>
        <select id="trip-select" class="select">
          ${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}
        </select>
        <button type="button" class="btn btn-primary" data-action="import">${icon('plus', 16)}Importer depuis un lien</button>
        <a class="avatar" href="#/parametres" aria-label="Paramètres du compte" title="${user.firstName}">${String(user.firstName).slice(0, 1).toUpperCase()}</a>
      </div>
    </header>

    ${budgetBanner(trip.id, summary)}

    <div class="dash-grid">
      <section class="hero hero-big ${photos.length ? 'has-photo' : ''}" aria-label="Voyage affiché">
        ${photos.map((p, i) => html`<div class="hero-photo ${i === startAt ? 'on' : ''}" style="background-image:url('${p.url}')"></div>`)}
        ${photos.length ? html`<div class="hero-shade"></div>` : ''}
        <span class="hero-tag">${icon('pin', 14)} ${trip.destination}${trip.country ? html`, ${trip.country}` : ''}</span>
        ${countdown ? html`<div class="hero-count"><strong>${countdown.big}</strong><span>${countdown.small}</span></div>` : html`<div class="hero-count"><span>${timing.text}</span></div>`}
        <div class="hero-body">
          <div class="hero-label">${heroLabel}</div>
          <h2>${trip.destination}</h2>
          <p>${formatRange(trip.startDate, trip.endDate)} · ${nights} ${plural(nights, 'nuit', 'nuits')} · ${trip.travelers} ${plural(trip.travelers, 'voyageur', 'voyageurs')}</p>
          <div class="hero-chips">
            <a class="btn btn-hero" href="#/voyages">Ouvrir le voyage</a>
            <span class="hero-chip">${summary.count} ${plural(summary.count, 'réservation', 'réservations')}</span>
            <span class="hero-chip">Budget ${formatEUR(summary.budget)}</span>
            ${photos.length ? '' : html`<button type="button" class="hero-chip hero-chip-btn" data-action="find-image">Chercher une photo</button>`}
          </div>
          ${photos.length ? html`<a class="photo-credit" id="photo-credit" href="${photos[startAt].link}" target="_blank" rel="noopener noreferrer">${creditText(photos[startAt])}</a>` : ''}
        </div>
      </section>

      <div class="dash-right">
        <section class="card" aria-label="Budget du voyage">
          <h3 class="card-head">Budget du voyage <span class="muted small-line">en euros</span></h3>
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

        <section class="card" aria-label="Prochaines réservations">
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
      </div>
    </div>

    <div class="dash-bottom">
      ${hasData ? html`
        <section class="card" aria-label="Dépenses par catégorie">
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
        <section class="card empty" style="grid-column: span 1">
          <h3>Aucune dépense</h3><p>Ajoutez vos réservations : le budget se met à jour automatiquement.</p>
          <a class="btn btn-primary" href="#/reservations">Ajouter une réservation</a>
        </section>`}

      <section class="card map-mini" aria-label="Carte du voyage">
        <h3 class="card-head">Carte du voyage <a class="small-link" href="#/carte">Ouvrir la carte</a></h3>
        ${placed.length ? html`<div id="dash-map" class="dash-map" role="img" aria-label="Aperçu de la carte : ${placed.length} ${plural(placed.length, 'lieu', 'lieux')}"></div>`
          : html`<div class="dash-map empty-map"><p class="muted">${live.some((b) => b.location) ? 'Ouvrez la carte pour localiser vos lieux.' : 'Ajoutez un lieu à vos réservations pour les voir ici.'}</p><a class="btn btn-soft btn-sm" href="#/carte">Ouvrir la carte</a></div>`}
      </section>

      ${hasData ? html`
        <section class="card" aria-label="Prévu et payé">
          <div class="card-head"><h3>Prévu et payé</h3>
            <div class="legend"><span><i class="dot" style="background:var(--s4)"></i>Prévu</span><span><i class="dot" style="background:var(--s1)"></i>Payé</span></div>
          </div>
          <div class="chart-box h-bars"><canvas id="chart-bars" role="img" aria-label="Comparaison du prévu et du payé par catégorie"></canvas></div>
        </section>` : ''}
    </div>

    <section class="card" aria-label="À surveiller" style="margin-top:20px">
      <h2>À surveiller</h2>
      <ul class="alerts">
        ${summary.alerts.length
          ? summary.alerts.map((a) => html`<li class="alert alert-${a.level}"><span class="dot"></span><span><strong>${a.title}</strong> : ${a.text}</span></li>`)
          : html`<li class="alert alert-ok"><span class="dot"></span><span>Tout est en ordre pour ce voyage.</span></li>`}
      </ul>
    </section>
  `);

  const onClick = async (e) => {
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

  // Aperçu de carte (lecture seule) : seulement les lieux déjà localisés.
  let miniMap = null;
  let alive = true;
  if (placed.length) {
    loadLeaflet().then((L) => {
      const box = el.querySelector('#dash-map');
      if (!alive || !box) return;
      miniMap = L.map(box, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(miniMap);
      const pts = placed.map((b) => [b.lat, b.lng]);
      pts.forEach((pt) => L.marker(pt, { interactive: false, keyboard: false }).addTo(miniMap));
      if (pts.length === 1) miniMap.setView(pts[0], 12); else miniMap.fitBounds(L.latLngBounds(pts).pad(0.25));
    }).catch(() => {});
  }

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
    el.removeEventListener('click', onClick);
    unmountCharts();
    miniMap?.remove();
  };
}
