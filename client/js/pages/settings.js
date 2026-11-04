import { api } from '../api.js';
import { COLORS, MODES, BACKGROUNDS, getTheme, setTheme, getCustomBackground, setCustomBackground, photoToDataUrl } from '../theme.js';
import { html, raw } from '../lib/html.js';
import { formatEUR } from '../lib/format.js';
import { bookmarkletHref } from '../lib/capture.js';
import { toast } from '../components/toast.js';

export const title = 'Paramètres';

const modeArt = {
  clair: 'background:#F5F7FB',
  sombre: 'background:#0B1220',
  auto: 'background:linear-gradient(90deg,#F5F7FB 50%,#0B1220 50%)',
};

export async function mount(el, { user, logout }) {
  const render = () => {
    const theme = getTheme();
    el.innerHTML = String(html`
      <header class="page-head"><div><h1>Apparence</h1><p>Choisissez le mode et la couleur de l'interface. Le choix est enregistré sur votre compte.</p></div></header>
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
          <section class="card" aria-label="Compte">
            <h2>Compte</h2>
            <p class="muted" style="margin:8px 0 16px">${user.firstName} · ${user.email}</p>
            <button type="button" class="btn btn-soft" data-logout>Se déconnecter</button>
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
      </div>
    `);
  };

  const onClick = (e) => {
    if (e.target.closest('[data-logout]')) return logout();
    if (e.target.closest('[data-bg-clear]')) {
      setCustomBackground(null);
      if (getTheme().bg === 'perso') setTheme({ bg: 'paysage' });
      render(); wireBookmarklet(); return;
    }
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (tile.dataset.bg) { // un fond photo s'affiche avec la couleur Paysage (cartes en verre)
      setTheme({ bg: tile.dataset.bg, color: 'paysage' });
      api.saveTheme({ color: 'paysage' }).catch(() => {});
      render(); wireBookmarklet(); return;
    }
    const patch = tile.dataset.mode ? { mode: tile.dataset.mode } : { color: tile.dataset.color };
    setTheme(patch);
    api.saveTheme(patch).catch(() => {}); // enregistré sur le compte ; le choix local reste appliqué en cas d'échec
    render();
    wireBookmarklet();
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
  wireBookmarklet();
  el.addEventListener('click', onClick);
  el.addEventListener('click', onBmClick);
  return () => { el.removeEventListener('change', onFile); el.removeEventListener('click', onClick); el.removeEventListener('click', onBmClick); };
}
