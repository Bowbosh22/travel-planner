import { api } from '../api.js';
import { buildPlanning, weekday } from '../services/planning.js';
import { CATEGORIES } from '../services/budget.js';
import { html, raw } from '../lib/html.js';
import { formatCurrency } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Planning';

const WEEK = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? '';
const dayTitle = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const monthTitle = (ym) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));

export async function mount(el) {
  const trips = await api.listTrips();
  const trip = trips.find((t) => t.id === getActiveTripId()) ?? trips[0] ?? null;

  if (!trip) {
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Planning</h1></div></header>
      <section class="card empty"><h2>Aucun voyage</h2><p>Créez un voyage pour voir son planning.</p><a class="btn btn-primary" href="#/voyages">Créer un voyage</a></section>`);
    return () => {};
  }

  const bookings = await api.listBookings(trip.id);
  const plan = buildPlanning(trip, bookings);
  let view = 'calendrier';

  const itemText = (it) => (it.kind === 'payment' ? `Paiement · ${it.booking.name}` : it.booking.name);

  const calendar = () => {
    const months = [...new Set(plan.days.map((d) => d.date.slice(0, 7)))];
    return html`${months.map((ym) => {
      const days = plan.days.filter((d) => d.date.startsWith(ym));
      const lead = (weekday(days[0].date) + 6) % 7; // semaine commençant le lundi
      return html`
        <section class="card cal" aria-label="${monthTitle(ym)}">
          <h3 class="card-head cal-title">${monthTitle(ym)}</h3>
          <div class="cal-grid" role="grid">
            ${WEEK.map((w) => html`<div class="cal-dow" role="columnheader">${w}</div>`)}
            ${Array.from({ length: lead }, () => html`<div class="cal-cell blank" aria-hidden="true"></div>`)}
            ${days.map((d) => html`
              <div class="cal-cell ${d.inTrip ? 'in-trip' : ''}" role="gridcell">
                <span class="cal-num">${Number(d.date.slice(8))}</span>
                ${d.items.slice(0, 3).map((it) => html`<span class="cal-chip ${it.kind === 'payment' ? 'pay' : ''}" title="${itemText(it)}">${itemText(it)}</span>`)}
                ${d.items.length > 3 ? html`<span class="cal-more">+${d.items.length - 3}</span>` : ''}
              </div>`)}
          </div>
        </section>`;
    })}`;
  };

  const daily = () => html`
    <div class="stack">
      ${plan.days.map((d) => html`
        <section class="card day ${d.inTrip ? '' : 'out'}" aria-label="${dayTitle(d.date)}">
          <h3 class="day-title">${dayTitle(d.date)}${d.inTrip ? '' : html` <span class="muted">· hors dates du voyage</span>`}</h3>
          ${d.items.length ? html`<ul class="day-items">${d.items.map((it) => it.kind === 'payment'
            ? html`<li class="pay"><span class="day-tag">Paiement</span><span><strong>${formatCurrency(it.payment.amount, it.booking.currency)}</strong> · ${it.booking.name}</span></li>`
            : html`<li><span class="day-tag">${catLabel(it.booking.category)}</span><span><strong>${it.booking.name}</strong>${it.booking.location ? html` · ${it.booking.location}` : ''}${it.edge === 'start' ? ' · début' : it.edge === 'end' ? ' · fin' : it.edge === 'middle' ? ' · en cours' : ''}</span></li>`)}</ul>`
            : html`<p class="muted small-line">Rien de prévu.</p>`}
        </section>`)}
    </div>`;

  const draw = () => {
    el.innerHTML = String(html`
      <header class="page-head">
        <div><h1>Planning</h1><p>${trip.name} · réservations datées et paiements, jour par jour.</p></div>
        <div class="page-actions">
          <label class="sr-only" for="trip-select">Voyage</label>
          <select id="trip-select" class="select">${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}</select>
          <div class="seg" role="group" aria-label="Affichage">
            <button type="button" class="chip-btn" data-view="calendrier" aria-pressed="${view === 'calendrier'}">Calendrier</button>
            <button type="button" class="chip-btn" data-view="jour" aria-pressed="${view === 'jour'}">Jour par jour</button>
          </div>
        </div>
      </header>
      <div class="stack">
        ${view === 'calendrier' ? calendar() : daily()}
        ${plan.undated.length ? html`<section class="card" aria-label="Sans date">
          <h2 class="section-title in-card">Sans date</h2>
          <p class="muted small-line">Ajoutez une date à ces réservations pour les voir dans le planning.</p>
          <ul class="day-items">${plan.undated.map((b) => html`<li><span class="day-tag">${catLabel(b.category)}</span><span><strong>${b.name}</strong></span></li>`)}</ul>
        </section>` : ''}
        ${bookings.length === 0 ? html`<section class="card empty"><h2>Aucune réservation</h2><p>Ajoutez des réservations avec leurs dates : elles apparaissent ici.</p><a class="btn btn-primary" href="#/reservations">Ajouter une réservation</a></section>` : ''}
      </div>`);
  };

  const onClick = (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    draw();
    el.querySelector(`[data-view="${view}"]`)?.focus();
  };
  const onChange = (e) => {
    if (e.target.id !== 'trip-select') return;
    setActiveTripId(e.target.value);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  draw();
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  return () => { el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); };
}
