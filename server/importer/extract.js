// Extraction d'informations publiques d'une page : JSON-LD (schema.org), puis Open Graph, puis <title>.
// Règle absolue : on ne renvoie QUE ce qui est écrit dans la page. Rien n'est deviné, déduit ou inventé ;
// un champ introuvable reste vide. Tout le texte est considéré comme non fiable (nettoyé ici, échappé à l'affichage).
import * as cheerio from 'cheerio';

// Caractères de contrôle et invisibles (dont les marques de direction du texte) remplacés par une espace.
const INVISIBLE = new RegExp('[\\u0000-\\u001F\\u007F\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', 'g');
const clean = (v, max) => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

const CATEGORY_BY_TYPE = {
  logement: ['hotel', 'lodgingbusiness', 'resort', 'hostel', 'bedandbreakfast', 'motel', 'apartment', 'vacationrental', 'campground', 'lodgingreservation'],
  restaurants: ['restaurant', 'foodestablishment', 'cafeorcoffeeshop', 'barorpub', 'bakery', 'fastfoodrestaurant', 'foodestablishmentreservation'],
  activites: ['event', 'touristattraction', 'touristtrip', 'museum', 'amusementpark', 'sportsevent', 'musicevent', 'festival', 'eventreservation', 'zoo', 'aquarium'],
  billets: ['flight', 'flightreservation', 'traintrip', 'bustrip', 'boattrip', 'trainreservation', 'busreservation', 'boatreservation'],
  transport: ['rentalcarreservation', 'taxireservation', 'rentalcar'],
  shopping: ['product'],
};
const TYPE_TO_CATEGORY = new Map(Object.entries(CATEGORY_BY_TYPE).flatMap(([cat, types]) => types.map((t) => [t, cat])));
const RESERVATION = /reservation$/;

const typesOf = (node) => []
  .concat(node?.['@type'] ?? [])
  .filter((t) => typeof t === 'string')
  .map((t) => t.split(/[/#]/).pop().toLowerCase());

function* walk(node, depth = 0) {
  if (depth > 6) return;
  if (Array.isArray(node)) for (const n of node) yield* walk(n, depth + 1);
  else if (node && typeof node === 'object') {
    yield node;
    if (node['@graph']) yield* walk(node['@graph'], depth + 1);
  }
}

export function parsePrice(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.replace(dec === '.' ? /,/g : /\./g, '').replace(dec, '.');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1e8 ? Math.round(n * 100) / 100 : null;
}

export function isoDate(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function addressText(a) {
  if (!a) return null;
  if (typeof a === 'string') return clean(a, 200);
  if (Array.isArray(a)) return addressText(a[0]);
  const country = typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry;
  const city = [clean(a.postalCode, 20), clean(a.addressLocality, 80)].filter(Boolean).join(' ');
  return clean([clean(a.streetAddress, 120), city, clean(a.addressRegion, 60), clean(country, 60)].filter(Boolean).join(', '), 200);
}

function priceOf(node) {
  const offers = [].concat(node.offers ?? [], node.priceSpecification ?? []);
  for (const o of [...offers, node]) {
    if (!o || typeof o !== 'object') continue;
    const raw = o.lowPrice ?? o.price ?? o.totalPrice ?? o.priceSpecification?.price;
    const amount = parsePrice(raw);
    if (amount !== null) {
      const cur = clean(o.priceCurrency ?? o.priceSpecification?.priceCurrency ?? node.priceCurrency, 3)?.toUpperCase();
      return { amount, currency: cur && /^[A-Z]{3}$/.test(cur) ? cur : null };
    }
  }
  return null;
}

// Un « nœud » JSON-LD vers des champs ; null si ce n'est pas une entité de voyage.
function fromNode(node) {
  const types = typesOf(node);
  const key = types.find((t) => TYPE_TO_CATEGORY.has(t));
  if (!key) return null;
  const isReservation = RESERVATION.test(key);
  const main = isReservation && typeof node.reservationFor === 'object' ? { ...node.reservationFor } : node;
  const out = { category: TYPE_TO_CATEGORY.get(key) };
  out.name = clean(main.name ?? node.name, 120);
  if (!out.name && key === 'flight') {
    const from = clean(main.departureAirport?.name ?? main.departureAirport?.iataCode, 60);
    const to = clean(main.arrivalAirport?.name ?? main.arrivalAirport?.iataCode, 60);
    if (from && to) out.name = `${from} → ${to}`;
  }
  out.description = clean(main.description ?? node.description, 500);
  out.location = addressText(main.address ?? main.location?.address ?? main.departureAirport?.name) ?? clean(main.location?.name, 200);
  out.startDate = isoDate(node.checkinTime) ?? isoDate(node.startTime) ?? isoDate(main.startDate) ?? isoDate(main.departureTime) ?? isoDate(node.startDate);
  out.endDate = isoDate(node.checkoutTime) ?? isoDate(node.endTime) ?? isoDate(main.endDate) ?? isoDate(main.arrivalTime) ?? isoDate(node.endDate);
  const p = priceOf(node) ?? priceOf(main);
  if (p) { out.amount = p.amount; out.currency = p.currency; }
  return out;
}

export function extract(html, pageUrl) {
  const $ = cheerio.load(html);
  const fields = {};
  const sources = {};
  const take = (key, value, source) => {
    if (value !== null && value !== undefined && value !== '' && fields[key] === undefined) {
      fields[key] = value;
      sources[key] = source;
    }
  };

  // 1) JSON-LD
  $('script[type="application/ld+json"]').each((_i, el) => {
    let data;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      return; // JSON-LD cassé : ignoré, on passe à la suite
    }
    for (const node of walk(data)) {
      const f = fromNode(node);
      if (!f) continue;
      for (const [k, v] of Object.entries(f)) take(k, v, 'json-ld');
      if (fields.name) return false; // première entité de voyage exploitable : suffisant
    }
    return undefined;
  });

  // 2) Open Graph / balises meta
  const meta = (name) => clean($(`meta[property="${name}"], meta[name="${name}"]`).first().attr('content'), 600);
  take('name', clean(meta('og:title'), 120), 'open-graph');
  take('description', clean(meta('og:description') ?? meta('description'), 500), 'open-graph');
  const ogAmount = parsePrice(meta('product:price:amount') ?? meta('og:price:amount'));
  if (ogAmount !== null && fields.amount === undefined) {
    take('amount', ogAmount, 'open-graph');
    const cur = clean(meta('product:price:currency') ?? meta('og:price:currency'), 3)?.toUpperCase();
    take('currency', cur && /^[A-Z]{3}$/.test(cur) ? cur : null, 'open-graph');
  }
  // 3) <title> en dernier recours
  take('name', clean($('title').first().text(), 120), 'title');

  const warnings = [];
  const priceFound = fields.amount !== undefined ? { amount: fields.amount, currency: fields.currency ?? null } : null;
  let amountEur = null;
  if (priceFound) {
    if (priceFound.currency === 'EUR') amountEur = priceFound.amount;
    else if (!priceFound.currency) warnings.push('Prix trouvé sans devise indiquée.');
  }
  delete fields.amount;
  delete fields.currency;
  if (fields.startDate && fields.endDate && fields.endDate < fields.startDate) {
    delete fields.endDate;
    warnings.push('La date de fin trouvée est avant la date de début : ignorée.');
  }

  const found = Object.keys(fields).length + (amountEur !== null ? 1 : 0);
  if (found === 0) warnings.push('Aucune information exploitable sur cette page.');
  return { url: pageUrl, host: new URL(pageUrl).hostname, fields, amountEur, priceFound, sources, warnings, found };
}
