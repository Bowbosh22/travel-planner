import { api } from '../api.js';
import { summarize } from '../services/budget.js';
import { chartsMarkup, mountCharts } from '../components/budget-charts.js';
import { announceBudget, budgetBanner } from '../components/budget-alert.js';
import { openDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { html, raw } from '../lib/html.js';
import { formatEUR, formatPercent, daysBetween, plural, displayCurrencyName } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Budget';

export async function mount(el) {
  const trips = await api.listTrips();
  const trip = trips.find((t) => t.id === getActiveTripId()) ?? trips[0] ?? null;

  if (!trip) {
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Budget</h1></div></header>
      <section class="card empty"><h2>Aucun voyage</h2><p>Créez un voyage avec un budget pour suivre vos dépenses.</p><a class="btn btn-primary" href="#/voyages">Créer un voyage</a></section>`);
    return () => {};
  }

  const bookings = await api.listBookings(trip.id);
  const s = summarize(trip, bookings);
  announceBudget(trip.id, s);
  const nights = Math.max(daysBetween(trip.startDate, trip.endDate), 0);
  const travelers = Math.max(trip.travelers || 1, 1);
  const hasData = s.forecast > 0;
  const share = (v) => (s.forecast > 0 ? (v / s.forecast) * 100 : 0);

  el.innerHTML = String(html`
    <header class="page-head">
      <div><h1>Budget</h1><p>${trip.name} · affiché en ${displayCurrencyName()} (montants enregistrés en euros, taux figés à l'enregistrement).</p></div>
      <div class="page-actions">
        <label class="sr-only" for="trip-select">Voyage</label>
        <select id="trip-select" class="select">${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}</select>
        <a class="btn btn-soft" href="#/simulateur">Simuler un scénario</a>
      </div>
    </header>
    ${budgetBanner(trip.id, s)}
    <div class="stack">
      <section class="card" aria-label="Budget">
        <div class="metrics metrics-5">
          <div><div class="metric-label">Budget initial</div><div class="metric-value">${formatEUR(s.budget)}</div></div>
          <div><div class="metric-label">Prévisionnel</div><div class="metric-value">${formatEUR(s.forecast)}</div></div>
          <div><div class="metric-label">Payé</div><div class="metric-value">${formatEUR(s.paid)}</div></div>
          <div><div class="metric-label">Reste à payer</div><div class="metric-value">${formatEUR(s.toPay)}</div></div>
          <div><div class="metric-label">Disponible</div><div class="metric-value ${s.available < 0 ? 'danger' : 'accent'}">${formatEUR(s.available)}</div></div>
        </div>
        <div class="bar" role="img" aria-label="${formatPercent(s.engagedPct)} du budget engagé, dont ${formatPercent(s.paidPct)} déjà payé">
          <div class="bar-paid" style="width:${Math.min(s.paidPct, 100)}%"></div>
          <div class="bar-reserved" style="width:${Math.max(Math.min(s.reservedPct, 100 - s.paidPct), 0)}%"></div>
        </div>
        <div class="bar-caption">
          <span>${formatPercent(s.engagedPct)} du budget engagé, dont ${formatPercent(s.paidPct)} déjà payé</span>
          <span>Réservé (confirmé) : ${formatEUR(s.reserved)}</span>
        </div>
        <div class="budget-edit"><button type="button" class="btn btn-soft btn-sm" data-edit-budget>Modifier le budget</button></div>
      </section>

      <section class="card" aria-label="Répartition par catégorie">
        <h2 class="section-title in-card">Par catégorie</h2>
        ${hasData ? html`<ul class="cat-list">${s.byCategory.map((c) => html`
          <li>
            <div class="cat-top"><span class="cat-name">${c.label}</span><span class="cat-vals"><strong>${formatEUR(c.forecast)}</strong> prévus · ${formatEUR(c.paid)} payés · reste ${formatEUR(Math.max(c.forecast - c.paid, 0))}</span></div>
            <div class="mini-bar wide" role="img" aria-label="${formatPercent(share(c.forecast))} des dépenses prévues"><span style="width:${share(c.forecast)}%"></span></div>
            <div class="cat-share muted">${formatPercent(share(c.forecast))} des dépenses · ${formatPercent(s.budget > 0 ? (c.forecast / s.budget) * 100 : 0)} du budget</div>
          </li>`)}</ul>`
          : html`<p class="muted">Aucune dépense chiffrée pour ce voyage. <a href="#/reservations">Ajouter une réservation</a></p>`}
      </section>

      ${hasData ? html`<section class="card summary-strip three" aria-label="Repères">
        <div><div class="metric-label">Par voyageur (${travelers})</div><strong>${formatEUR(s.forecast / travelers)}</strong></div>
        <div><div class="metric-label">Par nuit (${nights} ${plural(nights, 'nuit', 'nuits')})</div><strong>${nights > 0 ? formatEUR(s.forecast / nights) : '—'}</strong></div>
        <div><div class="metric-label">Budget par voyageur</div><strong>${formatEUR(s.budget / travelers)}</strong></div>
      </section>` : ''}

      ${hasData ? chartsMarkup(s) : ''}

      <section class="card" aria-label="À surveiller">
        <h2>À surveiller</h2>
        <ul class="alerts">
          ${s.alerts.length
            ? s.alerts.map((a) => html`<li class="alert alert-${a.level}"><span class="dot"></span><span><strong>${a.title}</strong> : ${a.text}</span></li>`)
            : html`<li class="alert alert-ok"><span class="dot"></span><span>Tout est en ordre pour ce voyage.</span></li>`}
        </ul>
      </section>
    </div>`);

  const onClick = (e) => {
    if (!e.target.closest('[data-edit-budget]')) return;
    openDialog({
      title: 'Modifier le budget',
      content: html`<div class="field"><label for="bd-amount">Budget initial du voyage « ${trip.name} » (€)</label>
        <input class="input" id="bd-amount" name="budgetEur" inputmode="decimal" value="${trip.budgetEur ?? ''}" required autofocus></div>
        <p class="hint">Le budget est défini en euros pour tout le voyage. Les alertes et le disponible se recalculent aussitôt.</p>`,
      submitLabel: 'Enregistrer',
      onSubmit: async (v) => {
        await api.updateTrip(trip.id, { name: trip.name, destination: trip.destination, country: trip.country, origin: trip.origin, startDate: trip.startDate, endDate: trip.endDate, travelers: trip.travelers, planStatus: trip.planStatus, budgetEur: v.budgetEur });
        toast('Budget modifié.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      },
    });
  };
  el.addEventListener('click', onClick);
  const onChange = (e) => {
    if (e.target.id !== 'trip-select') return;
    setActiveTripId(e.target.value);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  el.addEventListener('change', onChange);
  const unmountCharts = mountCharts(el, s, trip, hasData);
  return () => { el.removeEventListener('change', onChange); el.removeEventListener('click', onClick); unmountCharts(); };
}
