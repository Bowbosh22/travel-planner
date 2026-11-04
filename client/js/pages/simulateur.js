// Simulateur : essayer des scénarios (retirer, modifier, ajouter une dépense, changer le budget) sans RIEN enregistrer.
import { api } from '../api.js';
import { simulate } from '../services/simulation.js';
import { CATEGORIES } from '../services/budget.js';
import { html, raw } from '../lib/html.js';
import { formatEUR, formatPercent } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Simulateur';

const num = (v) => {
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return v !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatEUR(Math.abs(n))}`;

export async function mount(el) {
  const trips = await api.listTrips();
  const trip = trips.find((t) => t.id === getActiveTripId()) ?? trips[0] ?? null;

  if (!trip) {
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Simulateur</h1></div></header>
      <section class="card empty"><h2>Aucun voyage</h2><p>Créez un voyage pour simuler son budget.</p><a class="btn btn-primary" href="#/voyages">Créer un voyage</a></section>`);
    return () => {};
  }

  const all = await api.listBookings(trip.id);
  const bookings = all.filter((b) => b.status !== 'annule');
  let sc = { budgetEur: trip.budgetEur, excluded: new Set(), overrides: {}, extras: [], pct: 0 };
  let seq = 0;
  const cats = CATEGORIES.filter((c) => bookings.some((b) => b.category === c.id));

  const run = () => simulate(trip, bookings, { ...sc, excluded: [...sc.excluded] });

  const results = () => {
    const { real, sim, delta } = run();
    const over = sim.available < 0;
    return html`
      ${over
        ? html`<div class="budget-banner" role="alert"><span class="bb-mark" aria-hidden="true">!</span><div class="bb-text"><strong>Dans ce scénario, le budget est dépassé de ${formatEUR(-sim.available)}</strong><span>${formatEUR(sim.forecast)} prévus pour un budget de ${formatEUR(sim.budget)}.</span></div></div>`
        : html`<div class="sim-ok"><strong>Il resterait ${formatEUR(sim.available)}</strong> sur ${formatEUR(sim.budget)} (${formatPercent(sim.engagedPct)} du budget engagé).</div>`}
      <div class="sim-compare">
        <div></div><div class="metric-label">Réel</div><div class="metric-label">Scénario</div><div class="metric-label">Écart</div>
        <div>Budget</div><div>${formatEUR(real.budget)}</div><div>${formatEUR(sim.budget)}</div><div>${signed(sim.budget - real.budget)}</div>
        <div>Prévisionnel</div><div>${formatEUR(real.forecast)}</div><div><strong>${formatEUR(sim.forecast)}</strong></div><div>${signed(delta.forecast)}</div>
        <div>Reste à payer</div><div>${formatEUR(real.toPay)}</div><div>${formatEUR(sim.toPay)}</div><div>${signed(sim.toPay - real.toPay)}</div>
        <div>Disponible</div><div>${formatEUR(real.available)}</div><div class="${over ? 'danger-text' : ''}"><strong>${formatEUR(sim.available)}</strong></div><div>${signed(delta.available)}</div>
      </div>
      ${sim.byCategory.length ? html`<h3 class="sim-sub">Scénario par catégorie</h3><ul class="legend-list">${sim.byCategory.map((c) => html`<li><span class="label">${c.label}</span><span class="value">${formatEUR(c.forecast)}</span></li>`)}</ul>` : ''}`;
  };
  const drawResults = () => { el.querySelector('#sim-results').innerHTML = String(results()); };

  const lines = () => html`
    <ul class="sim-lines">
      ${bookings.map((b) => {
        const off = sc.excluded.has(b.id);
        const priced = typeof b.amountEur === 'number';
        return html`<li class="${off ? 'is-off' : ''}" data-id="${b.id}">
          <label class="check"><input type="checkbox" data-incl ${off ? '' : raw('checked')}> <span><strong>${b.name}</strong><small class="muted"> · ${CATEGORIES.find((c) => c.id === b.category)?.label ?? ''}</small></span></label>
          ${priced
            ? html`<span class="sim-amount"><input class="input" data-amount inputmode="decimal" aria-label="Montant en euros de ${b.name}" placeholder="${b.amountEur}" value="${sc.overrides[b.id] ?? ''}"> €</span>`
            : html`<span class="muted small">sans prix</span>`}
        </li>`;
      })}
      ${sc.extras.map((x) => html`<li data-extra="${x.id}"><span><strong>${x.name}</strong><small class="muted"> · ${CATEGORIES.find((c) => c.id === x.category)?.label} · ajouté pour la simulation</small></span><span>${formatEUR(x.amountEur)} <button type="button" class="btn btn-ghost btn-sm danger-text" data-extra-del>Retirer</button></span></li>`)}
    </ul>`;

  const draw = () => {
    el.innerHTML = String(html`
      <header class="page-head">
        <div><h1>Simulateur</h1><p>Testez un scénario : rien n'est enregistré, vos réservations ne changent pas.</p></div>
        <div class="page-actions">
          <label class="sr-only" for="trip-select">Voyage</label>
          <select id="trip-select" class="select">${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}</select>
          <button type="button" class="btn btn-soft" data-reset>Réinitialiser</button>
        </div>
      </header>
      <div class="sim-grid">
        <div class="stack">
          <section class="card" aria-label="Réglages globaux">
            <h2>Réglages</h2>
            <div class="form-grid" style="margin-top:14px">
              <div class="field"><label for="s-budget">Budget simulé (€)</label><input class="input" id="s-budget" inputmode="decimal" value="${sc.budgetEur}"></div>
              <div class="field"><label for="s-pct">Variation des montants : <output id="s-pct-out">${sc.pct > 0 ? '+' : ''}${sc.pct} %</output></label><input type="range" id="s-pct" min="-50" max="50" step="5" value="${sc.pct}"></div>
            </div>
            <p class="hint">La variation s'applique aux montants que vous ne saisissez pas vous-même. Les paiements déjà faits restent réels.</p>
            ${cats.length ? html`<div class="sim-chips" role="group" aria-label="Retirer une catégorie">
              ${cats.map((c) => {
                const items = bookings.filter((b) => b.category === c.id);
                const allOff = items.every((b) => sc.excluded.has(b.id));
                return html`<button type="button" class="chip-btn" data-cat="${c.id}" aria-pressed="${allOff}">${allOff ? 'Remettre' : 'Retirer'} : ${c.label}</button>`;
              })}</div>` : ''}
          </section>
          <section class="card" aria-label="Réservations du scénario">
            <h2>Réservations</h2>
            <p class="hint">Décochez pour retirer, ou saisissez un autre montant en euros.</p>
            <div id="sim-lines">${bookings.length || sc.extras.length ? lines() : html`<p class="muted">Aucune réservation pour ce voyage : ajoutez une dépense ci-dessous.</p>`}</div>
          </section>
          <section class="card" aria-label="Ajouter une dépense">
            <h2>Ajouter une dépense hypothétique</h2>
            <div class="form-grid" style="margin-top:14px">
              <div class="field span-2"><label for="x-name">Nom</label><input class="input" id="x-name" maxlength="80" placeholder="Excursion, souvenirs..."></div>
              <div class="field"><label for="x-cat">Catégorie</label><select class="select full" id="x-cat">${CATEGORIES.map((c) => html`<option value="${c.id}" ${c.id === 'activites' ? raw('selected') : ''}>${c.label}</option>`)}</select></div>
              <div class="field"><label for="x-amount">Montant (€)</label><input class="input" id="x-amount" inputmode="decimal"></div>
              <p class="form-error span-2" id="x-error" role="alert" hidden></p>
              <div class="field span-2"><button type="button" class="btn btn-primary" data-extra-add>Ajouter au scénario</button></div>
            </div>
          </section>
        </div>
        <aside class="card sim-results" aria-label="Résultat du scénario" aria-live="polite"><h2>Résultat</h2><div id="sim-results">${results()}</div></aside>
      </div>`);
  };

  const redrawLines = () => { el.querySelector('#sim-lines').innerHTML = String(bookings.length || sc.extras.length ? lines() : html`<p class="muted">Aucune réservation pour ce voyage : ajoutez une dépense ci-dessous.</p>`); };

  const onClick = (e) => {
    if (e.target.closest('[data-reset]')) {
      sc = { budgetEur: trip.budgetEur, excluded: new Set(), overrides: {}, extras: [], pct: 0 };
      return draw();
    }
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      const ids = bookings.filter((b) => b.category === cat.dataset.cat).map((b) => b.id);
      const allOff = ids.every((id) => sc.excluded.has(id));
      ids.forEach((id) => (allOff ? sc.excluded.delete(id) : sc.excluded.add(id)));
      return draw();
    }
    if (e.target.closest('[data-extra-del]')) {
      const id = e.target.closest('[data-extra]').dataset.extra;
      sc.extras = sc.extras.filter((x) => x.id !== id);
      redrawLines();
      return drawResults();
    }
    if (e.target.closest('[data-extra-add]')) {
      const name = el.querySelector('#x-name').value.trim();
      const amount = num(el.querySelector('#x-amount').value);
      const err = el.querySelector('#x-error');
      if (!name || amount === null || amount <= 0) { err.textContent = 'Indiquez un nom et un montant supérieur à 0.'; err.hidden = false; return undefined; }
      sc.extras.push({ id: `x${++seq}`, name: name.slice(0, 80), category: el.querySelector('#x-cat').value, amountEur: amount });
      return draw();
    }
    return undefined;
  };

  const onInput = (e) => {
    const t = e.target;
    if (t.id === 's-budget') { const n = num(t.value); sc.budgetEur = n === null ? trip.budgetEur : n; return drawResults(); }
    if (t.id === 's-pct') { sc.pct = Number(t.value); el.querySelector('#s-pct-out').textContent = `${sc.pct > 0 ? '+' : ''}${sc.pct} %`; return drawResults(); }
    if (t.matches?.('[data-amount]')) {
      const id = t.closest('[data-id]').dataset.id;
      const n = num(t.value);
      if (n === null) delete sc.overrides[id]; else sc.overrides[id] = n;
      return drawResults();
    }
    return undefined;
  };
  const onChange = (e) => {
    const t = e.target;
    if (t.id === 'trip-select') { setActiveTripId(t.value); return window.dispatchEvent(new HashChangeEvent('hashchange')); }
    if (t.matches?.('[data-incl]')) {
      const li = t.closest('[data-id]');
      if (t.checked) sc.excluded.delete(li.dataset.id); else sc.excluded.add(li.dataset.id);
      li.classList.toggle('is-off', !t.checked);
      return drawResults();
    }
    return undefined;
  };

  draw();
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  return () => { el.removeEventListener('click', onClick); el.removeEventListener('input', onInput); el.removeEventListener('change', onChange); };
}
