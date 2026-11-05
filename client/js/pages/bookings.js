import { api } from '../api.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { openImport } from '../components/import-flow.js';
import { amountFieldHtml, amountPayload, loadCurrencies, wireAmountField } from '../components/amount-field.js';
import { toast } from '../components/toast.js';
import { announceBudget, budgetBanner } from '../components/budget-alert.js';
import { CATEGORIES, summarize } from '../services/budget.js';
import { html, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatMoney, formatLongDate, formatShortDate, formatEUR, formatPercent, formatCurrency, formatRate } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Réservations';

const STATUS = { reserve: 'Réservé', a_reserver: 'À réserver', annule: 'Annulé' };
const paidOrig = (b) => b.payments.reduce((s, p) => s + p.amount, 0); // dans la devise de la réservation
const round2 = (n) => Math.round(n * 100) / 100;

const bookingForm = (b = {}, currencies = [], stops = []) => html`
  <div class="form-grid">
    <div class="field span-2"><label for="b-name">Nom</label><input class="input" id="b-name" name="name" value="${b.name ?? ''}" placeholder="Vol aller-retour" maxlength="120" required></div>
    <div class="field"><label for="b-cat">Catégorie</label>
      <select class="select full" id="b-cat" name="category">
        ${CATEGORIES.map((c) => html`<option value="${c.id}" ${(b.category ?? 'billets') === c.id ? raw('selected') : ''}>${c.label}</option>`)}
      </select></div>
    <div class="field"><label for="b-status">Statut</label>
      <select class="select full" id="b-status" name="status">
        ${Object.entries(STATUS).map(([id, label]) => html`<option value="${id}" ${(b.status ?? 'a_reserver') === id ? raw('selected') : ''}>${label}</option>`)}
      </select></div>
    ${amountFieldHtml(currencies, { amount: b.amount, currency: b.currency ?? 'EUR', editing: b.id ? b : null })}
    <p class="hint span-2">Réservé et payé sont suivis séparément : ajoutez les paiements ensuite.</p>
    <div class="field span-2"><label for="b-loc">Lieu <span class="opt">(facultatif)</span></label><input class="input" id="b-loc" name="location" value="${b.location ?? ''}" maxlength="200"></div>
    <div class="field"><label for="b-start">Du</label><input class="input" id="b-start" name="startsOn" type="date" value="${b.startsOn ?? ''}"></div>
    <div class="field"><label for="b-end">Au</label><input class="input" id="b-end" name="endsOn" type="date" value="${b.endsOn ?? ''}"></div>
    ${stops.length ? html`<div class="field span-2"><label for="b-stop">Destination <span class="opt">(facultatif)</span></label>
      <select class="select full" id="b-stop" name="stopId"><option value="">Aucune</option>
        ${stops.map((s) => html`<option value="${s.id}" ${b.stopId === s.id ? raw('selected') : ''}>${s.name} · ${formatShortDate(s.startDate)} – ${formatShortDate(s.endDate)}</option>`)}
      </select></div>` : ''}
    <div class="field span-2"><label for="b-url">Lien <span class="opt">(facultatif)</span></label><input class="input" id="b-url" name="sourceUrl" type="url" value="${b.sourceUrl ?? ''}" maxlength="500" placeholder="https://..."></div>
  </div>`;

export async function mount(el) {
  const today = api.today();
  const trips = await api.listTrips();
  let trip = trips.find((t) => t.id === getActiveTripId()) ?? trips[0] ?? null;
  let bookings = [];

  if (!trip) {
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Réservations</h1></div></header>
      <section class="card empty"><h2>Aucun voyage</h2><p>Créez d'abord un voyage pour y ajouter des réservations.</p>
        <a class="btn btn-primary" href="#/voyages">Créer un voyage</a></section>`);
    return () => {};
  }

  const row = (b) => {
    const foreign = b.currency !== 'EUR';
    const paid = paidOrig(b);
    const pct = b.amount ? Math.min((paid / b.amount) * 100, 100) : 0;
    const money = (n) => formatCurrency(n, b.currency);
    return html`
      <li class="booking ${b.status === 'annule' ? 'is-cancelled' : ''}" data-id="${b.id}">
        <div class="booking-main">
          <div class="booking-name">${b.name}<span class="badge badge-b-${b.status}">${STATUS[b.status]}</span></div>
          ${b.location || b.startsOn || b.sourceUrl ? html`<div class="booking-sub muted">${[b.location, b.startsOn ? (b.endsOn && b.endsOn !== b.startsOn ? `${formatLongDate(b.startsOn)} → ${formatLongDate(b.endsOn)}` : formatLongDate(b.startsOn)) : null].filter(Boolean).join(' · ')}${b.sourceUrl ? html`${b.location || b.startsOn ? ' · ' : ''}<a class="src-link" href="${b.sourceUrl}" target="_blank" rel="noopener noreferrer nofollow">Voir le lien</a>` : ''}</div>` : ''}
          ${b.amount === null
            ? html`<div class="muted booking-sub">Prix à renseigner</div>`
            : html`<div class="booking-sub muted">${money(paid)} payés sur ${money(b.amount)}</div>
                   ${foreign ? html`<div class="booking-sub muted" title="Le taux est figé à l'enregistrement : il ne change plus ensuite.">≈ ${formatMoney(b.amountEur)} · taux figé du ${formatLongDate(b.fxDate)} : 1 € = ${formatRate(b.fxRate)} ${b.currency}</div>` : ''}
                   <div class="mini-bar" role="img" aria-label="${formatPercent(pct)} payé"><span style="width:${pct}%"></span></div>`}
        </div>
        <div class="booking-amount">${b.amount === null ? '—' : money(b.amount)}${foreign && b.amount !== null ? html`<small>≈ ${formatMoney(b.amountEur)}</small>` : ''}</div>
        <div class="row-actions">
          <button type="button" class="btn btn-soft btn-sm" data-act="payments">Paiements</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="edit">Modifier</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="duplicate">Dupliquer</button>
          <button type="button" class="btn btn-ghost btn-sm danger-text" data-act="delete">Supprimer</button>
        </div>
      </li>`;
  };

  let filter = 'all'; // filtre par catégorie (affichage seulement)
  const render = () => {
    const s = summarize(trip, bookings);
    const present = CATEGORIES.map((c) => ({ ...c, n: bookings.filter((b) => b.category === c.id).length })).filter((c) => c.n);
    if (filter !== 'all' && !present.some((c) => c.id === filter)) filter = 'all'; // la catégorie filtrée n'existe plus
    const shown = filter === 'all' ? bookings : bookings.filter((b) => b.category === filter);
    const fs = filter === 'all' ? null : summarize(trip, shown);
    announceBudget(trip.id, s);
    const groups = CATEGORIES.map((c) => ({ ...c, items: shown.filter((b) => b.category === c.id) })).filter((g) => g.items.length);
    el.innerHTML = String(html`
      <header class="page-head">
        <div><h1>Réservations</h1><p>${bookings.length} au total pour ce voyage.</p></div>
        <div class="page-actions">
          <label class="sr-only" for="trip-select">Voyage</label>
          <select id="trip-select" class="select">${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}</select>
          <button type="button" class="btn btn-soft" data-act="import">Importer un lien</button>
          <button type="button" class="btn btn-primary" data-act="new">${icon('plus', 16)}Ajouter</button>
        </div>
      </header>
      ${budgetBanner(trip.id, s)}
      <section class="card summary-strip" aria-label="Résumé">
        <div><div class="metric-label">Prévisionnel</div><strong>${formatEUR(s.forecast)}</strong></div>
        <div><div class="metric-label">Payé</div><strong>${formatEUR(s.paid)}</strong></div>
        <div><div class="metric-label">Reste à payer</div><strong>${formatEUR(s.toPay)}</strong></div>
        <div><div class="metric-label">Disponible</div><strong class="${s.available < 0 ? 'danger-text' : ''}">${formatEUR(s.available)}</strong></div>
      </section>
      ${bookings.length > 0 ? html`
        <div class="filter-row" role="group" aria-label="Filtrer par catégorie">
          <button type="button" class="chip-btn" data-filter="all" aria-pressed="${filter === 'all'}">Toutes <span class="chip-n">${bookings.length}</span></button>
          ${present.map((c) => html`<button type="button" class="chip-btn" data-filter="${c.id}" aria-pressed="${filter === c.id}">${c.label} <span class="chip-n">${c.n}</span></button>`)}
        </div>
        ${fs ? html`<section class="card filter-total" aria-live="polite"><strong>${CATEGORIES.find((c) => c.id === filter)?.label}</strong>
          <span>${formatEUR(fs.forecast)} prévus</span><span>${formatEUR(fs.paid)} payés</span><span>${formatEUR(fs.toPay)} restent à payer</span>
          <span class="muted">${s.forecast > 0 ? formatPercent((fs.forecast / s.forecast) * 100) : '0 %'} des dépenses du voyage</span></section>` : ''}` : ''}
      ${bookings.length === 0 ? html`
        <section class="card empty"><h2>Aucune réservation</h2><p>Ajoutez un vol, un hôtel ou une activité. Le prix peut rester vide s'il n'est pas encore connu.</p>
          <button type="button" class="btn btn-primary" data-act="new">${icon('plus', 16)}Ajouter une réservation</button></section>` : ''}
      <div class="stack">
        ${groups.map((g) => html`<section class="card"><h2 class="section-title in-card">${g.label}</h2><ul class="booking-list">${g.items.map(row)}</ul></section>`)}
      </div>`);
  };

  const load = async () => {
    bookings = await api.listBookings(trip.id);
    render();
  };

  const payload = (v) => ({ name: v.name, category: v.category, status: v.status, ...amountPayload(v), location: v.location, startsOn: v.startsOn, endsOn: v.endsOn, sourceUrl: v.sourceUrl, ...(v.stopId !== undefined ? { stopId: v.stopId || null } : {}) });

  const openBookingForm = async (existing) => openDialog({
    title: existing ? 'Modifier la réservation' : 'Nouvelle réservation',
    content: bookingForm(existing, await loadCurrencies(), await api.listStops(trip.id).catch(() => [])),
    onMount: (dlg) => wireAmountField(dlg, { editing: existing ?? null }),
    submitLabel: existing ? 'Enregistrer' : 'Ajouter',
    onSubmit: async (v) => {
      if (existing) await api.updateBooking(existing.id, payload(v));
      else await api.createBooking(trip.id, payload(v));
      toast(existing ? 'Réservation modifiée.' : 'Réservation ajoutée.');
      await load();
    },
  });

  const openPayments = (id) => {
    const get = () => bookings.find((b) => b.id === id);
    openDialog({
      title: 'Paiements',
      cancelLabel: 'Fermer',
      content: html`<div id="pay-body"></div>`,
      onMount: (dlg, { showError }) => {
        const body = dlg.querySelector('#pay-body');
        const draw = () => {
          const b = get();
          const paid = paidOrig(b);
          const cur = b.currency;
          const money = (n) => formatCurrency(n, cur);
          const rest = b.amount === null ? 0 : round2(b.amount - paid);
          body.innerHTML = String(html`
            <p><strong>${b.name}</strong></p>
            <p class="muted">${b.amount === null ? 'Renseignez d\'abord le montant de la réservation pour enregistrer un paiement.' : `${money(paid)} payés sur ${money(b.amount)} · reste ${money(rest)}`}${cur !== 'EUR' ? ` · converti au taux figé de la réservation (1 € = ${formatRate(b.fxRate)} ${cur})` : ''}</p>
            ${b.payments.length ? html`<ul class="pay-list">${b.payments.map((p) => html`
              <li data-pid="${p.id}"><span>${formatLongDate(p.date)}</span><strong>${money(p.amount)}${cur !== 'EUR' ? html` <small class="muted">≈ ${formatMoney(p.amountEur)}</small>` : ''}</strong>
                <button type="button" class="btn btn-ghost btn-sm danger-text" data-pay-del aria-label="Supprimer le paiement du ${formatLongDate(p.date)}">Supprimer</button></li>`)}</ul>` : html`<p class="muted pay-empty">Aucun paiement enregistré.</p>`}
            ${b.amount !== null && rest > 0 ? html`
              <div class="form-grid pay-form">
                <div class="field"><label for="p-date">Date</label><input class="input" id="p-date" type="date" value="${today}"></div>
                <div class="field"><label for="p-amount">Montant (${cur})</label><input class="input" id="p-amount" inputmode="decimal" value="${rest}"></div>
                <div class="field span-2"><button type="button" class="btn btn-primary" data-pay-add>Ajouter ce paiement</button></div>
              </div>` : ''}`);
        };
        const apply = (updated) => { bookings = bookings.map((x) => (x.id === updated.id ? updated : x)); draw(); render(); };
        body.addEventListener('click', async (e) => {
          showError('');
          try {
            if (e.target.closest('[data-pay-add]')) {
              apply(await api.addPayment(id, { date: body.querySelector('#p-date').value, amount: body.querySelector('#p-amount').value }));
            } else if (e.target.closest('[data-pay-del]')) {
              apply(await api.deletePayment(e.target.closest('[data-pid]').dataset.pid));
            }
          } catch (err) { showError(err.message); }
        });
        draw();
      },
    });
  };

  const onClick = (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; render(); el.querySelector(`[data-filter="${filter}"]`)?.focus(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-id]')?.dataset.id;
    const b = bookings.find((x) => x.id === id);
    switch (btn.dataset.act) {
      case 'new': return openBookingForm();
      case 'import': return openImport();
      case 'edit': return openBookingForm(b);
      case 'payments': return openPayments(id);
      case 'duplicate':
        return api.createBooking(trip.id, { name: `${b.name} (copie)`, category: b.category, status: 'a_reserver', amount: b.amount, currency: b.currency, location: b.location, startsOn: b.startsOn, endsOn: b.endsOn, sourceUrl: b.sourceUrl })
          .then(() => { toast('Réservation dupliquée (sans paiement).'); return load(); })
          .catch((err) => toast(err.message));
      case 'delete':
        return confirmDialog({
          title: `Supprimer « ${b.name} » ?`,
          text: b.payments.length ? 'Ses paiements enregistrés seront aussi supprimés.' : 'Cette réservation sera supprimée.',
          onConfirm: async () => { await api.deleteBooking(id); toast('Réservation supprimée.'); await load(); },
        });
    }
  };
  const onChange = (e) => {
    if (e.target.id !== 'trip-select') return;
    trip = trips.find((t) => t.id === e.target.value);
    setActiveTripId(trip.id);
    load().catch((err) => toast(err.message));
  };

  await load();
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  return () => { el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); };
}
