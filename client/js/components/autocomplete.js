// Saisie assistée : propose des villes / pays pendant la frappe (clavier et tactile).
// attachPlaces(input, { type: 'city'|'country', onPick(item) }) ; la liste est positionnée sous le champ (position fixe, jamais coupée).
import { api } from '../api.js';

export function attachPlaces(input, { type = 'city', onPick } = {}) {
  const list = document.createElement('ul');
  list.className = 'ac-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  (input.closest('dialog') ?? document.body).append(list);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');

  let items = [];
  let active = -1;
  let timer = null;
  let seq = 0;

  const label = (it) => (type === 'country' ? it.country : it.city);
  const sub = (it) => (type === 'country' ? '' : [it.region, it.country].filter(Boolean).join(', '));

  const place = () => {
    const r = input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    list.style.left = `${r.left}px`;
    list.style.width = `${r.width}px`;
    if (below < 190 && r.top > below) { list.style.top = 'auto'; list.style.bottom = `${window.innerHeight - r.top + 4}px`; list.style.maxHeight = `${Math.min(220, r.top - 12)}px`; }
    else { list.style.bottom = 'auto'; list.style.top = `${r.bottom + 4}px`; list.style.maxHeight = `${Math.min(220, below - 12)}px`; }
  };
  const close = () => { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const mark = () => [...list.children].forEach((li, i) => { li.classList.toggle('on', i === active); if (i === active) li.scrollIntoView({ block: 'nearest' }); });
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    input.value = label(it);
    close();
    onPick?.(it);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const show = () => {
    list.replaceChildren();
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const a = document.createElement('strong'); a.textContent = label(it);
      li.append(a);
      if (sub(it)) { const s = document.createElement('span'); s.textContent = sub(it); li.append(s); }
      // pointerdown : le choix se fait avant que le champ ne perde le focus (important sur téléphone)
      li.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(i); });
      list.append(li);
    });
    if (!items.length) return close();
    place();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const search = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { items = []; return close(); }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await api.suggestPlaces(q, type);
        if (mine !== seq || document.activeElement !== input) return; // réponse périmée
        items = res; active = -1; show();
      } catch { close(); }
    }, 250);
  };

  input.addEventListener('input', search);
  input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= 2) { place(); list.hidden = false; } });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; mark(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  });
  const reposition = () => { if (!list.hidden) place(); };
  window.addEventListener('resize', reposition);
  input.closest('.dialog-body')?.addEventListener('scroll', reposition);
  return { destroy: () => { clearTimeout(timer); window.removeEventListener('resize', reposition); list.remove(); } };
}
