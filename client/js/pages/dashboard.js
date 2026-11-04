import { api } from '../api.js';
import { summarize, tripTiming } from '../services/budget.js';
import { chartsMarkup, mountCharts } from '../components/budget-charts.js';
import { announceBudget, budgetBanner } from '../components/budget-alert.js';
import { openImport } from '../components/import-flow.js';
import { html, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatEUR, formatPercent, formatRange, daysBetween, plural } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Dashboard';

const STATUS_LABELS = { preparation: 'Préparation', confirme: 'Confirmé', en_cours: 'En cours', termine: 'Terminé' };

function pickTrip(trips, today) {
  const saved = trips.find((t) => t.id === getActiveTripId());
  if (saved) return saved;
  const upcoming = trips.filter((t) => t.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  return upcoming[0] ?? trips[0] ?? null;
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

  const heroLabel = `${trip.id === nextId ? 'Prochain voyage' : STATUS_LABELS[trip.status] ?? 'Voyage'} · ${timing.text}`;
  const hasData = summary.count > 0 && summary.forecast > 0;

  el.innerHTML = String(html`
    <header class="page-head">
      <div>
        <h1>Bonjour, ${user.firstName}</h1>
        <p>${trips.length} ${plural(trips.length, 'voyage organisé', 'voyages organisés')}</p>
      </div>
      <div class="page-actions">
        <label class="sr-only" for="trip-select">Voyage affiché</label>
        <select id="trip-select" class="select">
          ${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}
        </select>
        <button type="button" class="btn btn-primary" data-action="import">${icon('plus', 16)}Importer depuis un lien</button>
      </div>
    </header>

    ${budgetBanner(trip.id, summary)}
    <div class="stack">
      <section class="hero" aria-label="Voyage affiché">
        <div>
          <div class="hero-label">${heroLabel}</div>
          <h2>${trip.destination}, ${trip.country}</h2>
          <p>${formatRange(trip.startDate, trip.endDate)} · ${nights} ${plural(nights, 'nuit', 'nuits')} · ${trip.travelers} ${plural(trip.travelers, 'voyageur', 'voyageurs')}</p>
        </div>
        <a class="btn btn-hero" href="#/voyages">Ouvrir le voyage</a>
      </section>

      <section class="card" aria-label="Budget">
        <div class="metrics">
          <div><div class="metric-label">Prévisionnel</div><div class="metric-value">${formatEUR(summary.forecast)}</div></div>
          <div><div class="metric-label">Payé</div><div class="metric-value">${formatEUR(summary.paid)}</div></div>
          <div><div class="metric-label">Reste à payer</div><div class="metric-value">${formatEUR(summary.toPay)}</div></div>
          <div><div class="metric-label">Disponible</div><div class="metric-value ${summary.available < 0 ? 'danger' : 'accent'}">${formatEUR(summary.available)}</div></div>
        </div>
        <div class="bar" role="img" aria-label="${formatPercent(summary.engagedPct)} du budget engagé, dont ${formatPercent(summary.paidPct)} déjà payé">
          <div class="bar-paid" style="width:${Math.min(summary.paidPct, 100)}%"></div>
          <div class="bar-reserved" style="width:${Math.max(Math.min(summary.reservedPct, 100 - summary.paidPct), 0)}%"></div>
        </div>
        <div class="bar-caption">
          <span>${formatPercent(summary.engagedPct)} du budget engagé, dont ${formatPercent(summary.paidPct)} déjà payé</span>
          <span>Budget initial : ${formatEUR(summary.budget)}</span>
        </div>
      </section>

      ${hasData ? chartsMarkup(summary) : html`
        <section class="card empty">
          <h2>Aucune dépense pour ce voyage</h2>
          <p>Ajoutez vos réservations : le budget et les graphiques se mettent à jour automatiquement.</p>
          <a class="btn btn-primary" href="#/reservations">Ajouter une réservation</a>
        </section>`}

      <section class="card" aria-label="À surveiller">
        <h2>À surveiller</h2>
        <ul class="alerts">
          ${summary.alerts.length
            ? summary.alerts.map((a) => html`<li class="alert alert-${a.level}"><span class="dot"></span><span><strong>${a.title}</strong> : ${a.text}</span></li>`)
            : html`<li class="alert alert-ok"><span class="dot"></span><span>Tout est en ordre pour ce voyage.</span></li>`}
        </ul>
      </section>
    </div>
  `);

  // Actions
  const onClick = (e) => {
    if (e.target.closest('[data-action="import"]')) openImport();
  };
  el.addEventListener('click', onClick);
  el.querySelector('#trip-select').addEventListener('change', (e) => {
    setActiveTripId(e.target.value);
    window.dispatchEvent(new HashChangeEvent('hashchange')); // recharge la vue avec le nouveau voyage
  });

  const unmountCharts = mountCharts(el, summary, trip, hasData);

  return () => {
    el.removeEventListener('click', onClick);
    unmountCharts();
  };
}
