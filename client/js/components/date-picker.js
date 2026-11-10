// Calendrier à la Airbnb / Agoda : les champs date natifs sont remplacés par un calendrier français où l'on clique
// l'arrivée puis le départ (période colorée, nombre de nuits). Le champ natif reste dans la page, caché : formulaires,
// validations et lecture des valeurs ne changent pas. Les couples de champs ci-dessous forment une période ; un champ seul
// (ex. date d'un paiement) ouvre le même calendrier en mode « un jour ».
const PAIRS = [['f-start', 'f-end'], ['b-start', 'b-end'], ['f-from', 'f-to'], ['s-start', 's-end'], ['i-start', 'i-end']];
const ROLE = { start: 'Début', end: 'Fin' };

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null; };
const days = (a, b) => { const p = parse(a); const q = parse(b); return Math.round((Date.UTC(q.y, q.m, q.d) - Date.UTC(p.y, p.m, p.d)) / 86400000); };
const monthLabel = (y, m) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m, 1)));
const fmtDay = (s) => (parse(s) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`)) : '');
const todayIso = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let open = null; // un seul calendrier ouvert à la fois

function monthHtml(y, m, st) {
  const first = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // semaine commençant le lundi
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = Array(first).fill('<span></span>');
  for (let d = 1; d <= count; d++) {
    const v = iso(y, m, d);
    const isS = v === st.start; const isE = v === st.end;
    const inR = st.range && st.start && st.end && v > st.start && v < st.end;
    const cls = ['dp-day', isS || isE ? 'is-edge' : '', inR ? 'in-range' : '', isS && st.end && st.end !== st.start ? 'is-first' : '', isE && st.start && st.end !== st.start ? 'is-last' : '', v === todayIso() ? 'is-today' : ''].filter(Boolean).join(' ');
    cells.push(`<button type="button" class="${cls}" data-day="${v}" aria-pressed="${isS || isE}" aria-label="${esc(fmtDay(v))}">${d}</button>`);
  }
  return `<div class="dp-month"><div class="dp-title">${esc(monthLabel(y, m))}</div>
    <div class="dp-week" aria-hidden="true">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="dp-grid">${cells.join('')}</div></div>`;
}

function openPicker(group, focusRole) {
  if (open) open.close();
  const { inputs, anchor, range } = group; // inputs : { start, end? } ; pour un champ seul, seulement start
  const st = { start: inputs.start.value || '', end: range ? inputs.end.value || '' : '', range };
  let pickRole = focusRole; // champ en cours de choix
  const seed = parse(st[focusRole] || st.start || st.end) ?? parse(inputs.start.dataset.dpSeed) ?? parse(todayIso()); // sinon : début du voyage, puis aujourd'hui
  let view = { y: seed.y, m: seed.m };
  const panel = document.createElement('div');
  panel.className = 'dp-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', range ? 'Choisir les dates' : 'Choisir une date');
  anchor.after(panel);
  const before = `${st.start}|${st.end}`;

  const two = () => panel.parentElement && panel.getBoundingClientRect().width >= 560;
  const draw = () => {
    const nights = range && st.start && st.end && st.end > st.start ? days(st.start, st.end) : 0;
    const n2 = new Date(Date.UTC(view.y, view.m + 1, 1));
    panel.innerHTML = `
      <div class="dp-head">
        <button type="button" class="dp-nav" data-nav="-1" aria-label="Mois précédent">‹</button>
        <div class="dp-sum" aria-live="polite">${range ? `<strong>${st.start ? esc(fmtDay(st.start)) : 'Arrivée'}</strong> → <strong>${st.end ? esc(fmtDay(st.end)) : 'Départ'}</strong>${nights ? ` · ${nights} nuit${nights > 1 ? 's' : ''}` : ''}` : `<strong>${st.start ? esc(fmtDay(st.start)) : 'Choisir un jour'}</strong>`}</div>
        <button type="button" class="dp-nav" data-nav="1" aria-label="Mois suivant">›</button>
      </div>
      <div class="dp-months ${two() ? 'is-two' : ''}">${monthHtml(view.y, view.m, st)}${two() ? monthHtml(n2.getUTCFullYear(), n2.getUTCMonth(), st) : ''}</div>
      <div class="dp-foot"><button type="button" class="btn btn-ghost btn-sm" data-clear>Effacer</button><button type="button" class="btn btn-primary btn-sm" data-done>Valider</button></div>`;
  };

  const sync = () => {
    inputs.start.value = st.start;
    if (range) inputs.end.value = st.end;
    group.refresh();
  };
  const close = (commit = true) => {
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    panel.remove();
    open = null;
    if (commit && `${st.start}|${st.end}` !== before) {
      // Les « change » partent à la fermeture : une page qui se redessine à chaque changement ne détruit pas le calendrier en cours.
      inputs.start.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: 'manual' }));
      if (range) inputs.end.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: 'manual' }));
    }
    (focusRole === 'end' && range ? group.buttons.end : group.buttons.start)?.focus();
  };
  const onOutside = (e) => { if (!panel.contains(e.target) && !group.anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);

  panel.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { const d = new Date(Date.UTC(view.y, view.m + Number(nav.dataset.nav), 1)); view = { y: d.getUTCFullYear(), m: d.getUTCMonth() }; draw(); panel.querySelector(`[data-nav="${nav.dataset.nav}"]`)?.focus(); return; }
    if (e.target.closest('[data-clear]')) { st.start = ''; st.end = ''; pickRole = 'start'; sync(); draw(); return; }
    if (e.target.closest('[data-done]')) { close(); return; }
    const day = e.target.closest('[data-day]')?.dataset.day;
    if (!day) return;
    if (!range) { st.start = day; sync(); close(); return; }
    // Période : 1er clic = arrivée, 2e clic = départ (si antérieur, il devient la nouvelle arrivée).
    if (pickRole === 'end' && st.start && day >= st.start) { st.end = day; sync(); close(); return; }
    st.start = day; st.end = ''; pickRole = 'end'; sync(); draw();
    panel.querySelector(`[data-day="${day}"]`)?.focus();
  });
  draw();
  if (two()) draw(); // mesure faite une fois le panneau en place
  panel.querySelector('[data-day].is-edge, [data-day].is-today, [data-day]')?.focus({ preventScroll: true });
  panel.scrollIntoView({ block: 'nearest' });
  open = { close };
}

function makeButton(input, role, group) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'input date-btn';
  btn.id = `${input.id}-btn`;
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.addEventListener('click', () => openPicker(group, role));
  const label = input.id && document.querySelector(`label[for="${input.id}"]`);
  if (label) label.htmlFor = btn.id;
  input.before(btn);
  return btn;
}

function paint(btn, input, placeholder) {
  btn.textContent = input.value ? fmtDay(input.value) : placeholder;
  btn.classList.toggle('is-empty', !input.value);
}

function enhance(startInput, endInput) {
  const range = Boolean(endInput);
  const anchorOf = (i) => i.closest('.field') ?? i.parentElement;
  const group = { inputs: { start: startInput, end: endInput }, range, buttons: {} };
  // Le calendrier s'affiche sous la ligne des deux champs (après le dernier des deux).
  const a = anchorOf(startInput); const b = endInput ? anchorOf(endInput) : a;
  group.anchor = a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a;
  const ph = range ? { start: 'Arrivée', end: 'Départ' } : { start: 'Choisir un jour' };
  const targets = range ? [['start', startInput], ['end', endInput]] : [['start', startInput]];
  group.refresh = () => targets.forEach(([role, input]) => paint(group.buttons[role], input, ph[role]));
  targets.forEach(([role, input]) => {
    input.dataset.dp = '1';
    input.classList.add('date-native');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    group.buttons[role] = makeButton(input, role, group);
    ['input', 'change'].forEach((ev) => input.addEventListener(ev, group.refresh));
  });
  group.refresh();
}

function scan() {
  const all = [...document.querySelectorAll('input[type="date"]:not([data-dp])')];
  const used = new Set();
  for (const [s, e] of PAIRS) {
    const si = all.find((i) => i.id === s); const ei = all.find((i) => i.id === e);
    if (si && ei && si.closest('form, section, body') === ei.closest('form, section, body')) { enhance(si, ei); used.add(si); used.add(ei); }
  }
  all.filter((i) => !used.has(i) && !i.dataset.dp).forEach((i) => enhance(i, null));
}

export function initDatePickers() {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
}
