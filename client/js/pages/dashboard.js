import { api } from '../api.js';
import { summarize, tripTiming } from '../services/budget.js';
import { createCharts, seriesColor } from '../components/charts.js';
import { toast } from '../components/toast.js';
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

export async function mount(el) {
  const today = api.today();
  const [user, trips] = await Promise.all([api.me(), api.listTrips()]);
  const trip = pickTrip(trips, today);

  if (!trip) {
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Bonjour, ${user.firstName}</h1><p>Aucun voyage pour le moment.</p></div></header>
      <div class="card empty"><h2>Créez votre premier voyage</h2><p>Renseignez une destination, des dates et un budget en euros pour commencer.</p></div>`);
    return () => {};
  }

  const bookings = await api.listBookings(trip.id);
  const summary = summarize(trip, bookings);
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
          <p>Importez un lien de réservation ou ajoutez vos dépenses : le budget et les graphiques se mettent à jour automatiquement.</p>
          <button type="button" class="btn btn-primary" data-action="import">${icon('plus', 16)}Importer depuis un lien</button>
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
    if (e.target.closest('[data-action="import"]')) toast("L'import par lien arrive à l'étape 4.");
  };
  el.addEventListener('click', onClick);
  el.querySelector('#trip-select').addEventListener('change', (e) => {
    setActiveTripId(e.target.value);
    window.dispatchEvent(new HashChangeEvent('hashchange')); // recharge la vue avec le nouveau voyage
  });

  // Graphiques (reconstruits si le thème change)
  let charts = null;
  const build = () => {
    charts?.destroy();
    if (!hasData) return;
    if (!window.Chart) {
      el.querySelectorAll('.chart-box').forEach((b) => { b.textContent = 'Graphique indisponible.'; });
      return;
    }
    charts = createCharts({
      donut: el.querySelector('#chart-donut'),
      bars: el.querySelector('#chart-bars'),
      line: el.querySelector('#chart-line'),
      gauge: el.querySelector('#chart-gauge'),
    }, summary, trip);
  };
  build();
  window.addEventListener('themechange', build);

  return () => {
    window.removeEventListener('themechange', build);
    el.removeEventListener('click', onClick);
    charts?.destroy();
  };
}

function chartsMarkup(s) {
  const timelineOk = s.timeline.length > 0;
  return html`
    <div class="grid-2">
      <section class="card" aria-label="Dépenses par catégorie">
        <h3 class="card-head">Dépenses par catégorie</h3>
        <div class="donut-row">
          <div class="chart-box h-donut">
            <canvas id="chart-donut" role="img" aria-label="Répartition des dépenses prévues par catégorie"></canvas>
            <div class="chart-center"><strong>${formatEUR(s.forecast)}</strong><span>prévu</span></div>
          </div>
          <ul class="legend-list">
            ${s.byCategory.map((c, i) => html`<li><span class="dot" style="background:${raw(seriesColor(i))}"></span><span class="label">${c.label}</span><span class="value">${formatEUR(c.forecast)}</span></li>`)}
          </ul>
        </div>
      </section>
      <section class="card" aria-label="Prévu et payé">
        <div class="card-head"><h3>Prévu et payé</h3>
          <div class="legend"><span><i class="dot" style="background:var(--s4)"></i>Prévu</span><span><i class="dot" style="background:var(--s1)"></i>Payé</span></div>
        </div>
        <div class="chart-box h-bars"><canvas id="chart-bars" role="img" aria-label="Comparaison du prévu et du payé par catégorie"></canvas></div>
      </section>
    </div>
    <div class="grid-2 flip">
      <section class="card" aria-label="Évolution des dépenses">
        <h3 class="card-head">Évolution des dépenses</h3>
        ${timelineOk
          ? html`<div class="chart-box h-line"><canvas id="chart-line" role="img" aria-label="Cumul des paiements dans le temps, avec projection jusqu'au total prévu"></canvas></div>`
          : html`<p class="muted">Aucun paiement enregistré pour le moment.</p>`}
      </section>
      <section class="card" aria-label="Budget restant">
        <h3 class="card-head">Budget restant</h3>
        <div class="chart-box h-gauge">
          <canvas id="chart-gauge" role="img" aria-label="Budget disponible : ${formatEUR(s.available)}"></canvas>
          <div class="chart-center gauge-center"><strong>${formatEUR(s.available)}</strong><span>${formatPercent(Math.max(100 - s.engagedPct, 0))} du budget initial</span></div>
        </div>
      </section>
    </div>`;
}
