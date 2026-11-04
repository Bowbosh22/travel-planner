import { NAV } from './nav.js';
import { applyTheme, watchSystemTheme } from './theme.js';
import { renderSidebar, renderTabbar, openMoreSheet, closeSheet } from './components/nav-ui.js';
import { toast } from './components/toast.js';
import * as dashboard from './pages/dashboard.js';
import * as settings from './pages/settings.js';
import * as placeholder from './pages/placeholder.js';

const view = document.getElementById('view');
const sidebar = document.getElementById('sidebar');
const tabbar = document.getElementById('tabbar');
const sheet = document.getElementById('sheet');

const PAGES = { '/': dashboard, '/parametres': settings };
let destroyCurrent = () => {};
let token = 0;
let first = true;

async function render() {
  const mine = ++token;
  const path = location.hash.replace(/^#/, '') || '/';
  const known = NAV.some((n) => n.path === path);
  const page = known ? PAGES[path] ?? placeholder : null;

  closeSheet(sheet);
  destroyCurrent();
  destroyCurrent = () => {};

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
    const destroy = await page.mount(view, { path });
    if (mine !== token) { destroy?.(); return; } // une navigation plus récente a pris le relais
    destroyCurrent = destroy ?? (() => {});
  } catch (err) {
    console.error(err);
    view.innerHTML = '<section class="card empty"><h2>Une erreur est survenue</h2><p>Rechargez la page. Si le problème persiste, il sera visible dans la console du navigateur.</p></section>';
  }

  if (!first) { window.scrollTo({ top: 0 }); view.focus({ preventScroll: true }); }
  first = false;
}

applyTheme();
watchSystemTheme();
window.addEventListener('hashchange', render);
render();
