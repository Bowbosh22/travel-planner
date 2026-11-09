// Navigation : barre latérale (ordinateur) et barre d'onglets + feuille « Plus » (mobile).
import { NAV } from '../nav.js';
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';

const link = (item, path) => html`<a class="nav-item" href="#${item.path}" data-label="${item.label}" ${item.path === path ? html`aria-current="page"` : ''}>${icon(item.icon)}<span class="nav-label">${item.label}</span></a>`;

export function renderSidebar(el, path) {
  const main = NAV.filter((n) => !n.footer);
  const footer = NAV.filter((n) => n.footer);
  el.innerHTML = String(html`
    <a class="brand" href="#/" data-label="Travel Planner"><span class="brand-mark">${icon('compass', 18)}</span><span class="nav-label">Travel Planner</span></a>
    ${main.map((n) => link(n, path))}
    <div class="sidebar-spacer"></div>
    ${footer.map((n) => link(n, path))}
  `);
}

const TAB_PATHS = new Set(NAV.filter((n) => n.tab).map((n) => n.path));

export function renderTabbar(el, path, { onImport, onMore }) {
  const tab = (item) => html`<a class="tab" href="#${item.path}" ${item.path === path ? html`aria-current="page"` : ''}>${icon(item.icon, 22)}${item.label}</a>`;
  const [home, trips, budget] = ['/', '/voyages', '/budget'].map((p) => NAV.find((n) => n.path === p));
  const moreActive = !TAB_PATHS.has(path);
  el.innerHTML = String(html`
    ${tab(home)}${tab(trips)}
    <button type="button" class="tab-add" data-tab-action="import" aria-label="Importer depuis un lien">${icon('plus', 24)}</button>
    ${tab(budget)}
    <button type="button" class="tab" data-tab-action="more" ${moreActive ? html`aria-current="page"` : ''}>${icon('more', 22)}Plus</button>
  `);
  el.onclick = (e) => {
    const action = e.target.closest('[data-tab-action]')?.dataset.tabAction;
    if (action === 'import') onImport();
    if (action === 'more') onMore();
  };
}

export function openMoreSheet(host, path) {
  const rest = NAV.filter((n) => !TAB_PATHS.has(n.path));
  host.innerHTML = String(html`
    <div class="sheet-backdrop open" data-sheet-close>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Autres sections">
        <div class="sheet-grip"></div>
        ${rest.map((n) => link(n, path))}
      </div>
    </div>
  `);
  const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  host.firstElementChild.addEventListener('click', (e) => {
    if (e.target.matches('[data-sheet-close]') || e.target.closest('a')) close();
  });
  host.querySelector('a')?.focus();
}

export const closeSheet = (host) => { host.innerHTML = ''; };
