import { api } from '../api.js';
import { confirmDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { html, raw } from '../lib/html.js';
import { formatBytes, formatLongDate } from '../lib/format.js';
import { getActiveTripId, setActiveTripId } from '../store.js';

export const title = 'Documents';

const KIND = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' };

export async function mount(el) {
  const trips = await api.listTrips();
  const trip = trips.find((t) => t.id === getActiveTripId()) ?? trips[0] ?? null;

  if (!trip) {
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Documents</h1></div></header>
      <section class="card empty"><h2>Aucun voyage</h2><p>Créez un voyage pour y ranger vos billets et confirmations.</p><a class="btn btn-primary" href="#/voyages">Créer un voyage</a></section>`);
    return () => {};
  }

  let bookings = await api.listBookings(trip.id);
  let data = await api.listDocuments(trip.id);

  const draw = () => {
    const pct = Math.min((data.usedBytes / data.maxUserBytes) * 100, 100);
    el.innerHTML = String(html`
      <header class="page-head">
        <div><h1>Documents</h1><p>Billets, confirmations et factures de « ${trip.name} ». PDF, JPG, PNG ou WebP, ${formatBytes(data.maxFileBytes)} maximum par fichier.</p></div>
        <div class="page-actions">
          <label class="sr-only" for="trip-select">Voyage</label>
          <select id="trip-select" class="select">${trips.map((t) => html`<option value="${t.id}" ${t.id === trip.id ? raw('selected') : ''}>${t.name}</option>`)}</select>
        </div>
      </header>
      <div class="stack">
        <section class="card" aria-label="Ajouter un document">
          <h2>Ajouter des documents</h2>
          <div class="form-grid" style="margin-top:14px">
            <div class="field"><label for="d-file">Fichiers</label><input class="input file-input" id="d-file" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"></div>
            <div class="field"><label for="d-booking">Réservation liée <span class="opt">(facultatif)</span></label>
              <select class="select full" id="d-booking"><option value="">Aucune (document du voyage)</option>
                ${bookings.map((b) => html`<option value="${b.id}">${b.name}</option>`)}</select></div>
            <p class="form-error span-2" id="d-error" role="alert" hidden></p>
            <div class="field span-2"><button type="button" class="btn btn-primary" data-upload>Envoyer</button></div>
          </div>
          <div class="mini-bar wide" role="img" aria-label="${formatBytes(data.usedBytes)} utilisés sur ${formatBytes(data.maxUserBytes)}"><span style="width:${pct}%"></span></div>
          <p class="muted small" style="margin-top:8px">${formatBytes(data.usedBytes)} utilisés sur ${formatBytes(data.maxUserBytes)} (stockage gratuit dans votre base).</p>
        </section>
        <section class="card" aria-label="Documents du voyage">
          <h2 class="section-title in-card">${data.documents.length} ${data.documents.length > 1 ? 'documents' : 'document'}</h2>
          ${data.documents.length ? html`<ul class="doc-list">${data.documents.map((d) => html`
            <li data-id="${d.id}">
              <span class="doc-kind">${KIND[d.mime] ?? 'Fichier'}</span>
              <div class="doc-main"><div class="doc-name">${d.name}</div>
                <div class="muted small-line">${d.bookingName ? html`${d.bookingName} · ` : ''}${formatBytes(d.size)} · ajouté le ${formatLongDate(String(d.createdAt).slice(0, 10))}</div></div>
              <div class="row-actions">
                <a class="btn btn-soft btn-sm" href="/api/documents/${d.id}/file" target="_blank" rel="noopener noreferrer">Ouvrir</a>
                <a class="btn btn-ghost btn-sm" href="/api/documents/${d.id}/file?download=1">Télécharger</a>
                <button type="button" class="btn btn-ghost btn-sm danger-text" data-del>Supprimer</button>
              </div>
            </li>`)}</ul>`
            : html`<p class="muted">Aucun document pour ce voyage. Ajoutez vos billets et confirmations pour les retrouver ici.</p>`}
        </section>
      </div>`);
  };

  const refresh = async () => { data = await api.listDocuments(trip.id); draw(); };

  const onClick = async (e) => {
    if (e.target.closest('[data-upload]')) {
      const input = el.querySelector('#d-file');
      const errEl = el.querySelector('#d-error');
      const files = [...input.files];
      const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };
      errEl.hidden = true;
      if (!files.length) return fail('Choisissez au moins un fichier.');
      const tooBig = files.find((f) => f.size > data.maxFileBytes);
      if (tooBig) return fail(`« ${tooBig.name} » dépasse ${formatBytes(data.maxFileBytes)}.`);
      const bookingId = el.querySelector('#d-booking').value || null;
      const btn = e.target.closest('[data-upload]');
      btn.disabled = true;
      let sent = 0;
      try {
        for (const f of files) { await api.uploadDocument(trip.id, f, bookingId); sent += 1; }
      } catch (err) {
        await refresh();
        el.querySelector('#d-error').textContent = `${sent ? `${sent} envoyé(s). ` : ''}${err.message}`;
        el.querySelector('#d-error').hidden = false;
        return undefined;
      }
      toast(sent > 1 ? `${sent} documents ajoutés.` : 'Document ajouté.');
      return refresh();
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.closest('[data-id]').dataset.id;
      const doc = data.documents.find((d) => d.id === id);
      return confirmDialog({
        title: `Supprimer « ${doc.name} » ?`, text: 'Le fichier sera supprimé définitivement.',
        onConfirm: async () => { await api.deleteDocument(id); toast('Document supprimé.'); await refresh(); },
      });
    }
    return undefined;
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
