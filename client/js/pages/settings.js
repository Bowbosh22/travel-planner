import { api } from '../api.js';
import { COLORS, MODES, getTheme, setTheme } from '../theme.js';
import { html, raw } from '../lib/html.js';
import { formatEUR } from '../lib/format.js';

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
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const patch = tile.dataset.mode ? { mode: tile.dataset.mode } : { color: tile.dataset.color };
    setTheme(patch);
    api.saveTheme(patch).catch(() => {}); // enregistré sur le compte ; le choix local reste appliqué en cas d'échec
    render();
    el.querySelector(`.tile[aria-pressed="true"]`)?.focus?.();
  };

  render();
  el.addEventListener('click', onClick);
  return () => el.removeEventListener('click', onClick);
}
