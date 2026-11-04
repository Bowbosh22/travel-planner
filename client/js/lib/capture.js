// Import par favori : un petit script lancé DEPUIS LA PAGE que vous regardez (votre navigateur, votre session) lit
// ce qui y est affiché et l'envoie à Travel Planner dans la partie « # » de l'adresse (jamais envoyée à un serveur).
// Rien n'est deviné : un champ introuvable reste vide, et vous vérifiez tout avant l'ajout.
import { CATEGORIES } from '../services/budget.js';

// ⚠ capture() est copiée telle quelle dans le favori (Function.toString) : elle doit rester AUTONOME
// (aucune variable ou import extérieur).
export function capture(doc, loc) {
  var clean = function (s, n) {
    return String(s == null ? '' : s).replace(new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060\\ufeff]', 'g'), ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  };
  var meta = function (sel) {
    var el = doc.querySelector(sel);
    return el ? clean(el.getAttribute('content'), 300) : '';
  };
  var text = function (sel) {
    var el = doc.querySelector(sel);
    return el ? clean(el.textContent, 300) : '';
  };
  var lines = String((doc.body && doc.body.innerText) || '').split('\n').map(function (l) { return clean(l, 300); }).filter(Boolean);

  // 1) Données structurées de la page (JSON-LD)
  var ld = null;
  var scripts = doc.querySelectorAll ? doc.querySelectorAll('script[type="application/ld+json"]') : [];
  for (var i = 0; i < scripts.length && !ld; i++) {
    try {
      var data = JSON.parse(scripts[i].textContent);
      var stack = Array.isArray(data) ? data.slice() : [data];
      while (stack.length && !ld) {
        var o = stack.shift();
        if (!o || typeof o !== 'object') continue;
        if (Array.isArray(o['@graph'])) stack = stack.concat(o['@graph']);
        var type = [].concat(o['@type'] || []).join(' ');
        if (o.name && /Hotel|Lodging|Resort|Apartment|House|Accommodation|VacationRental|Hostel|Restaurant|Place|Event|Product/.test(type)) ld = o;
      }
    } catch (e) { /* JSON invalide : ignoré */ }
  }

  var name = (ld && clean(ld.name, 120)) || text('h1') || meta('meta[property="og:title"]') || clean(doc.title, 120);
  name = clean(name, 120);

  // 2) Lieu : adresse structurée, sinon la ligne qui suit « Où vous serez » / « Where you'll be »
  var location = '';
  if (ld && ld.address) {
    var a = ld.address;
    if (typeof a === 'string') location = a;
    else {
      var country = a.addressCountry && typeof a.addressCountry === 'object' ? a.addressCountry.name : a.addressCountry;
      location = [a.streetAddress, a.addressLocality, country].filter(Boolean).join(', ');
    }
  }
  if (!location) {
    var head = /^(où vous serez|ou vous serez|where you.?ll be|localisation|emplacement|location)$/i;
    for (var k = 0; k < lines.length && !location; k++) {
      if (!head.test(lines[k])) continue;
      for (var j = k + 1; j <= k + 4 && j < lines.length; j++) {
        if (lines[j].length <= 100 && lines[j].indexOf(',') > 0 && !/\d{3}/.test(lines[j])) { location = lines[j]; break; }
      }
    }
  }
  location = clean(location, 200);

  // 3) Prix : la dernière ligne « Total » suivie d'un montant AVEC devise explicite (€, EUR, US$, USD, XAF, XOF)
  var CUR = '(US\\$|USD|€|EUR|XAF|XOF|\\$|F\\s?CFA|FCFA)';
  var AMT = '(\\d[\\d\\s.,]*\\d|\\d)';
  var reA = new RegExp(CUR + '\\s?' + AMT + '(?![\\d])|' + AMT + '\\s?' + CUR, 'i');
  var toCur = function (m) {
    m = m.toUpperCase().replace(/\s/g, '');
    if (m === '€' || m === 'EUR') return 'EUR';
    if (m === 'US$' || m === 'USD') return 'USD';
    if (m === 'XAF' || m === 'XOF') return m;
    return null; // « $ » ou « FCFA » seuls : devise ambiguë, à choisir par l'utilisateur
  };
  var toNum = function (t) {
    t = String(t).replace(/\s/g, '');
    var lc = t.lastIndexOf(','), ld2 = t.lastIndexOf('.');
    if (lc > -1 && ld2 > -1) t = lc > ld2 ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (lc > -1) t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    else if (ld2 > -1 && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    var n = Number(t);
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  var read = function (s) {
    var m = reA.exec(s);
    if (!m) return null;
    var amount = toNum(m[2] || m[3]);
    return amount === null ? null : { amount: amount, currency: toCur(m[1] || m[4]) };
  };
  var price = null;
  for (var p = 0; p < lines.length; p++) {
    if (!/\btotal\b/i.test(lines[p]) || /par nuit|per night|\/\s?nuit/i.test(lines[p])) continue;
    var r = read(lines[p]) || (lines[p].length < 40 && lines[p + 1] ? read(lines[p + 1]) : null);
    if (r) price = { amount: r.amount, currency: r.currency, kind: 'total', label: clean(lines[p] + (read(lines[p]) ? '' : ' ' + lines[p + 1]), 80) };
  }
  if (!price) {
    for (var q = 0; q < lines.length && !price; q++) {
      if (!/par nuit|per night|\/\s?nuit/i.test(lines[q])) continue;
      var rn = read(lines[q]);
      if (rn) price = { amount: rn.amount, currency: rn.currency, kind: 'night', label: clean(lines[q], 80) };
    }
  }

  // 4) Dates : lues dans l'adresse de la page (Airbnb, Booking...), jamais ailleurs
  var qs = new URLSearchParams(loc.search || '');
  var pick = function (keys) {
    for (var x = 0; x < keys.length; x++) { var v = qs.get(keys[x]); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v))) return v; }
    return '';
  };
  var startDate = pick(['check_in', 'checkin', 'checkIn', 'checkin_date']);
  var endDate = pick(['check_out', 'checkout', 'checkOut', 'checkout_date']);
  if (!startDate || !endDate || endDate < startDate) { startDate = ''; endDate = ''; }

  var href = String(loc.href || '').split('#')[0];
  if (href.length > 500) href = loc.origin + loc.pathname;
  var host = String(loc.hostname || '');
  var category = '';
  if ((/(^|\.)airbnb\./i.test(host) && /^\/rooms\//.test(loc.pathname)) || (/(^|\.)booking\.com$/i.test(host) && /^\/hotel\//.test(loc.pathname))) category = 'logement';

  return { v: 1, url: href, name: name, location: location, price: price, startDate: startDate, endDate: endDate, category: category };
}

// Le favori : lance capture() sur la page courante, puis ouvre Travel Planner avec le résultat.
export function bookmarkletHref(origin) {
  const code = `(function(){try{var c=(${capture.toString()})(document,location);var u=${JSON.stringify(origin)}+'/#/importer?d='+encodeURIComponent(JSON.stringify(c));if(!window.open(u,'_blank')){location.href=u;}}catch(e){alert('Import impossible sur cette page.');}})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

// ---- Côté application : les données reçues viennent d'une page tierce (ou d'un lien trafiqué) → tout est revalidé.
const clean = (s, n) => String(s ?? '').replace(new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060\\ufeff]', 'g'), ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const isoDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : '');
const CURRENCIES = ['EUR', 'USD', 'XAF', 'XOF'];

export function readCapture(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  let url = '';
  let host = '';
  try {
    const u = new URL(String(raw.url));
    if (u.protocol === 'http:' || u.protocol === 'https:') { url = u.href.slice(0, 500); host = u.hostname; }
  } catch { /* adresse invalide */ }
  const name = clean(raw.name, 120);
  if (!url && !name) return null;
  const p = raw.price && typeof raw.price === 'object' ? raw.price : null;
  const amount = p && typeof p.amount === 'number' && Number.isFinite(p.amount) && p.amount > 0 && p.amount < 1e9 ? Math.round(p.amount * 100) / 100 : null;
  const start = isoDate(raw.startDate);
  const end = isoDate(raw.endDate);
  return {
    url, host, name,
    location: clean(raw.location, 200),
    category: CATEGORIES.some((c) => c.id === raw.category) ? raw.category : '',
    startDate: start && end && end >= start ? start : '',
    endDate: start && end && end >= start ? end : '',
    price: amount === null ? null : {
      amount,
      currency: CURRENCIES.includes(p.currency) ? p.currency : null,
      kind: p.kind === 'night' ? 'night' : 'total',
      label: clean(p.label, 80),
    },
  };
}

// Lit et efface les données du favori dans l'adresse (#/importer?d=...). Renvoie null s'il n'y en a pas.
export function takeCapture() {
  if (!location.hash.startsWith('#/importer')) return null;
  let result = null;
  try {
    const d = new URLSearchParams(location.hash.split('?')[1] ?? '').get('d');
    if (d && d.length < 20000) result = readCapture(JSON.parse(d));
  } catch { /* données illisibles */ }
  history.replaceState(null, '', location.pathname + location.search + '#/');
  return result;
}
