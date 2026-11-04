import { NAV, PLACEHOLDERS } from '../nav.js';
import { html } from '../lib/html.js';

export const title = 'Bientôt';

export async function mount(el, { path }) {
  const item = NAV.find((n) => n.path === path);
  const info = PLACEHOLDERS[path];
  document.title = `${item?.label ?? 'Section'} · Travel Planner`;
  el.innerHTML = String(html`
    <header class="page-head"><div><h1>${item?.label ?? 'Section'}</h1></div></header>
    <section class="card empty">
      <h2>Cette section arrive à l'étape ${info?.step ?? '?'}</h2>
      <p>${info?.text ?? ''}</p>
      <a class="btn btn-soft" href="#/">Retour au dashboard</a>
    </section>`);
  return () => {};
}
