// Boîte de dialogue accessible (élément <dialog> natif : focus piégé, Échap, fond inerte).
import { html } from '../lib/html.js';

// content : html`...` (déjà échappé). onSubmit(values, dialog) peut lancer une Error : son message s'affiche dans la boîte.
export function openDialog({ title, content = '', submitLabel = 'Enregistrer', cancelLabel = 'Annuler', danger = false, onSubmit, onMount }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  dlg.innerHTML = String(html`
    <form method="dialog" class="dialog-form" novalidate>
      <h2 class="dialog-title">${title}</h2>
      <div class="dialog-body">${content}</div>
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-soft" data-close>${cancelLabel}</button>
        ${onSubmit ? html`<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button>` : ''}
      </div>
    </form>`);
  document.body.append(dlg);

  const form = dlg.querySelector('form');
  const errorEl = dlg.querySelector('.form-error');
  const showError = (msg) => { errorEl.textContent = msg; errorEl.hidden = !msg; };
  const close = () => dlg.close();

  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // clic sur le fond
  dlg.querySelector('[data-close]').addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    showError('');
    try {
      await onSubmit(Object.fromEntries(new FormData(form)), dlg);
      close();
    } catch (err) {
      showError(err.message || 'Une erreur est survenue.');
      button.disabled = false;
    }
  });

  dlg.showModal();
  onMount?.(dlg, { showError, close });
  return { close, showError };
}

// Confirmation d'une action destructrice.
export const confirmDialog = ({ title, text, confirmLabel = 'Supprimer', onConfirm }) =>
  openDialog({ title, content: html`<p class="muted">${text}</p>`, submitLabel: confirmLabel, danger: true, onSubmit: onConfirm });
