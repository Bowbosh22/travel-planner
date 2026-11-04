import { api } from '../api.js';
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';

export const title = 'Connexion';

export async function mount(el, { onAuthenticated, invite = null }) {
  let mode = invite ? 'register' : 'login'; // 'login' | 'register'

  const render = () => {
    const register = mode === 'register';
    el.innerHTML = String(html`
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="brand auth-brand"><span class="brand-mark">${icon('compass', 18)}</span>Travel Planner</div>
          <h1>${register ? 'Créer un compte' : 'Connexion'}</h1>
          ${invite ? html`<p class="invite-banner"><strong>${invite.ownerFirstName}</strong> vous invite à rejoindre le voyage <strong>${invite.name}</strong>${invite.destination ? html` (${invite.destination})` : ''}. ${register ? 'Créez votre compte' : 'Connectez-vous'} pour y accéder.</p>` : html`<p class="muted">${register ? 'Vos voyages et votre budget, au même endroit.' : 'Retrouvez vos voyages et votre budget.'}</p>`}
          <form id="auth-form" class="auth-form" novalidate>
            ${register ? html`<div class="field"><label for="firstName">Prénom</label><input class="input" id="firstName" name="firstName" autocomplete="given-name" required maxlength="60"></div>` : ''}
            <div class="field"><label for="email">Adresse email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
            <div class="field">
              <label for="password">Mot de passe</label>
              <input class="input" id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required ${register ? html`minlength="10"` : ''}>
              ${register ? html`<small class="hint">10 caractères minimum.</small>` : ''}
            </div>
            <label class="check"><input type="checkbox" name="remember" checked> Se souvenir de moi</label>
            <p class="form-error" role="alert" hidden></p>
            <button class="btn btn-primary" type="submit">${register ? 'Créer mon compte' : 'Se connecter'}</button>
          </form>
          <p class="auth-switch">${register ? 'Déjà un compte ?' : 'Pas encore de compte ?'}
            <button type="button" class="link-btn" data-switch>${register ? 'Se connecter' : 'Créer un compte'}</button></p>
        </div>
      </div>`);
    el.querySelector('input')?.focus();
  };

  const onClick = (e) => {
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
    const remember = form.elements.remember.checked;
    errorEl.hidden = true;
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
