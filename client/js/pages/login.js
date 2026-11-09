import { api } from '../api.js';
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { toast } from '../components/toast.js';

export const title = 'Connexion';

export async function mount(el, { onAuthenticated, invite = null }) {
  const cfg = await api.authConfig().catch(() => ({ registrationOpen: true }));
  const closed = !cfg.registrationOpen && !invite; // inscriptions fermées : on envoie une demande d'accès au propriétaire
  let mode = invite ? 'register' : 'login'; // 'login' | 'register' | 'reset'
  let prefill = '';

  const render = () => {
    const register = mode === 'register';
    if (mode === 'reset') {
      el.innerHTML = String(html`
        <div class="auth-wrap"><div class="auth-card card">
          <div class="brand auth-brand"><span class="brand-mark">${icon('compass', 18)}</span>Travel Planner</div>
          <h1>Mot de passe oublié</h1>
          <p class="muted">Entrez votre e-mail, l'un de vos codes de récupération (donnés à la création du compte) et un nouveau mot de passe.</p>
          <form id="auth-form" class="auth-form" novalidate>
            <div class="field"><label for="email">Adresse email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required value="${prefill}"></div>
            <div class="field"><label for="code">Code de récupération</label><input class="input" id="code" name="code" autocomplete="off" autocapitalize="characters" placeholder="XXXXX-XXXXX" required></div>
            <div class="field"><label for="password">Nouveau mot de passe</label><input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="10" required><small class="hint">10 caractères minimum.</small></div>
            <p class="form-error" role="alert" hidden></p>
            <button class="btn btn-primary" type="submit">Changer le mot de passe</button>
          </form>
          <p class="auth-switch"><button type="button" class="link-btn" data-switch-login>Retour à la connexion</button></p>
        </div></div>`);
      el.querySelector('input')?.focus();
      return;
    }
    el.innerHTML = String(html`
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="brand auth-brand"><span class="brand-mark">${icon('compass', 18)}</span>Travel Planner</div>
          <h1>${register ? (closed ? "Demander l'accès" : 'Créer un compte') : 'Connexion'}</h1>
          ${invite ? html`<p class="invite-banner"><strong>${invite.ownerFirstName}</strong> vous invite à rejoindre le voyage <strong>${invite.name}</strong>${invite.destination ? html` (${invite.destination})` : ''}. ${register ? 'Créez votre compte' : 'Connectez-vous'} pour y accéder.</p>` : html`<p class="muted">${register && closed ? "L'accès est sur validation. Votre demande est envoyée au propriétaire du site, qui l'approuve ou non." : register ? 'Vos voyages et votre budget, au même endroit.' : 'Retrouvez vos voyages et votre budget.'}</p>`}
          <form id="auth-form" class="auth-form" novalidate>
            ${register ? html`<div class="field"><label for="firstName">Prénom</label><input class="input" id="firstName" name="firstName" autocomplete="given-name" required maxlength="60"></div>` : ''}
            <div class="field"><label for="email">Adresse email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
            <div class="field">
              <label for="password">Mot de passe</label>
              <input class="input" id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required ${register ? html`minlength="10"` : ''}>
              ${register ? html`<small class="hint">10 caractères minimum.</small>` : ''}
            </div>
            <label class="check"><input type="checkbox" name="remember" checked> Se souvenir de moi</label>
            ${register ? '' : html`<p class="forgot"><button type="button" class="link-btn" data-switch-reset>Mot de passe oublié ?</button></p>`}
            <p class="form-error" role="alert" hidden></p>
            <button class="btn btn-primary" type="submit">${register ? (closed ? 'Envoyer ma demande' : 'Créer mon compte') : 'Se connecter'}</button>
          </form>
          <p class="auth-switch">${register ? 'Déjà un compte ?' : 'Pas encore de compte ?'}
            <button type="button" class="link-btn" data-switch>${register ? 'Se connecter' : (closed ? "Demander l'accès" : 'Créer un compte')}</button></p>
        </div>
      </div>`);
    el.querySelector('input')?.focus();
  };

  const onClick = (e) => {
    if (e.target.closest('[data-switch-reset]')) { prefill = el.querySelector('#email')?.value ?? ''; mode = 'reset'; render(); return; }
    if (e.target.closest('[data-switch-login]')) { mode = 'login'; render(); return; }
    if (e.target.closest('[data-switch]')) {
      mode = mode === 'login' ? 'register' : 'login';
      render();
    }
  };
  const onSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const errorEl = form.querySelector('.form-error');
    const button = form.querySelector('[type="submit"]');
    const v = Object.fromEntries(new FormData(form));
    errorEl.hidden = true;
    if (mode === 'reset') {
      if (!v.email || !v.code || !v.password) { errorEl.textContent = 'Remplissez tous les champs.'; errorEl.hidden = false; return; }
      button.disabled = true;
      try {
        await api.resetPassword(v.email, v.code, v.password);
        toast('Mot de passe changé. Connectez-vous avec le nouveau.', 5000);
        prefill = v.email; mode = 'login'; render();
        el.querySelector('#email').value = v.email; el.querySelector('#password')?.focus();
      } catch (err) { errorEl.textContent = err.message; errorEl.hidden = false; button.disabled = false; }
      return;
    }
    const remember = form.elements.remember.checked;
    if (!v.email || !v.password || (mode === 'register' && !v.firstName)) {
      errorEl.textContent = 'Remplissez tous les champs.';
      errorEl.hidden = false;
      return;
    }
    button.disabled = true;
    try {
      const user = mode === 'register'
        ? await api.register(v.firstName, v.email, v.password, remember, invite?.token)
        : await api.login(v.email, v.password, remember);
      if (user.pending) {
        toast("Demande envoyée. Vous pourrez vous connecter dès que le propriétaire l'aura approuvée.", 7000);
        prefill = v.email; mode = 'login'; render();
        el.querySelector('#email').value = v.email;
        return;
      }
      onAuthenticated(user, { joined: mode === 'register' && !!invite });
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      button.disabled = false;
    }
  };

  render();
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  return () => {
    el.removeEventListener('click', onClick);
    el.removeEventListener('submit', onSubmit);
  };
}
