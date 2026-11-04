import { api } from '../api.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { html, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatMoney, formatRange, daysBetween, plural } from '../lib/format.js';
import { attachPlaces } from '../components/autocomplete.js';
import { openShare } from '../components/share-dialog.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Mes voyages';

const STATUS = { preparation: 'En préparation', confirme: 'Confirmé', en_cours: 'En cours', termine: 'Terminé' };

const tripForm = (t = {}) => html`
  <div class="form-grid compact">
    <div class="field span-2"><label for="f-name">Nom du voyage</label><input class="input" id="f-name" name="name" value="${t.name ?? ''}" placeholder="Escapade à Lisbonne" maxlength="120" required></div>
    <div class="field span-2"><label for="f-origin">Ville de départ <span class="muted">(pour le trajet en avion)</span></label><input class="input" id="f-origin" name="origin" value="${t.origin ?? ''}" placeholder="Commencez à écrire : Paris…" maxlength="120"></div>
    <div class="field"><label for="f-dest">Ville d'arrivée</label><input class="input" id="f-dest" name="destination" value="${t.destination ?? ''}" placeholder="Lisbonne" maxlength="120" required></div>
    <div class="field"><label for="f-country">Pays</label><input class="input" id="f-country" name="country" value="${t.country ?? ''}" placeholder="Portugal" maxlength="120"></div>
    <div class="field"><label for="f-start">Départ</label><input class="input" id="f-start" name="startDate" type="date" value="${t.startDate ?? ''}" required></div>
    <div class="field"><label for="f-end">Retour</label><input class="input" id="f-end" name="endDate" type="date" value="${t.endDate ?? ''}" required></div>
    <div class="field"><label for="f-trav">Voyageurs</label><input class="input" id="f-trav" name="travelers" type="number" min="1" max="50" value="${t.travelers ?? 1}" required></div>
    <div class="field"><label for="f-budget">Budget initial (€)</label><input class="input" id="f-budget" name="budgetEur" inputmode="decimal" value="${t.budgetEur ?? ''}" placeholder="2000" required></div>
    <div class="field span-2"><label for="f-plan">Statut</label>
      <select class="select full" id="f-plan" name="planStatus">
        ${['preparation', 'confirme'].map((s) => html`<option value="${s}" ${(t.planStatus ?? 'preparation') === s ? raw('selected') : ''}>${STATUS[s]}</option>`)}
      </select>
    </div>
  </div>`;

export async function mount(el, { user } = {}) {
  let trips = [];

  const card = (t) => html`
    <article class="card trip-card" data-id="${t.id}">
      <div class="trip-top">
        <span class="badge badge-${t.status}">${STATUS[t.status]}</span>
        <span class="muted trip-meta">${t.role === 'member' ? 'Partagé · ' : ''}${t.travelers} ${plural(t.travelers, 'voyageur', 'voyageurs')}</span>
      </div>
      <h2>${t.name}</h2>
      <p class="muted">${t.destination}${t.country ? `, ${t.country}` : ''}</p>
      <p class="trip-dates">${formatRange(t.startDate, t.endDate)} · ${daysBetween(t.startDate, t.endDate)} ${plural(daysBetween(t.startDate, t.endDate), 'nuit', 'nuits')}</p>
      <p class="trip-budget"><span class="muted">Budget initial</span> <strong>${formatMoney(t.budgetEur)}</strong></p>
      <div class="row-actions">
        <button type="button" class="btn btn-primary btn-sm" data-act="open">${t.id === getActiveTripId() ? 'Voyage affiché' : 'Afficher'}</button>
        <button type="button" class="btn btn-soft btn-sm" data-act="bookings">Réservations</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="edit">Modifier</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="share">Partager</button>
        <a class="btn btn-ghost btn-sm" href="/api/trips/${t.id}/export.pdf" download>PDF</a>
        ${t.role === 'member' ? '' : html`<button type="button" class="btn btn-ghost btn-sm danger-text" data-act="delete">Supprimer</button>`}
      </div>
    </article>`;

  const render = () => {
    const current = trips.filter((t) => t.status !== 'termine');
    const past = trips.filter((t) => t.status === 'termine').reverse();
    el.innerHTML = String(html`
      <header class="page-head">
        <div><h1>Mes voyages</h1><p>${trips.length ? `${trips.length} ${plural(trips.length, 'voyage', 'voyages')}, chacun avec son propre budget.` : 'Aucun voyage pour le moment.'}</p></div>
        <div class="page-actions"><button type="button" class="btn btn-primary" data-act="new">${icon('plus', 16)}Nouveau voyage</button></div>
      </header>
      ${trips.length === 0 ? html`
        <section class="card empty"><h2>Créez votre premier voyage</h2>
          <p>Une destination, des dates et un budget en euros suffisent pour commencer.</p>
          <button type="button" class="btn btn-primary" data-act="new">${icon('plus', 16)}Nouveau voyage</button></section>` : ''}
      ${current.length ? html`<div class="trip-grid">${current.map(card)}</div>` : ''}
      ${past.length ? html`<h2 class="section-title">Voyages terminés</h2><div class="trip-grid">${past.map(card)}</div>` : ''}
    `);
  };

  const load = async () => {
    trips = await api.listTrips();
    render();
  };

  const openForm = (existing) => openDialog({
    title: existing ? 'Modifier le voyage' : 'Nouveau voyage',
    content: tripForm(existing),
    submitLabel: existing ? 'Enregistrer' : 'Créer le voyage',
    onMount: (dlg) => {
      const f = (id) => dlg.querySelector(id);
      attachPlaces(f('#f-origin'), { type: 'city', onPick: (it) => { f('#f-origin').value = it.country ? `${it.city}, ${it.country}` : it.city; } });
      attachPlaces(f('#f-dest'), { type: 'city', onPick: (it) => { if (it.country) f('#f-country').value = it.country; } });
      attachPlaces(f('#f-country'), { type: 'country' });
    },
    onSubmit: async (v) => {
      const payload = { ...v, travelers: Number(v.travelers) };
      if (existing) {
        await api.updateTrip(existing.id, payload);
        toast('Voyage modifié.');
      } else {
        const created = await api.createTrip(payload);
        if (!getActiveTripId() || !trips.length) setActiveTripId(created.id);
        toast('Voyage créé.');
      }
      await load();
    },
  });

  const onClick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-id]')?.dataset.id;
    const trip = trips.find((t) => t.id === id);
    switch (btn.dataset.act) {
      case 'new': return openForm();
      case 'edit': return openForm(trip);
      case 'open': setActiveTripId(id); location.hash = '#/'; return;
      case 'bookings': setActiveTripId(id); location.hash = '#/reservations'; return;
      case 'share': return openShare(trip, { user, onChange: () => load() });
      case 'delete':
        return confirmDialog({
          title: `Supprimer « ${trip.name} » ?`,
          text: 'Ses réservations et ses paiements seront supprimés définitivement.',
          onConfirm: async () => { await api.deleteTrip(id); toast('Voyage supprimé.'); await load(); },
        });
    }
  };

  await load();
  el.addEventListener('click', onClick);
  return () => el.removeEventListener('click', onClick);
}
