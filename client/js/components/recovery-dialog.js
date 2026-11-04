// Codes de récupération : affichage unique après création, et génération d'un nouveau lot depuis les paramètres.
import { api } from '../api.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { html } from '../lib/html.js';

export function showRecoveryCodes(codes, { title = 'Vos codes de récupération' } = {}) {
  openDialog({
    title,
    submitLabel: "J'ai noté mes codes",
    cancelLabel: 'Fermer',
    content: html`
      <p class="muted">Si vous oubliez votre mot de passe, l'un de ces codes vous permet d'en choisir un nouveau. <strong>Chaque code ne sert qu'une fois</strong> et ne sera plus affiché : gardez-les dans un endroit sûr (gestionnaire de mots de passe, papier).</p>
      <ul class="recovery-grid">${codes.map((c) => html`<li><code>${c}</code></li>`)}</ul>
      <div class="recovery-actions">
        <button type="button" class="btn btn-soft btn-sm" data-rc-copy>Copier</button>
        <button type="button" class="btn btn-soft btn-sm" data-rc-download>Télécharger (.txt)</button>
      </div>`,
    onSubmit: () => undefined,
    onMount: (dlg) => {
      dlg.querySelector('[data-rc-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(codes.join('\n')); toast('Codes copiés.'); } catch { toast('Copie impossible : sélectionnez-les à la main.', 4000, 'warn'); }
      });
      dlg.querySelector('[data-rc-download]').addEventListener('click', () => {
        const blob = new Blob([`Travel Planner - codes de récupération\n(un code = un seul usage)\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'travel-planner-codes-recuperation.txt';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    },
  });
}

// Demande le mot de passe, puis génère un nouveau lot (les anciens codes sont invalidés).
export function askNewRecoveryCodes({ onDone } = {}) {
  openDialog({
    title: 'Nouveaux codes de récupération',
    submitLabel: 'Générer',
    content: html`<p class="muted">Les anciens codes ne fonctionneront plus. Confirmez avec votre mot de passe.</p>
      <div class="field"><label for="rc-pw">Mot de passe</label><input class="input" id="rc-pw" name="password" type="password" autocomplete="current-password" required></div>`,
    onSubmit: async (v) => {
      const codes = await api.newRecoveryCodes(v.password);
      onDone?.();
      setTimeout(() => showRecoveryCodes(codes, { title: 'Vos nouveaux codes' }), 50);
    },
  });
}
