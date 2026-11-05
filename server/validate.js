// Validation des entrées : chaque fonction renvoie { value } ou { error } (message en français).

import { isSupportedCurrency } from './fx/rates.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CATEGORIES = ['billets', 'logement', 'transport', 'restaurants', 'activites', 'shopping', 'documents', 'autres'];
export const BOOKING_STATUSES = ['reserve', 'a_reserver', 'annule'];
export const PLAN_STATUSES = ['preparation', 'confirme'];

export const isIsoDate = (s) => {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const text = (v, label, { max = 120, required = true } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return required ? { error: `${label} est obligatoire.` } : { value: '' };
  if (s.length > max) return { error: `${label} est trop long (${max} caractères maximum).` };
  return { value: s };
};

const money = (v, label, { nullable = false, max = 10_000_000 } = {}) => {
  if (v === null || v === '' || v === undefined) return nullable ? { value: null } : { error: `${label} est obligatoire.` };
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) return { error: `${label} doit être un montant positif.` };
  return { value: Math.round(n * 100) / 100 };
};

// Regroupe les erreurs de plusieurs champs ; renvoie { value } ou { error }.
function collect(fields) {
  const value = {};
  for (const [key, r] of Object.entries(fields)) {
    if (r.error) return { error: r.error };
    value[key] = r.value;
  }
  return { value };
}

export function validateTrip(body = {}) {
  const r = collect({
    name: text(body.name, 'Le nom du voyage'),
    destination: text(body.destination, 'La destination'),
    country: text(body.country, 'Le pays', { required: false }),
    origin: text(body.origin, 'La ville de départ', { required: false }),
    budgetEur: money(body.budgetEur ?? 0, 'Le budget'),
  });
  if (r.error) return r;
  const v = r.value;
  if (!isIsoDate(body.startDate) || !isIsoDate(body.endDate)) return { error: 'Les dates de départ et de retour sont obligatoires.' };
  if (body.endDate < body.startDate) return { error: 'Le retour ne peut pas être avant le départ.' };
  const travelers = Number(body.travelers ?? 1);
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 50) return { error: 'Le nombre de voyageurs doit être entre 1 et 50.' };
  const planStatus = body.planStatus ?? 'preparation';
  if (!PLAN_STATUSES.includes(planStatus)) return { error: 'Statut du voyage invalide.' };
  return { value: { ...v, startDate: body.startDate, endDate: body.endDate, travelers, planStatus } };
}

// Champs facultatifs : absent (undefined) = inchangé ; vide ou null = effacé.
const optional = (v, parse) => {
  if (v === undefined) return { value: undefined };
  if (v === null || (typeof v === 'string' && v.trim() === '')) return { value: null };
  return parse(v);
};

const sourceUrl = (v) => {
  if (typeof v !== 'string' || v.length > 500) return { error: 'Le lien est invalide (500 caractères maximum).' };
  let u;
  try {
    u = new URL(v.trim());
  } catch {
    return { error: 'Le lien est invalide.' };
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return { error: 'Le lien doit commencer par http:// ou https://.' };
  return { value: u.href };
};

export function validateBooking(body = {}) {
  const r = collect({
    name: text(body.name, 'Le nom de la réservation'),
    amount: money(body.amount, 'Le montant', { nullable: true, max: 100_000_000_000 }),
    location: optional(body.location, (v) => text(v, 'Le lieu', { max: 200 })),
    sourceUrl: optional(body.sourceUrl, sourceUrl),
    startsOn: optional(body.startsOn, (v) => (isIsoDate(v) ? { value: v } : { error: 'La date de début est invalide.' })),
    endsOn: optional(body.endsOn, (v) => (isIsoDate(v) ? { value: v } : { error: 'La date de fin est invalide.' })),
    stopId: optional(body.stopId, (v) => (typeof v === 'string' && UUID.test(v) ? { value: v } : { error: 'Destination invalide.' })),
  });
  if (r.error) return r;
  if (r.value.startsOn && r.value.endsOn && r.value.endsOn < r.value.startsOn) return { error: 'La date de fin ne peut pas être avant le début.' };
  if (!CATEGORIES.includes(body.category)) return { error: 'Catégorie invalide.' };
  const status = body.status ?? 'a_reserver';
  if (!BOOKING_STATUSES.includes(status)) return { error: 'Statut de réservation invalide.' };
  const currency = body.currency === undefined || body.currency === '' ? 'EUR' : body.currency;
  if (!isSupportedCurrency(currency)) return { error: 'Devise non prise en charge.' };
  // Taux manuel facultatif : nombre d'unités de la devise pour 1 €.
  let manualRate = null;
  if (body.rate !== undefined && body.rate !== null && String(body.rate).trim() !== '') {
    const n = Number(String(body.rate).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > 1e7) return { error: 'Le taux de change doit être un nombre positif.' };
    if (currency === 'EUR') return { error: 'Pas de taux de change pour une réservation en euros.' };
    manualRate = n;
  }
  return { value: { ...r.value, category: body.category, status, currency, manualRate, refreshRate: body.refreshRate === true } };
}

export function validatePayment(body = {}) {
  const amount = money(body.amount, 'Le montant payé', { max: 100_000_000_000 });
  if (amount.error) return amount;
  if (amount.value <= 0) return { error: 'Le montant payé doit être supérieur à 0.' };
  if (!isIsoDate(body.date)) return { error: 'La date du paiement est invalide.' };
  return { value: { amount: amount.value, date: body.date } };
}

export function validateFirstName(body = {}) {
  const first = text(body.firstName, 'Le prénom', { max: 60 });
  return first.error ? first : { value: first.value };
}

export function validateRegistration(body = {}) {
  const first = text(body.firstName, 'Le prénom', { max: 60 });
  if (first.error) return first;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 254) return { error: 'Adresse email invalide.' };
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 10) return { error: 'Le mot de passe doit contenir au moins 10 caractères.' };
  if (password.length > 200) return { error: 'Le mot de passe est trop long.' };
  return { value: { firstName: first.value, email, password } };
}

// Prénoms des personnes qui voyagent avec l'utilisateur : 20 au maximum, 40 caractères chacun, sans doublon.
export function validateCompanions(body = {}) {
  if (!Array.isArray(body.names)) return { error: 'La liste des prénoms est invalide.' };
  if (body.names.length > 20) return { error: '20 personnes au maximum.' };
  const names = [];
  for (const raw of body.names) {
    const n = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!n) return { error: 'Un prénom ne peut pas être vide.' };
    if (n.length > 40) return { error: 'Un prénom est trop long (40 caractères maximum).' };
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  return { value: names };
}

export function validateStop(body = {}) {
  const name = text(body.name, "Le nom de la destination", { max: 120 });
  if (name.error) return name;
  if (!isIsoDate(body.startDate) || !isIsoDate(body.endDate)) return { error: "Les dates de la destination sont obligatoires." };
  if (body.endDate < body.startDate) return { error: "La fin de la destination ne peut pas être avant le début." };
  return { value: { name: name.value, startDate: body.startDate, endDate: body.endDate } };
}

// Logement à comparer : nom, lien, prix (devise + taux comme une réservation), note sur 10, remarques.
export function validateStay(body = {}) {
  const r = collect({
    name: text(body.name, 'Le nom du logement', { max: 120 }),
    url: optional(body.url, sourceUrl),
    location: optional(body.location, (v) => text(v, 'Le lieu', { max: 200 })),
    amount: money(body.amount, 'Le prix', { nullable: true, max: 100_000_000_000 }),
    notes: optional(body.notes, (v) => text(v, 'Les remarques', { max: 500 })),
  });
  if (r.error) return r;
  let rating = null;
  if (body.rating !== undefined && body.rating !== null && String(body.rating).trim() !== '') {
    const n = Number(String(body.rating).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 10) return { error: 'La note doit être comprise entre 0 et 10.' };
    rating = Math.round(n * 10) / 10;
  }
  const currency = body.currency === undefined || body.currency === '' ? 'EUR' : body.currency;
  if (!isSupportedCurrency(currency)) return { error: 'Devise non prise en charge.' };
  let manualRate = null;
  if (body.rate !== undefined && body.rate !== null && String(body.rate).trim() !== '') {
    const n = Number(String(body.rate).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > 1e7) return { error: 'Le taux de change doit être un nombre positif.' };
    if (currency === 'EUR') return { error: 'Pas de taux de change pour un prix en euros.' };
    manualRate = n;
  }
  return { value: { ...r.value, rating, currency, manualRate } };
}
