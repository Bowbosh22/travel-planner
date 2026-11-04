// Partage d'un voyage : lien d'invitation (propriétaire) et liste des participants.
import { api } from '../api.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { html } from '../lib/html.js';

const linkFor = (token) => `${location.origin}${location.pathname}#/invitation/${token}`;

// onChange(trip|null) : appelé après toute modification (le voyage mis à jour, ou null si l'on a quitté le voyage).
export function openShare(initial, { user, onChange }) {
  let trip = initial;
  const owner = trip.role === 'owner';

  const body = () => html`
    ${owner ? html`
      <p class="muted">Toute personne qui ouvre ce lien et crée un compte (ou se connecte) rejoint le voyage et peut tout modifier, sauf le supprimer.</p>
      ${trip.inviteToken ? html`
        <div class="share-link">
          <input class="input" id="share-url" readonly value="${linkFor(trip.inviteToken)}" aria-label="Lien d'invitation">
          <button type="button" class="btn btn-primary btn-sm" data-share="copy">Copier</button>
        </div>
        <p class="share-actions"><button type="button" class="link-btn" data-share="renew">Nouveau lien</button> · <button type="button" class="link-btn danger-text" data-share="revoke">Désactiver le lien</button></p>
        <small class="hint">« Nouveau lien » ou « Désactiver » invalide l'ancien lien. Les personnes déjà dans le voyage y restent.</small>`
      : html`<button type="button" class="btn btn-primary" data-share="create">Créer un lien d'invitation</button>`}`
    : html`<p class="muted">Vous participez à ce voyage avec un accès commun : vous pouvez tout modifier, sauf le supprimer.</p>`}
    <h3 class="share-title">Participants</h3>
    <ul class="share-members">
      ${trip.members.map((m) => html`<li><span class="cp-name">${m.firstName}${m.id === user.id ? ' (vous)' : ''}</span>
        <span class="muted small-line">${m.owner ? 'Propriétaire' : 'Membre'}</span>
        ${owner && m.id !== user.id ? html`<button type="button" class="link-btn danger-text" data-share-remove="${m.id}">Retirer</button>` : ''}</li>`)}
    </ul>
    ${!owner ? html`<p><button type="button" class="link-btn danger-text" data-share="leave">Quitter le voyage</button></p>` : ''}`;

  openDialog({
    title: `Partager « ${trip.name} »`,
    content: html`<div id="share-body"></div>`,
    cancelLabel: 'Fermer',
    onMount: (dlg, { close }) => {
      const box = dlg.querySelector('#share-body');
      const draw = () => { box.innerHTML = String(body()); };
      const apply = (t) => { if (t) { trip = t; onChange?.(t); } draw(); };
      draw();
      dlg.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-share],[data-share-remove]');
        if (!b) return;
        try {
          if (b.dataset.share === 'copy') {
            const url = dlg.querySelector('#share-url').value;
            try { await navigator.clipboard.writeText(url); toast('Lien copié.'); }
            catch { dlg.querySelector('#share-url').select(); toast('Sélectionné : copiez-le avec Ctrl+C.'); }
          } else if (b.dataset.share === 'create' || b.dataset.share === 'renew') {
            apply(await api.createInvite(trip.id));
            toast('Nouveau lien créé.');
          } else if (b.dataset.share === 'revoke') {
            await api.revokeInvite(trip.id);
            apply({ ...trip, inviteToken: null });
            toast('Lien désactivé.');
          } else if (b.dataset.shareRemove) {
            await api.removeMember(trip.id, b.dataset.shareRemove);
            apply({ ...trip, members: trip.members.filter((m) => m.id !== b.dataset.shareRemove) });
            toast('Participant retiré.');
          } else if (b.dataset.share === 'leave') {
            await api.leaveTrip(trip.id);
            close();
            toast('Vous avez quitté le voyage.');
            onChange?.(null);
          }
        } catch (err) { toast(err.message || 'Action impossible.', 5000, 'warn'); }
      });
    },
  });
}
