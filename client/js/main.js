import { NAV } from './nav.js';
import { api } from './api.js';
import { applyTheme, setTheme, watchSystemTheme } from './theme.js';
import { renderSidebar, renderTabbar, openMoreSheet, closeSheet } from './components/nav-ui.js';
import { openImport } from './components/import-flow.js';
import * as dashboard from './pages/dashboard.js';
import * as trips from './pages/trips.js';
import * as bookings from './pages/bookings.js';
import * as budget from './pages/budget.js';
import * as simulateur from './pages/simulateur.js';
import * as planning from './pages/planning.js';
import * as carte from './pages/carte.js';
import * as documents from './pages/documents.js';
import * as settings from './pages/settings.js';
import * as placeholder from './pages/placeholder.js';
import * as login from './pages/login.js';
import { takeCapture } from './lib/capture.js';
import { toast } from './components/toast.js';

const view = document.getElementById('view');
const sidebar = document.getElementById('sidebar');
const tabbar = document.getElementById('tabbar');
const sheet = document.getElementById('sheet');

const PAGES = { '/': dashboard, '/voyages': trips, '/reservations': bookings, '/budget': budget, '/simulateur': simulateur, '/planning': planning, '/carte': carte, '/documents': documents, '/parametres': settings };
let user = null;
let destroyCurrent = () => {};
let token = 0;
let first = true;
let pendingInvite = null; // { token, preview } : lien d'invitation ouvert avant connexion
let pendingCapture = takeCapture(); // données du favori « Importer », à présenter après connexion

async function logout() {
  await api.logout().catch(() => {});
  user = null;
  location.hash = '#/';
  render();
}

// Un lien d'invitation (#/invitation/CODE) est lu une fois, puis retiré de la barre d'adresse.
function takeInviteFromHash() {
  const m = location.hash.match(/^#\/invitation\/([A-Za-z0-9_-]{20,64})$/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search + '#/');
  return m[1];
}

async function joinPending() {
  if (!pendingInvite) return;
  const { token } = pendingInvite;
  pendingInvite = null;
  try {
    const r = await api.joinInvite(token);
    toast(r.already ? 'Vous participez déjà à ce voyage.' : 'Vous avez rejoint le voyage !');
  } catch (err) {
    toast(err.message || 'Invitation invalide.', 4000, 'error');
  }
}

async function onAuthenticated(u, { joined = false } = {}) {
  user = u;
  setTheme(u.theme); // le thème du compte suit l'utilisateur d'un appareil à l'autre
  if (joined) { pendingInvite = null; toast('Compte créé : vous avez rejoint le voyage !'); } // inscription via le lien
  else await joinPending();
  location.hash = '#/';
  render();
}

async function render() {
  const mine = ++token;
  closeSheet(sheet);
  destroyCurrent();
  destroyCurrent = () => {};

  // Non connecté : écran de connexion seul, sans menu.
  const inviteToken = takeInviteFromHash();
  if (inviteToken) {
    pendingInvite = { token: inviteToken, preview: null };
    if (user) await joinPending();
    else pendingInvite.preview = await api.getInvite(inviteToken).catch(() => null);
    if (!user && !pendingInvite.preview) { pendingInvite = null; toast('Ce lien d\'invitation n\'est plus valable.', 4000, 'error'); }
    if (mine !== token) return;
  }
  document.body.classList.toggle('auth', !user);
  if (!user) {
    sidebar.innerHTML = '';
    tabbar.innerHTML = '';
    document.title = 'Connexion · Travel Planner';
    destroyCurrent = (await login.mount(view, { onAuthenticated, invite: pendingInvite?.preview ? { ...pendingInvite.preview, token: pendingInvite.token } : null })) ?? (() => {});
    return;
  }

  const path = location.hash.replace(/^#/, '') || '/';
  const known = NAV.some((n) => n.path === path);
  const page = known ? PAGES[path] ?? placeholder : null;

  renderSidebar(sidebar, path);
  renderTabbar(tabbar, path, {
    onImport: () => openImport(),
    onMore: () => openMoreSheet(sheet, path),
  });

  if (!page) {
    document.title = 'Page introuvable · Travel Planner';
    view.innerHTML = '<section class="card empty"><h2>Page introuvable</h2><p>Ce lien ne mène nulle part.</p><a class="btn btn-soft" href="#/">Retour au dashboard</a></section>';
    return;
  }

  document.title = `${NAV.find((n) => n.path === path)?.label ?? page.title} · Travel Planner`;
  try {
    const destroy = await page.mount(view, { path, user, logout });
    if (mine !== token) { destroy?.(); return; } // une navigation plus récente a pris le relais
    destroyCurrent = destroy ?? (() => {});
  } catch (err) {
    console.error(err);
    view.innerHTML = `<section class="card empty"><h2>Une erreur est survenue</h2><p>${err.status === 0 ? err.message : 'Rechargez la page. Si le problème persiste, réessayez plus tard.'}</p></section>`;
  }

  if (pendingCapture) { const c = pendingCapture; pendingCapture = null; openImport({ capture: c }); }
  if (!first) { window.scrollTo({ top: 0 }); view.focus({ preventScroll: true }); }
  first = false;
}

// Session expirée pendant l'utilisation : retour à la connexion.
window.addEventListener('unauthorized', () => {
  if (!user) return;
  user = null;
  render();
});

applyTheme();
watchSystemTheme();
window.addEventListener('hashchange', () => { if (user || /^#\/invitation\//.test(location.hash)) render(); });

try {
  user = await api.me();
  if (user) setTheme(user.theme);
} catch {
  user = null;
}
render();
