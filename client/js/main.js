import { NAV } from './nav.js';
import { api } from './api.js';
import { applyTheme, setTheme, watchSystemTheme } from './theme.js';
import { renderSidebar, renderTabbar, openMoreSheet, closeSheet } from './components/nav-ui.js';
import { toast } from './components/toast.js';
import * as dashboard from './pages/dashboard.js';
import * as trips from './pages/trips.js';
import * as bookings from './pages/bookings.js';
import * as settings from './pages/settings.js';
import * as placeholder from './pages/placeholder.js';
import * as login from './pages/login.js';

const view = document.getElementById('view');
const sidebar = document.getElementById('sidebar');
const tabbar = document.getElementById('tabbar');
const sheet = document.getElementById('sheet');

const PAGES = { '/': dashboard, '/voyages': trips, '/reservations': bookings, '/parametres': settings };
let user = null;
let destroyCurrent = () => {};
let token = 0;
let first = true;

async function logout() {
  await api.logout().catch(() => {});
  user = null;
  location.hash = '#/';
  render();
}

function onAuthenticated(u) {
  user = u;
  setTheme(u.theme); // le thème du compte suit l'utilisateur d'un appareil à l'autre
  location.hash = '#/';
  render();
}

async function render() {
  const mine = ++token;
  closeSheet(sheet);
  destroyCurrent();
  destroyCurrent = () => {};

  // Non connecté : écran de connexion seul, sans menu.
  document.body.classList.toggle('auth', !user);
  if (!user) {
    sidebar.innerHTML = '';
    tabbar.innerHTML = '';
    document.title = 'Connexion · Travel Planner';
    destroyCurrent = (await login.mount(view, { onAuthenticated })) ?? (() => {});
    return;
  }

  const path = location.hash.replace(/^#/, '') || '/';
  const known = NAV.some((n) => n.path === path);
  const page = known ? PAGES[path] ?? placeholder : null;

  renderSidebar(sidebar, path);
  renderTabbar(tabbar, path, {
    onImport: () => toast("L'import par lien arrive à l'étape 4."),
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
window.addEventListener('hashchange', () => { if (user) render(); });

try {
  user = await api.me();
  if (user) setTheme(user.theme);
} catch {
  user = null;
}
render();
