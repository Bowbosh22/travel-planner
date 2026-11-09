import { api } from '../api.js';
import { COLORS, MODES, BACKGROUNDS, getTheme, setTheme, getCustomBackground, setCustomBackground, photoToDataUrl } from '../theme.js';
import { html, raw } from '../lib/html.js';
import { formatEUR } from '../lib/format.js';
import { bookmarkletHref } from '../lib/capture.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/dialog.js';
import { getPrefs, savePrefs } from '../prefs.js';
import { displayCurrency } from '../lib/format.js';
import { askNewRecoveryCodes } from '../components/recovery-dialog.js';

export const title = 'Paramètres';

const modeArt = {
  clair: 'background:#F5F7FB',
  sombre: 'background:#0B1220',
  auto: 'background:linear-gradient(90deg,#F5F7FB 50%,#0B1220 50%)',
};

const TAB_KEY = 'tp-settings-tab';
const readTab = () => { try { return sessionStorage.getItem(TAB_KEY) === 'compte' ? 'compte' : 'affichage'; } catch { return 'affichage'; } };

export async function mount(el, { user, logout }) {
  let tab = readTab();
  const render = () => {
    const theme = getTheme();
    const prefs = getPrefs();
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Paramètres</h1><p>${tab === 'compte' ? 'Votre compte, votre mot de passe et les voyageurs de vos voyages.' : "Choisissez le mode, la couleur et le fond du site. Le choix est enregistré sur votre compte."}</p></div></header>
      <div class="seg-tabs" role="tablist" aria-label="Paramètres">
        <button type="button" role="tab" class="seg-tab" data-tab="affichage" aria-selected="${tab === 'affichage'}">Affichage du site</button>
        <button type="button" role="tab" class="seg-tab" data-tab="compte" aria-selected="${tab === 'compte'}">Mon compte</button>
      </div>
      ${tab === 'affichage' ? html`
      <div class="settings-grid">
        <div class="stack">
          <section class="card" aria-label="Mode">
            <h2>Mode</h2>
            <div class="options">
              ${MODES.map((m) => html`
                <button type="button" class="tile" data-mode="${m.id}" aria-pressed="${theme.mode === m.id}">
                  <span class="tile-art" style="${raw(modeArt[m.id])}"></span>
                  <span class="tile-foot">${m.label}<span class="mark"></span></span>
                </button>`)}
            </div>
            <p class="muted" style="margin-top:16px;font-size:13px">Automatique suit le réglage de votre appareil.</p>
          </section>
          <section class="card" aria-label="Couleur">
            <h2>Couleur</h2>
            <div class="options">
              ${COLORS.map((c) => html`
                <button type="button" class="tile" data-color="${c.id}" aria-pressed="${theme.color === c.id}">
                  <span class="tile-art" style="background:transparent;border-color:var(--border)">${c.swatches.map((s) => html`<span class="swatch" style="background:${s}"></span>`)}</span>
                  <span class="tile-foot">${c.label}<span class="mark"></span></span>
                </button>`)}
            </div>
          </section>
          <section class="card" aria-label="Fond d'écran">
            <h2>Fond d'écran</h2>
            <div class="options bg-options">
              ${BACKGROUNDS.map((b) => html`
                <button type="button" class="tile" data-bg="${b.id}" aria-pressed="${theme.bg === b.id}">
                  <span class="tile-art bg-art" style="background-image:url('${b.thumb}')"></span>
                  <span class="tile-foot">${b.label}<span class="mark"></span></span>
                </button>`)}
              ${getCustomBackground() ? html`
                <button type="button" class="tile" data-bg="perso" aria-pressed="${theme.bg === 'perso'}">
                  <span class="tile-art bg-art" style="background-image:url('${raw(getCustomBackground())}')"></span>
                  <span class="tile-foot">Ma photo<span class="mark"></span></span>
                </button>` : ''}
            </div>
            <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
              <label class="btn btn-soft" for="bg-file">Choisir ma photo…</label>
              <input id="bg-file" type="file" accept="image/*" class="sr-only">
              ${getCustomBackground() ? html`<button type="button" class="btn btn-ghost btn-sm" data-bg-clear>Retirer ma photo</button>` : ''}
            </div>
            <p class="muted" style="margin-top:12px;font-size:13px">Le fond s'affiche avec la couleur Paysage, et se règle sur cet appareil. Votre photo reste dans votre navigateur.</p>
          </section>
          <section class="card" aria-label="Taille du texte">
            <h2>Taille du texte</h2>
            <div class="opt-row" role="group" aria-label="Taille du texte">
              ${[['small', 'Petite'], ['normal', 'Normale'], ['large', 'Grande']].map(([v, l]) => html`<button type="button" class="opt-btn" data-pref="textSize" data-val="${v}" aria-pressed="${(prefs.textSize ?? 'normal') === v}">${l}</button>`)}
            </div>
            <p class="muted" style="margin-top:12px;font-size:13px">Agrandit ou réduit le texte et les éléments des pages (pratique sur téléphone).</p>
          </section>
          <section class="card" aria-label="Effets visuels">
            <h2>Effets visuels</h2>
            <div class="opt-row" role="group" aria-label="Effets visuels">
              ${[['full', 'Complets'], ['light', 'Légers (plus fluide)']].map(([v, l]) => html`<button type="button" class="opt-btn" data-pref="effects" data-val="${v}" aria-pressed="${(prefs.effects ?? 'full') === v}">${l}</button>`)}
            </div>
            <p class="muted" style="margin-top:12px;font-size:13px">« Légers » supprime le flou de verre dépoli et les animations : le site réagit plus vite sur un ordinateur ou un téléphone modeste.</p>
          </section>
          <section class="card" aria-label="Devise d'affichage">
            <h2>Devise d'affichage</h2>
            <div class="opt-row" role="group" aria-label="Devise d'affichage">
              ${[['EUR', 'Euro (€)'], ['USD', 'Dollar US ($)'], ['XAF', 'Franc CFA (FCFA)']].map(([v, l]) => html`<button type="button" class="opt-btn" data-pref="currency" data-val="${v}" aria-pressed="${displayCurrency() === v}">${l}</button>`)}
            </div>
            <p class="muted" style="margin-top:12px;font-size:13px">Les montants restent enregistrés en euros ; seul l'affichage est converti au taux du jour (parité fixe pour le franc CFA). Les formulaires de saisie restent en euros.</p>
          </section>
          <section class="card" aria-label="Page de lancement">
            <h2>Page affichée au lancement</h2>
            <div class="opt-row" role="group" aria-label="Page de lancement">
              ${[['dashboard', 'Dashboard'], ['voyages', 'Mes voyages'], ['carte', 'Carte']].map(([v, l]) => html`<button type="button" class="opt-btn" data-pref="home" data-val="${v}" aria-pressed="${(prefs.home ?? 'dashboard') === v}">${l}</button>`)}
            </div>
            <p class="muted" style="margin-top:12px;font-size:13px">Page ouverte quand vous ouvrez le site ou vous connectez.</p>
          </section>
          <section class="card" aria-label="Tableau de bord">
            <h2>Tableau de bord</h2>
            <p class="muted" style="margin:8px 0 12px">Déplacez, redimensionnez ou masquez les widgets : sur le Dashboard, bouton « Personnaliser ».</p>
            <div class="row-actions"><a class="btn btn-soft" href="#/" data-go-dash>Ouvrir le Dashboard</a><button type="button" class="btn btn-ghost" data-layout-reset>Disposition d'origine</button></div>
          </section>
          <section class="card" aria-label="Favori d'import">
            <h2>Importer depuis mon navigateur</h2>
            <p class="muted" style="margin:8px 0 16px">Pour Airbnb, Booking et tout site qui refuse les robots : le favori lit la page que <strong>vous</strong> regardez (nom, lieu, total, dates) et préremplit une réservation. Vous vérifiez avant d'ajouter.</p>
            <ol class="muted" style="margin:0 0 16px 18px;line-height:1.7">
              <li>Affichez la barre de favoris de votre navigateur (Ctrl+Maj+B).</li>
              <li>Glissez le bouton ci-dessous dans cette barre.</li>
              <li>Ouvrez l'annonce, choisissez vos dates, puis cliquez sur le favori.</li>
            </ol>
            <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
              <a class="btn btn-primary" id="bm-link" draggable="true" href="#/parametres">Importer dans Travel Planner</a>
              <button type="button" class="btn btn-soft" data-copy-bm>Copier le code du favori</button>
            </div>
          </section>
        </div>
        <section class="card" aria-label="Aperçu">
          <h2>Aperçu</h2>
          <div class="preview">
            <div class="hero"><div><div class="hero-label">Prochain voyage</div><h2>Lisbonne, Portugal</h2><p>12 – 19 déc. 2026</p></div></div>
            <div style="display:flex;gap:28px">
              <div><div class="metric-label">Payé</div><div class="metric-value">${formatEUR(900)}</div></div>
              <div><div class="metric-label">Disponible</div><div class="metric-value accent">${formatEUR(500)}</div></div>
            </div>
            <div class="bar" style="margin:0"><div class="bar-paid" style="width:45%"></div><div class="bar-reserved" style="width:30%"></div></div>
            <div class="preview-actions">
              <span class="chip" style="background:var(--accent-strong);color:var(--on-accent)">Importer depuis un lien</span>
              <span class="chip" style="background:var(--soft);color:var(--soft-text)">Voir le voyage</span>
            </div>
          </div>
        </section>
      </div>` : html`
      <div class="settings-grid">
        <div class="stack">
          <section class="card" aria-label="Profil">
            <h2>Mon profil</h2>
            <form id="name-form" class="pw-form" novalidate>
              <div class="field"><label for="nm-first">Prénom</label><input class="input" id="nm-first" value="${user.firstName}" maxlength="60" autocomplete="given-name" required></div>
              <div class="field"><label for="nm-mail">Adresse e-mail</label><input class="input" id="nm-mail" value="${user.email}" disabled></div>
              <p class="form-error" id="nm-err" role="alert" hidden></p>
              <button type="submit" class="btn btn-primary">Enregistrer le prénom</button>
            </form>
          </section>
          <section class="card" aria-label="Mot de passe">
            <h2>Changer mon mot de passe</h2>
            <form id="pw-form" class="pw-form" novalidate>
              <div class="field"><label for="pw-cur">Mot de passe actuel</label><input class="input" id="pw-cur" type="password" autocomplete="current-password" required></div>
              <div class="field"><label for="pw-new">Nouveau mot de passe</label><input class="input" id="pw-new" type="password" autocomplete="new-password" minlength="10" required><span class="hint">10 caractères minimum.</span></div>
              <div class="field"><label for="pw-conf">Confirmer le nouveau mot de passe</label><input class="input" id="pw-conf" type="password" autocomplete="new-password" required></div>
              <p class="form-error" id="pw-err" role="alert" hidden></p>
              <button type="submit" class="btn btn-primary">Changer le mot de passe</button>
            </form>
          </section>
          <section class="card" aria-label="Récupération du compte">
            <h2>Mot de passe oublié ?</h2>
            <p class="muted" style="margin:8px 0 12px">Les codes de récupération permettent de choisir un nouveau mot de passe si vous l'oubliez. <span id="rc-count">…</span></p>
            <button type="button" class="btn btn-soft" data-rc-new>Générer de nouveaux codes</button>
          </section>
        </div>
        <div class="stack">
          <section class="card" aria-label="Voyageurs">
            <h2>Voyageurs de mes voyages</h2>
            <div id="members-box"><p class="muted">Chargement…</p></div>
          </section>
          <section class="card" aria-label="Demandes d'accès" id="access-card" hidden>
            <h2>Demandes d'accès</h2>
            <div id="access-box"><p class="muted">Chargement…</p></div>
          </section>
          <section class="card" aria-label="Appareils connectés">
            <h2>Appareils connectés</h2>
            <div id="dev-box"><p class="muted">Chargement…</p></div>
          </section>
          <section class="card" aria-label="Session">
            <h2>Session</h2>
            <p class="muted" style="margin:8px 0 16px">${user.firstName} · ${user.email}</p>
            <button type="button" class="btn btn-soft" data-logout>Se déconnecter</button>
          </section>
        </div>
      </div>`}
    `);
    if (tab === 'compte') { loadCount(); loadMembers(); loadDevices(); loadAccess(); } else wireBookmarklet();
  };

  // Appareils connectés : sessions ouvertes sur ce compte (cet appareil est repéré ; les autres peuvent être déconnectés).
  const when = (iso) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const loadDevices = async () => {
    const box = el.querySelector('#dev-box');
    if (!box) return;
    try {
      const list = await api.sessions();
      if (!box.isConnected) return;
      box.innerHTML = String(html`<ul class="dev-list">${list.map((d) => html`<li><div><strong>${d.device}</strong>${d.current ? html` <span class="badge badge-ok">Cet appareil</span>` : ''}<span class="muted small-line">Dernière activité : ${when(d.lastSeenAt)}</span></div>${d.current ? '' : html`<button type="button" class="link-btn danger-text" data-dev-close="${d.id}">Déconnecter</button>`}</li>`)}</ul>
        ${list.length > 1 ? html`<button type="button" class="btn btn-soft" data-dev-closeall>Déconnecter tous les autres appareils</button>` : html`<p class="muted small-line">Aucun autre appareil connecté.</p>`}`);
    } catch { if (box.isConnected) box.innerHTML = '<p class="muted">Impossible de charger la liste. Réessayez.</p>'; }
  };

  // Demandes d'accès : visibles seulement pour le propriétaire du site (le serveur refuse les autres).
  const loadAccess = async () => {
    const card = el.querySelector('#access-card');
    const box = el.querySelector('#access-box');
    if (!card) return;
    try {
      const list = await api.accessRequests();
      if (!box.isConnected) return;
      card.hidden = false;
      box.innerHTML = list.length ? String(html`<ul class="dev-list">${list.map((r) => html`<li><div><strong>${r.firstName}</strong><span class="muted small-line">${r.email} · demandé le ${when(r.createdAt)}</span></div>
        <div class="req-actions"><button type="button" class="btn btn-soft btn-sm" data-req-ok="${r.id}">Approuver</button><button type="button" class="link-btn danger-text" data-req-no="${r.id}">Refuser</button></div></li>`)}</ul>`)
        : String(html`<p class="muted">Aucune demande en attente. Envoyez simplement le lien du site : les personnes demandent l'accès depuis l'écran de connexion et vous les approuvez ici.</p>`);
    } catch { /* pas propriétaire : la carte reste masquée */ }
  };

  // Voyageurs : seulement les voyages que j'ai créés (le serveur refuse aussi toute autre demande).
  const loadMembers = async () => {
    const box = el.querySelector('#members-box');
    if (!box) return;
    try {
      const mine = (await api.listTrips()).filter((t) => t.role === 'owner');
      if (!box.isConnected) return;
      const withPeople = mine.filter((t) => t.members.some((m) => m.id !== user.id));
      box.innerHTML = withPeople.length ? String(html`${withPeople.map((t) => html`
        <div class="member-trip"><h3>${t.name}</h3>
          <ul class="share-members">${t.members.filter((m) => m.id !== user.id).map((m) => html`<li><span class="cp-name">${m.firstName}</span><button type="button" class="link-btn danger-text" data-rm-member="${m.id}" data-rm-trip="${t.id}" data-rm-name="${m.firstName}" data-rm-tripname="${t.name}">Retirer</button></li>`)}</ul>
        </div>`)}`) : String(html`<p class="muted">${mine.length ? "Personne d'autre ne participe à vos voyages pour le moment." : "Vous n'avez créé aucun voyage."} Seul le créateur d'un voyage peut en retirer un voyageur.</p>`);
    } catch { if (box.isConnected) box.innerHTML = '<p class="muted">Impossible de charger la liste. Réessayez.</p>'; }
  };

  const loadCount = () => api.recoveryStatus().then((n) => {
    const c = el.querySelector('#rc-count');
    if (c) c.textContent = n > 0 ? `Il vous en reste ${n}.` : "Vous n'avez aucun code : générez-en maintenant.";
  }).catch(() => {});
  const onSubmit = async (e) => {
    if (e.target.id === 'name-form') {
      e.preventDefault();
      const f = e.target; const err = f.querySelector('#nm-err'); const btn = f.querySelector('[type=submit]');
      const show = (m) => { err.textContent = m; err.hidden = !m; };
      const name = f.querySelector('#nm-first').value.trim();
      show('');
      if (!name) return show('Entrez votre prénom.');
      btn.disabled = true;
      try { const u = await api.updateProfile(name); user.firstName = u.firstName; toast('Prénom modifié.'); render(); }
      catch (ex) { show(ex.message || 'Une erreur est survenue.'); btn.disabled = false; }
      return;
    }
    if (e.target.id !== 'pw-form') return;
    e.preventDefault();
    const f = e.target;
    const err = f.querySelector('#pw-err');
    const show = (m) => { err.textContent = m; err.hidden = !m; };
    const cur = f.querySelector('#pw-cur').value, nw = f.querySelector('#pw-new').value, conf = f.querySelector('#pw-conf').value;
    show('');
    if (!cur) return show('Entrez votre mot de passe actuel.');
    if (nw.length < 10) return show('Le nouveau mot de passe doit contenir au moins 10 caractères.');
    if (nw !== conf) return show('La confirmation ne correspond pas au nouveau mot de passe.');
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await api.changePassword(cur, nw, conf);
      f.reset();
      toast('Mot de passe modifié.');
    } catch (ex) { show(ex.message || 'Une erreur est survenue.'); }
    btn.disabled = false;
  };
  el.addEventListener('submit', onSubmit);
  const onClick = (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      try { sessionStorage.setItem(TAB_KEY, tab); } catch { /* facultatif */ }
      return render();
    }
    const pref = e.target.closest('[data-pref]');
    if (pref) {
      const patch = { [pref.dataset.pref]: pref.dataset.val };
      return savePrefs(patch).then((ok) => { if (!ok) toast('Choix appliqué sur cet appareil seulement (connexion au serveur impossible).', 4000, 'warn'); render(); });
    }
    if (e.target.closest('[data-layout-reset]')) return savePrefs({ layout: null }).then(() => toast('Disposition d\'origine rétablie.'));
    const ok = e.target.closest('[data-req-ok]');
    if (ok) return api.approveRequest(ok.dataset.reqOk).then(() => { toast('Accès accordé : la personne peut se connecter.'); loadAccess(); }).catch((ex) => toast(ex.message || 'Action impossible.', 4000, 'error'));
    const no = e.target.closest('[data-req-no]');
    if (no) return confirmDialog({ title: 'Refuser cette demande ?', text: 'La demande sera supprimée.', confirmLabel: 'Refuser', onConfirm: async () => { await api.rejectRequest(no.dataset.reqNo); toast('Demande refusée.'); loadAccess(); } });
    const dc = e.target.closest('[data-dev-close]');
    if (dc) return api.closeSession(dc.dataset.devClose).then(() => { toast('Appareil déconnecté.'); loadDevices(); }).catch((ex) => toast(ex.message || 'Action impossible.', 4000, 'error'));
    if (e.target.closest('[data-dev-closeall]')) {
      return confirmDialog({ title: 'Déconnecter les autres appareils ?', text: 'Tous les appareils sauf celui-ci devront se reconnecter avec le mot de passe.', confirmLabel: 'Déconnecter', onConfirm: async () => { const n = await api.closeOtherSessions(); toast(`${n} appareil${n > 1 ? 's' : ''} déconnecté${n > 1 ? 's' : ''}.`); loadDevices(); } });
    }
    const rm = e.target.closest('[data-rm-member]');
    if (rm) {
      return confirmDialog({
        title: `Retirer ${rm.dataset.rmName} ?`,
        text: `${rm.dataset.rmName} n'aura plus accès au voyage « ${rm.dataset.rmTripname} ». Son compte n'est pas supprimé.`,
        confirmLabel: 'Retirer',
        onConfirm: async () => { await api.removeMember(rm.dataset.rmTrip, rm.dataset.rmMember); toast('Voyageur retiré.'); loadMembers(); },
      });
    }
    if (e.target.closest('[data-rc-new]')) return askNewRecoveryCodes({ onDone: loadCount });
    if (e.target.closest('[data-logout]')) return logout();
    if (e.target.closest('[data-bg-clear]')) {
      setCustomBackground(null);
      if (getTheme().bg === 'perso') setTheme({ bg: 'paysage' });
      render(); return;
    }
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (tile.dataset.bg) { // un fond photo s'affiche avec la couleur Paysage (cartes en verre)
      setTheme({ bg: tile.dataset.bg, color: 'paysage' });
      api.saveTheme({ color: 'paysage' }).catch(() => {});
      render(); return;
    }
    const patch = tile.dataset.mode ? { mode: tile.dataset.mode } : { color: tile.dataset.color };
    setTheme(patch);
    api.saveTheme(patch).catch(() => {}); // enregistré sur le compte ; le choix local reste appliqué en cas d'échec
    render();
    el.querySelector(`.tile[aria-pressed="true"]`)?.focus?.();
  };

  const bm = bookmarkletHref(location.origin);
  const wireBookmarklet = () => {
    const a = el.querySelector('#bm-link');
    if (a) a.setAttribute('href', bm); // posé après coup : le contenu de la page ne transite pas par le gabarit HTML
  };
  const onBmClick = async (e) => {
    if (e.target.closest('#bm-link')) { e.preventDefault(); toast('Glissez ce bouton dans votre barre de favoris, ne cliquez pas dessus ici.'); }
    if (e.target.closest('[data-copy-bm]')) {
      try { await navigator.clipboard.writeText(bm); toast('Code copié : créez un favori et collez-le dans le champ « Adresse ».'); } catch { toast('Copie impossible : glissez le bouton à la place.'); }
    }
  };

  const onFile = async (e) => {
    if (e.target.id !== 'bg-file' || !e.target.files?.[0]) return;
    try {
      const url = await photoToDataUrl(e.target.files[0]);
      if (!setCustomBackground(url)) throw new Error('stockage plein');
      setTheme({ bg: 'perso', color: 'paysage' });
      api.saveTheme({ color: 'paysage' }).catch(() => {});
      render(); wireBookmarklet();
    } catch { toast('Photo illisible ou trop lourde pour ce navigateur. Essayez une autre image.', 5000, 'warn'); }
  };
  el.addEventListener('change', onFile);
  render();
  el.addEventListener('click', onClick);
  el.addEventListener('click', onBmClick);
  return () => { el.removeEventListener('submit', onSubmit); el.removeEventListener('change', onFile); el.removeEventListener('click', onClick); el.removeEventListener('click', onBmClick); };
}
