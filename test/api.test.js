// Tests d'intégration de l'API : nécessitent une base PostgreSQL de test.
// Lancer avec : DATABASE_URL=postgres://... npm test   (la base est vidée au début !)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createApp } from '../server/app.js';
import { createFxService } from '../server/fx/rates.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL non défini (tests API ignorés)';

let pool, server, base;
// Faux services de taux de change : aucun appel réseau dans les tests.
const rates = { down: false, ecbDown: false };
const fetchJson = async (url) => {
  if (rates.down) throw new Error('hors ligne');
  if (url.includes('frankfurter')) {
    if (rates.ecbDown) throw new Error('BCE en panne');
    return { date: '2026-11-03', rates: { USD: 1.1 } };
  }
  if (url.includes('jsdelivr')) return { date: '2026-11-04', eur: { usd: 1.25 } };
  throw new Error('inconnu');
};

// Faux géocodeur : aucun appel réseau dans les tests.
const geo = { calls: 0, down: false };
const fakeGeocoder = {
  geocode: async (q) => {
    geo.calls += 1;
    if (geo.down) throw new Error('hors ligne');
    if (q.includes('Nulle part')) return null;
    return q.startsWith('Paris') ? { lat: 48.8566, lng: 2.3522 } : { lat: 38.7223, lng: -9.1393, box: [36.9, -9.5, 42.2, -6.2] };
  },
};

// Mini client HTTP avec « cookie jar » : un client = un navigateur.
function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', 'x-requested-with': 'tp', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, setCookie: set, body: await res.json().catch(() => null) };
  };
  const file = async (path) => {
    const res = await fetch(base + path, { headers: { ...(cookie ? { cookie } : {}) } });
    return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  };
  return { file, upload: (p, buf) => call('POST', p, buf), get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p), raw: call };
}

const trip = { name: 'Lisbonne', destination: 'Lisbonne', country: 'Portugal', startDate: '2026-12-12', endDate: '2026-12-19', travelers: 2, budgetEur: 2000 };
const signup = (c, email = 'a@test.fr', extra = {}) => c.post('/api/auth/register', { firstName: 'Ana', email, password: 'motdepasse-long', ...extra });

const fakeImages = { find: async (d) => (d === 'Nullepart' ? [] : [1, 2].map((n) => ({ url: `https://images.unsplash.com/photo-${encodeURIComponent(d)}-${n}`, author: 'Ana Photo', link: 'https://unsplash.com/@ana', source: 'unsplash' }))) };

before(async () => {
  if (skip) return;
  pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  server = createApp(pool, { isProd: false, geocoder: fakeGeocoder, images: fakeImages, suggest: async (q, type) => (q === 'boom' ? Promise.reject(new Error('x')) : type === 'country' ? [{ country: 'Portugal' }] : [{ city: 'Lisbonne', region: 'Lisbonne', country: 'Portugal' }]), weather: { get: async (d) => (d === 'Nullepart' ? null : { tempC: 17, label: 'Peu nuageux', kind: 'partly', timezone: 'Europe/Lisbon' }) }, limits: { registrationsPerHour: 10_000 }, fx: createFxService(pool, { fetchJson, now: () => new Date('2026-11-04T10:00:00Z') }) }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (skip) return;
  server.close();
  await pool.end();
});

test('inscription, connexion, déconnexion', { skip }, async () => {
  const c = client();
  assert.equal((await c.get('/api/auth/me')).body.user, null);
  assert.equal((await signup(c, 'Ana@Test.fr')).status, 201);
  assert.equal((await c.get('/api/auth/me')).body.user.email, 'ana@test.fr');
  assert.equal((await signup(client(), 'ana@test.fr')).status, 409, 'email déjà pris (insensible à la casse)');
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/auth/me')).body.user, null, 'session supprimée côté serveur');

  const again = client();
  assert.equal((await again.post('/api/auth/login', { email: 'ana@test.fr', password: 'mauvais' })).status, 401);
  assert.equal((await again.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' })).status, 200);
});

test('« se souvenir de moi » : cookie persistant seulement si coché', { skip }, async () => {
  const withRemember = await client().post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long', remember: true });
  assert.match(withRemember.setCookie, /Max-Age=2592000/);
  assert.match(withRemember.setCookie, /HttpOnly/);
  assert.match(withRemember.setCookie, /SameSite=Lax/);
  const without = await client().post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  assert.doesNotMatch(without.setCookie, /Max-Age|Expires/);
});

test('mot de passe trop court et email invalide refusés', { skip }, async () => {
  assert.equal((await client().post('/api/auth/register', { firstName: 'X', email: 'x@test.fr', password: 'court' })).status, 400);
  assert.equal((await client().post('/api/auth/register', { firstName: 'X', email: 'pas-un-email', password: 'motdepasse-long' })).status, 400);
});

test('écriture sans l\'en-tête anti-CSRF refusée', { skip }, async () => {
  const res = await client().raw('POST', '/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' }, { 'x-requested-with': '' });
  assert.equal(res.status, 403);
});

test('API protégée sans connexion', { skip }, async () => {
  assert.equal((await client().get('/api/trips')).status, 401);
});

test('voyages : création, modification, validation, suppression', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const created = await c.post('/api/trips', trip);
  assert.equal(created.status, 201);
  assert.equal(created.body.trip.budgetEur, 2000);
  const id = created.body.trip.id;

  assert.equal((await c.post('/api/trips', { ...trip, endDate: '2026-12-01' })).status, 400, 'retour avant départ');
  assert.equal((await c.post('/api/trips', { ...trip, name: ' ' })).status, 400);
  assert.equal((await c.post('/api/trips', { ...trip, budgetEur: -5 })).status, 400);

  const upd = await c.put(`/api/trips/${id}`, { ...trip, budgetEur: 2500, planStatus: 'confirme' });
  assert.equal(upd.body.trip.budgetEur, 2500);
  assert.equal((await c.get('/api/trips')).body.trips.length, 1);

  assert.equal((await c.get('/api/trips/pas-un-uuid/bookings')).status, 404);
  assert.equal((await c.del(`/api/trips/${id}`)).status, 200);
  assert.equal((await c.get('/api/trips')).body.trips.length, 0);
});

test('isolation : un utilisateur ne voit ni ne modifie les données d\'un autre', { skip }, async () => {
  const a = client();
  await a.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = (await a.post('/api/trips', trip)).body.trip;
  const b1 = (await a.post(`/api/trips/${t.id}/bookings`, { category: 'billets', name: 'Vol', amount: 400, status: 'reserve' })).body.booking;

  const intruder = client();
  await signup(intruder, 'bob@test.fr');
  assert.equal((await intruder.get('/api/trips')).body.trips.length, 0);
  assert.equal((await intruder.get(`/api/trips/${t.id}/bookings`)).body.bookings.length, 0);
  assert.equal((await intruder.put(`/api/trips/${t.id}`, trip)).status, 404);
  assert.equal((await intruder.del(`/api/trips/${t.id}`)).status, 404);
  assert.equal((await intruder.put(`/api/bookings/${b1.id}`, { category: 'billets', name: 'x', amount: 1 })).status, 404);
  assert.equal((await intruder.post(`/api/bookings/${b1.id}/payments`, { amount: 10, date: '2026-11-01' })).status, 404);
  assert.equal((await intruder.post(`/api/trips/${t.id}/bookings`, { category: 'billets', name: 'x' })).status, 404);
  assert.equal((await a.get('/api/trips')).body.trips.length, 1, 'rien n\'a été supprimé');
});

test('réservations et paiements : réservé ≠ payé, pas de trop-payé', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = (await c.get('/api/trips')).body.trips[0];
  const hotel = (await c.post(`/api/trips/${t.id}/bookings`, { category: 'logement', name: 'Hôtel', amount: '650,50', status: 'reserve' })).body.booking;
  assert.equal(hotel.amountEur, 650.5, 'virgule décimale acceptée');
  assert.deepEqual(hotel.payments, []);

  const noPrice = (await c.post(`/api/trips/${t.id}/bookings`, { category: 'restaurants', name: 'Dîner', amount: null })).body.booking;
  assert.equal(noPrice.amountEur, null);
  assert.equal((await c.post(`/api/bookings/${noPrice.id}/payments`, { amount: 10, date: '2026-11-01' })).status, 400, 'pas de paiement sans montant');

  const p1 = await c.post(`/api/bookings/${hotel.id}/payments`, { amount: 150, date: '2026-10-10' });
  assert.equal(p1.status, 201);
  assert.equal((await c.post(`/api/bookings/${hotel.id}/payments`, { amount: 600, date: '2026-10-11' })).status, 400, 'dépasserait le montant');
  assert.equal((await c.post(`/api/bookings/${hotel.id}/payments`, { amount: 0, date: '2026-10-11' })).status, 400);
  assert.equal((await c.post(`/api/bookings/${hotel.id}/payments`, { amount: 5, date: '2026-13-45' })).status, 400);

  assert.equal((await c.put(`/api/bookings/${hotel.id}`, { category: 'logement', name: 'Hôtel', amount: 100 })).status, 400, 'montant < déjà payé');
  assert.equal((await c.put(`/api/bookings/${hotel.id}`, { category: 'logement', name: 'Hôtel', amount: null })).status, 400);
  assert.equal((await c.put(`/api/bookings/${hotel.id}`, { category: 'inconnue', name: 'Hôtel', amount: 700 })).status, 400);

  const list = (await c.get(`/api/trips/${t.id}/bookings`)).body.bookings;
  const h = list.find((b) => b.id === hotel.id);
  assert.equal(h.payments.length, 1);
  assert.equal(h.payments[0].amountEur, 150);

  const afterDelete = await c.del(`/api/payments/${h.payments[0].id}`);
  assert.deepEqual(afterDelete.body.booking.payments, []);

  assert.equal((await c.del(`/api/bookings/${hotel.id}`)).status, 200);
});

test('supprimer un voyage supprime ses réservations et paiements', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = (await c.get('/api/trips')).body.trips[0];
  const b = (await c.post(`/api/trips/${t.id}/bookings`, { category: 'billets', name: 'Vol', amount: 100, status: 'reserve' })).body.booking;
  await c.post(`/api/bookings/${b.id}/payments`, { amount: 50, date: '2026-11-01' });
  await c.del(`/api/trips/${t.id}`);
  assert.equal((await pool.query('SELECT count(*)::int n FROM bookings')).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM payments')).rows[0].n, 0);
});

test('thème enregistré sur le compte', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  assert.equal((await c.raw('PATCH', '/api/auth/theme', { color: 'marron', mode: 'sombre' })).status, 200);
  assert.deepEqual((await c.get('/api/auth/me')).body.user.theme, { color: 'marron', mode: 'sombre' });
  assert.equal((await c.raw('PATCH', '/api/auth/theme', { color: 'rouge' })).status, 400);
});

test('import : connexion requise, adresse invalide et adresse interne refusées', { skip }, async () => {
  assert.equal((await client().post('/api/import', { url: 'https://exemple.com' })).status, 401);
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  assert.equal((await c.post('/api/import', { url: 'pas une adresse' })).status, 400);
  assert.equal((await c.post('/api/import', { url: 'file:///etc/passwd' })).status, 400);
  const internal = await c.post('/api/import', { url: 'http://169.254.169.254/latest/meta-data/' });
  assert.equal(internal.status, 422);
  assert.equal(internal.body.code, 'blocked');
  assert.equal((await c.post('/api/import', {})).status, 400);
});

test('import : 10 analyses par minute au maximum', { skip }, async () => {
  const c = client();
  await signup(c, 'rate@test.fr');
  let last;
  for (let i = 0; i < 11; i += 1) last = await c.post('/api/import', { url: 'http://127.0.0.1/' });
  assert.equal(last.status, 429);
});

test('réservation : lieu, dates et lien enregistrés, conservés à la modification, validés', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = (await c.post('/api/trips', trip)).body.trip;
  const created = await c.post(`/api/trips/${t.id}/bookings`, {
    category: 'logement', name: 'Hôtel', amount: 100, status: 'reserve',
    location: 'Lisbonne', startsOn: '2026-12-12', endsOn: '2026-12-19', sourceUrl: 'https://hotel.exemple.com/x?a=1',
  });
  assert.equal(created.status, 201);
  const b = created.body.booking;
  assert.equal(b.location, 'Lisbonne');
  assert.equal(b.startsOn, '2026-12-12');
  assert.equal(b.sourceUrl, 'https://hotel.exemple.com/x?a=1');

  // Modification sans les détails : ils sont conservés.
  const kept = await c.put(`/api/bookings/${b.id}`, { category: 'logement', name: 'Hôtel 2', amount: 100, status: 'reserve' });
  assert.equal(kept.body.booking.location, 'Lisbonne');
  assert.equal(kept.body.booking.endsOn, '2026-12-19');
  // Champ vide : effacé.
  const cleared = await c.put(`/api/bookings/${b.id}`, { category: 'logement', name: 'Hôtel 2', amount: 100, status: 'reserve', location: '' });
  assert.equal(cleared.body.booking.location, null);

  const bad = (extra) => c.post(`/api/trips/${t.id}/bookings`, { category: 'autres', name: 'X', ...extra });
  assert.equal((await bad({ sourceUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await bad({ sourceUrl: 'ftp://exemple.com' })).status, 400);
  assert.equal((await bad({ sourceUrl: 'https://u:p@exemple.com' })).status, 400);
  assert.equal((await bad({ startsOn: '2026-02-30' })).status, 400);
  assert.equal((await bad({ startsOn: '2026-12-20', endsOn: '2026-12-10' })).status, 400);
  assert.equal((await c.put(`/api/bookings/${b.id}`, { category: 'logement', name: 'H', amount: 100, endsOn: '2026-01-01' })).status, 400, 'fin avant le début déjà enregistré');
});

const bookingIn = (tripId, c, body) => c.post(`/api/trips/${tripId}/bookings`, { category: 'logement', name: 'Hôtel', status: 'reserve', ...body });
const freshTrip = async (c) => (await c.post('/api/trips', trip)).body.trip;

test('devises : conversion au taux du jour, figée sur la réservation', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = await freshTrip(c);

  const usd = (await bookingIn(t.id, c, { amount: 110, currency: 'USD' })).body.booking;
  assert.equal(usd.amountEur, 100, '110 USD à 1,10 = 100 €');
  assert.equal(usd.amount, 110);
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.fxRate, 1.1);
  assert.equal(usd.fxDate, '2026-11-03', 'date du taux chez la source');

  const cfa = (await bookingIn(t.id, c, { amount: 655957, currency: 'XAF' })).body.booking;
  assert.equal(cfa.amountEur, 1000, 'parité fixe : 655 957 FCFA = 1 000 €');
  assert.equal(cfa.fxRate, 655.957);
  const cfa2 = (await bookingIn(t.id, c, { amount: 100000, currency: 'XOF' })).body.booking;
  assert.equal(cfa2.amountEur, 152.45);

  // Le taux change ensuite chez la source : la réservation existante ne bouge pas.
  const before = (await c.get(`/api/trips/${t.id}/bookings`)).body.bookings.find((b) => b.id === usd.id);
  assert.equal(before.amountEur, 100);
  const renamed = await c.put(`/api/bookings/${usd.id}`, { category: 'logement', name: 'Renommé', status: 'reserve', amount: 220, currency: 'USD' });
  assert.equal(renamed.body.booking.fxRate, 1.1, 'montant modifié, même devise : taux conservé');
  assert.equal(renamed.body.booking.amountEur, 200);
});

test('devises : taux manuel, devise inconnue, taux invalides', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = await freshTrip(c);
  const manual = (await bookingIn(t.id, c, { amount: 500, currency: 'USD', rate: '50' })).body.booking;
  assert.equal(manual.amountEur, 10);
  assert.equal(manual.fxSource, 'Saisi à la main');
  assert.equal((await bookingIn(t.id, c, { amount: 5, currency: 'XYZ' })).status, 400);
  assert.equal((await bookingIn(t.id, c, { amount: 5, currency: 'MAD' })).status, 400, 'seules EUR, USD et FCFA sont gérées');
  assert.equal((await bookingIn(t.id, c, { amount: 5, currency: 'usd' })).status, 400, 'code en majuscules uniquement');
  assert.equal((await bookingIn(t.id, c, { amount: 5, currency: 'USD', rate: '-3' })).status, 400);
  assert.equal((await bookingIn(t.id, c, { amount: 5, currency: 'USD', rate: 'abc' })).status, 400);
  assert.equal((await bookingIn(t.id, c, { amount: 5, currency: 'EUR', rate: '2' })).status, 400, 'pas de taux pour des euros');
});

test('devises : source indisponible → erreur claire, ou taux déjà mémorisé du jour', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = await freshTrip(c);
  await pool.query('DELETE FROM fx_rates');
  rates.down = true;
  try {
    const fail = await bookingIn(t.id, c, { amount: 100, currency: 'USD' });
    assert.equal(fail.status, 503);
    assert.equal(fail.body.code, 'fx_unavailable');
    assert.match(fail.body.error, /à la main/);
    assert.equal((await bookingIn(t.id, c, { amount: 100, currency: 'USD', rate: '1.2' })).status, 201, 'le taux manuel dépanne');
    assert.equal((await bookingIn(t.id, c, { amount: 100, currency: 'XAF' })).status, 201, 'le franc CFA ne dépend d\'aucune source');
  } finally { rates.down = false; }
  // BCE en panne : repli sur la seconde source ; puis, source coupée, le taux du jour est déjà mémorisé
  rates.ecbDown = true;
  try {
    const b = (await bookingIn(t.id, c, { amount: 125, currency: 'USD' })).body.booking;
    assert.equal(b.fxRate, 1.25);
    assert.match(b.fxSource, /currency-api/);
    rates.down = true;
    assert.equal((await bookingIn(t.id, c, { amount: 12.5, currency: 'USD' })).status, 201);
  } finally { rates.down = false; rates.ecbDown = false; }
});

test('devises : aperçu du taux et liste des devises', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const list = (await c.get('/api/fx')).body.currencies;
  assert.deepEqual(list.map((x) => x.code), ['EUR', 'USD', 'XAF', 'XOF', 'MYR']);
  const r = (await c.get('/api/fx/xaf')).body;
  assert.equal(r.rate, 655.957);
  assert.equal((await c.get('/api/fx/XYZ')).status, 503);
  assert.equal((await client().get('/api/fx/USD')).status, 401);
});

test('paiements en devise : taux figé, total qui tombe juste au centime, pas de trop-payé', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = await freshTrip(c);
  const b = (await bookingIn(t.id, c, { amount: 100000, currency: 'XAF' })).body.booking; // 152,45 €
  assert.equal(b.amountEur, 152.45);
  const pay = (amount, date = '2026-11-01') => c.post(`/api/bookings/${b.id}/payments`, { amount, date });
  assert.equal((await pay(50000)).status, 201);
  const done = await pay(50000);
  const eurs = done.body.booking.payments.map((p) => p.amountEur);
  assert.equal(Math.round(eurs.reduce((s, x) => s + x, 0) * 100), 15245, 'la somme en euros = le montant exact de la réservation');
  assert.equal((await pay(1)).status, 400, 'réservation soldée : plus rien à payer');

  // Suppression du premier paiement : recalcul cohérent
  const first = done.body.booking.payments[0];
  const after = (await c.del(`/api/payments/${first.id}`)).body.booking;
  assert.equal(after.payments.length, 1);
  assert.equal(after.payments[0].amount, 50000);
  assert.equal(after.payments[0].amountEur, 76.22);

  // Devise figée tant qu'il y a des paiements
  assert.equal((await c.put(`/api/bookings/${b.id}`, { category: 'logement', name: 'Hôtel', status: 'reserve', amount: 100000, currency: 'MAD' })).status, 400);
  assert.equal((await c.put(`/api/bookings/${b.id}`, { category: 'logement', name: 'Hôtel', status: 'reserve', amount: 10000, currency: 'XAF' })).status, 400, 'montant < déjà payé');
});

test('devises : actualiser le taux recalcule réservation et paiements', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = await freshTrip(c);
  await pool.query('DELETE FROM fx_rates');
  const b = (await bookingIn(t.id, c, { amount: 1100, currency: 'USD', rate: '11' })).body.booking; // 100 € au taux manuel
  assert.equal(b.amountEur, 100);
  await c.post(`/api/bookings/${b.id}/payments`, { amount: 550, date: '2026-11-01' });
  const refreshed = (await c.put(`/api/bookings/${b.id}`, { category: 'logement', name: 'Hôtel', status: 'reserve', amount: 1100, currency: 'USD', refreshRate: true })).body.booking;
  assert.equal(refreshed.fxRate, 1.1);
  assert.equal(refreshed.amountEur, 1000);
  assert.equal(refreshed.payments[0].amountEur, 500);
});
const round = (n) => Math.round(n * 100) / 100;


// ---- Étape 7 : documents et carte ----
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]);

test('documents : envoi, liste, téléchargement sécurisé, suppression', { skip }, async () => {
  const c = client();
  await signup(c, 'docs@test.fr');
  const t = (await c.post('/api/trips', trip)).body.trip;
  const b = (await c.post(`/api/trips/${t.id}/bookings`, { name: 'Vol', category: 'billets', status: 'reserve', amount: 100 })).body.booking;

  const up = await c.upload(`/api/trips/${t.id}/documents?name=${encodeURIComponent('Billet aller.pdf')}&bookingId=${b.id}`, PDF);
  assert.equal(up.status, 201);
  assert.equal(up.body.document.mime, 'application/pdf');
  assert.equal(up.body.document.name, 'Billet aller.pdf');

  const list = (await c.get(`/api/trips/${t.id}/documents`)).body;
  assert.equal(list.documents.length, 1);
  assert.equal(list.documents[0].bookingName, 'Vol');
  assert.equal(list.usedBytes, PDF.length);

  const file = await c.file(`/api/documents/${up.body.document.id}/file`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(file.buf.equals(PDF));
  const dl = await c.file(`/api/documents/${up.body.document.id}/file?download=1`);
  assert.match(dl.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''Billet%20aller\.pdf$/);

  const png = await c.upload(`/api/trips/${t.id}/documents?name=photo`, PNG);
  assert.equal(png.body.document.name, 'photo.png', 'extension ajoutée d\'après le contenu');
  assert.match((await c.file(`/api/documents/${png.body.document.id}/file`)).headers.get('content-security-policy'), /sandbox/);

  // la réservation supprimée ne supprime pas le document, il reste rattaché au voyage
  await c.del(`/api/bookings/${b.id}`);
  const after = (await c.get(`/api/trips/${t.id}/documents`)).body.documents.find((d) => d.id === up.body.document.id);
  assert.equal(after.bookingId, null);

  assert.equal((await c.del(`/api/documents/${up.body.document.id}`)).status, 200);
  assert.equal((await c.file(`/api/documents/${up.body.document.id}/file`)).status, 404);
  // le voyage supprimé emporte ses documents
  await c.del(`/api/trips/${t.id}`);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM documents')).rows[0].n, 0);
});

test('documents : le contenu décide du type, taille limitée, noms nettoyés', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'docs@test.fr', password: 'motdepasse-long' });
  const t = (await c.post('/api/trips', trip)).body.trip;
  const base = `/api/trips/${t.id}/documents`;
  assert.equal((await c.upload(`${base}?name=virus.pdf`, Buffer.from('<script>alert(1)</script>'))).status, 415, 'faux PDF refusé');
  assert.equal((await c.upload(`${base}?name=x.pdf`, Buffer.from('<svg onload=alert(1)>'))).status, 415, 'SVG refusé');
  assert.equal((await c.upload(base, Buffer.alloc(0))).status, 400);
  const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]);
  assert.equal((await c.upload(base, big)).status, 413);
  assert.equal((await c.upload(`${base}?bookingId=00000000-0000-4000-8000-000000000000`, PDF)).status, 400, 'réservation inconnue');
  const odd = await c.upload(`${base}?name=${encodeURIComponent('../../etc/passwd\u202e<b>.pdf')}`, PDF);
  assert.equal(odd.status, 201);
  assert.doesNotMatch(odd.body.document.name, /[\\/<>\u202e]/);
  // en-tête CSRF obligatoire
  const noCsrf = await fetch(base.replace(/^/, `${'http://127.0.0.1:' + server.address().port}`), { method: 'POST', body: PDF });
  assert.equal(noCsrf.status, 403);
});

test('documents : isolation entre utilisateurs', { skip }, async () => {
  const a = client();
  await a.post('/api/auth/login', { email: 'docs@test.fr', password: 'motdepasse-long' });
  const t = (await a.get('/api/trips')).body.trips[0];
  const doc = (await a.get(`/api/trips/${t.id}/documents`)).body.documents[0];
  const other = client();
  await signup(other, 'autre-docs@test.fr');
  assert.equal((await other.file(`/api/documents/${doc.id}/file`)).status, 404);
  assert.equal((await other.del(`/api/documents/${doc.id}`)).status, 404);
  assert.equal((await other.get(`/api/trips/${t.id}/documents`)).status, 404);
  assert.equal((await other.upload(`/api/trips/${t.id}/documents`, PDF)).status, 404);
  assert.equal((await client().get(`/api/trips/${t.id}/documents`)).status, 401, 'connexion obligatoire');
});

test('carte : lieu géocodé une seule fois, introuvable mémorisé, service en panne sans effet', { skip }, async () => {
  const c = client();
  await signup(c, 'carte@test.fr');
  const t = (await c.post('/api/trips', trip)).body.trip;
  const mk = async (location) => (await c.post(`/api/trips/${t.id}/bookings`, { name: 'Hôtel', category: 'logement', status: 'reserve', amount: 100, ...(location ? { location } : {}) })).body.booking;
  const ok = await mk('Alfama, Lisbonne');
  assert.equal(ok.geoDone, false);
  assert.equal(ok.lat, null);
  geo.calls = 0;
  const g = await c.post(`/api/bookings/${ok.id}/geocode`);
  assert.deepEqual([g.body.found, g.body.lat], [true, 38.7223]);
  await c.post(`/api/bookings/${ok.id}/geocode`);
  assert.equal(geo.calls, 1, 'résultat mémorisé : un seul appel');
  const reload = (await c.get(`/api/trips/${t.id}/bookings`)).body.bookings.find((x) => x.id === ok.id);
  assert.deepEqual([reload.geoDone, reload.lat, reload.lng], [true, 38.7223, -9.1393]);

  // le lieu change : les anciennes coordonnées sont ignorées
  await c.put(`/api/bookings/${ok.id}`, { category: 'logement', name: 'Hôtel', status: 'reserve', amount: 100, location: 'Sintra' });
  const moved = (await c.get(`/api/trips/${t.id}/bookings`)).body.bookings.find((x) => x.id === ok.id);
  assert.deepEqual([moved.geoDone, moved.lat], [false, null]);

  const none = await mk('Nulle part 12');
  assert.equal((await c.post(`/api/bookings/${none.id}/geocode`)).body.found, false);
  assert.equal((await c.get(`/api/trips/${t.id}/bookings`)).body.bookings.find((x) => x.id === none.id).geoDone, true, 'introuvable mémorisé');

  const later = await mk('Porto');
  geo.down = true;
  try {
    assert.equal((await c.post(`/api/bookings/${later.id}/geocode`)).status, 503);
  } finally { geo.down = false; }
  assert.equal((await c.get(`/api/trips/${t.id}/bookings`)).body.bookings.find((x) => x.id === later.id).geoDone, false, 'panne : on pourra réessayer');

  assert.equal((await c.post(`/api/bookings/${(await mk()).id}/geocode`)).status, 400, 'sans lieu');
  const intruder = client();
  await signup(intruder, 'intrus-carte@test.fr');
  assert.equal((await intruder.post(`/api/bookings/${ok.id}/geocode`)).status, 404);
});

// ---- Étape 8 : durcissement ----
test('en-têtes de sécurité : pas de cache sur l\'API, CSP stricte, capteurs coupés', { skip }, async () => {
  const res = await fetch(`${base}/api/auth/me`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('permissions-policy'), /geolocation=\(\)/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  const page = await fetch(`${base}/`);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe/, 'aucun script en ligne autorisé');
  assert.match(csp, /img-src 'self' data: https:\/\/tile\.openstreetmap\.org/);
});

test('limiteur : au-delà du maximum, 429 avec Retry-After ; les autres clés ne sont pas touchées', async () => {
  const { rateLimit } = await import('../server/ratelimit.js');
  let t = 0;
  const mw = rateLimit({ max: 2, windowMs: 1000, key: (r) => r.k, now: () => t });
  const run = (k) => { const out = { status: 200, headers: {} }; const res = { setHeader: (h, v) => { out.headers[h] = v; }, status: (s) => { out.status = s; return { json: () => out }; } }; return mw({ k }, res, () => {}) ?? out; };
  assert.equal(run('a').status, 200);
  assert.equal(run('a').status, 200);
  const blocked = run('a');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['Retry-After'], '1');
  assert.equal(run('b').status, 200);
  t = 1500;
  assert.equal(run('a').status, 200, 'la fenêtre a expiré');
});

test('inscriptions : limitées par adresse, et fermées si ALLOW_REGISTRATION=false', { skip }, async () => {
  process.env.ALLOW_REGISTRATION = 'false';
  try {
    assert.equal((await signup(client(), 'ferme@test.fr')).status, 202);
  } finally { delete process.env.ALLOW_REGISTRATION; }
  // Limite par adresse : une seconde instance de l'application, réglée à 2 inscriptions par heure
  const strict = createApp(pool, { isProd: false, limits: { registrationsPerHour: 2 } }).listen(0);
  try {
    const url = `http://127.0.0.1:${strict.address().port}/api/auth/register`;
    const reg = (n) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'tp' }, body: JSON.stringify({ firstName: 'X', email: `lim${n}@test.fr`, password: 'motdepasse-long' }) });
    assert.equal((await reg(1)).status, 201);
    assert.equal((await reg(2)).status, 201);
    const third = await reg(3);
    assert.equal(third.status, 429);
    assert.ok(third.headers.get('retry-after'));
  } finally { strict.close(); }
});

test('parcours complet : voyage, réservation en dollars, paiement, budget dépassé, suppression', { skip }, async () => {
  const c = client();
  await signup(c, 'parcours@test.fr');
  const t = (await c.post('/api/trips', { ...trip, budgetEur: 1000 })).body.trip;
  const b = (await c.post(`/api/trips/${t.id}/bookings`, { name: 'Hôtel', category: 'logement', status: 'reserve', amount: 1320, currency: 'USD' })).body.booking;
  assert.equal(b.amountEur, 1200, '1 320 $ au taux figé de 1,10');
  const paid = (await c.post(`/api/bookings/${b.id}/payments`, { amount: 660, date: '2026-11-01' })).body.booking;
  assert.equal(paid.payments[0].amountEur, 600);
  const list = (await c.get(`/api/trips/${t.id}/bookings`)).body.bookings;
  assert.equal(list.reduce((s, x) => s + x.amountEur, 0), 1200, 'prévisionnel > budget de 1 000 € : le tableau de bord signalera le dépassement');
  assert.equal((await c.del(`/api/trips/${t.id}`)).status, 200);
  assert.equal((await c.get(`/api/trips/${t.id}/bookings`)).body.bookings.length, 0);
});

test('photo de la destination : trouvée à la création, changée avec la destination, relançable', { skip }, async () => {
  const c = client();
  await signup(c, 'img@test.fr');
  const t = (await c.post('/api/trips', trip)).body.trip;
  assert.match(t.imageUrl, /^https:\/\/images\.unsplash\.com\//);
  assert.equal(t.photos.length, 2);
  assert.equal(t.photos[0].author, 'Ana Photo');
  const moved = (await c.raw('PUT', `/api/trips/${t.id}`, { ...trip, destination: 'Porto' })).body.trip;
  assert.match(moved.imageUrl, /Porto/);
  const none = (await c.post('/api/trips', { ...trip, destination: 'Nullepart' })).body.trip;
  assert.equal(none.imageUrl, null);
  assert.deepEqual(none.photos, []);
  assert.equal((await c.post(`/api/trips/${none.id}/image`, {})).status, 200);
  const other = client();
  await signup(other, 'img2@test.fr');
  assert.equal((await other.post(`/api/trips/${t.id}/image`, {})).status, 404);
});

test('météo de la destination : réservée au propriétaire du voyage', { skip }, async () => {
  const c = client();
  await signup(c, 'meteo@test.fr');
  const t = (await c.post('/api/trips', trip)).body.trip;
  const ok = await c.get(`/api/trips/${t.id}/weather`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.weather.timezone, 'Europe/Lisbon');
  const none = (await c.post('/api/trips', { ...trip, destination: 'Nullepart' })).body.trip;
  assert.equal((await c.get(`/api/trips/${none.id}/weather`)).body.weather, null);
  const other = client();
  await signup(other, 'meteo2@test.fr');
  assert.equal((await other.get(`/api/trips/${t.id}/weather`)).status, 404);
  assert.equal((await c.get('/api/trips/pas-un-id/weather')).status, 404);
});

test('carte de l\'accueil : départ, destination et emprise du pays, mémorisés par voyage', { skip }, async () => {
  const c = client();
  await signup(c, 'geo-trip@test.fr');
  const t = (await c.post('/api/trips', { ...trip, origin: 'Paris' })).body.trip;
  assert.equal(t.origin, 'Paris');
  assert.equal(t.geo, null);
  assert.equal(t.geoDone, false);
  const before = geo.calls;
  const g = await c.post(`/api/trips/${t.id}/geo`);
  assert.equal(g.status, 200);
  assert.equal(g.body.geo.origin.lat, 48.8566);
  assert.deepEqual(g.body.geo.box, [36.9, -9.5, 42.2, -6.2]);
  const used = geo.calls - before;
  await c.post(`/api/trips/${t.id}/geo`);
  assert.equal(geo.calls - before, used, 'second appel : aucun nouveau géocodage');
  const trips = (await c.get('/api/trips')).body.trips;
  assert.equal(trips.find((x) => x.id === t.id).geoDone, true);
  const moved = (await c.raw('PUT', `/api/trips/${t.id}`, { ...trip, origin: 'Paris', destination: 'Porto' })).body.trip;
  assert.equal(moved.geo, null, 'destination changée : coordonnées à recalculer');
  const none = (await c.post('/api/trips', { ...trip, destination: 'Nulle part', country: '' })).body.trip;
  assert.equal((await c.post(`/api/trips/${none.id}/geo`)).body.geo.dest, null);
  geo.down = true;
  try { assert.equal((await c.post(`/api/trips/${moved.id}/geo`)).status, 503); } finally { geo.down = false; }
  const other = client();
  await signup(other, 'geo-trip2@test.fr');
  assert.equal((await other.post(`/api/trips/${t.id}/geo`)).status, 404);
});

test('personnes qui voyagent avec moi : prénoms nettoyés, nombre de voyageurs ajusté, propriétaire seulement', { skip }, async () => {
  const c = client();
  await signup(c, 'people@test.fr');
  const t = (await c.post('/api/trips', { ...trip, travelers: 1 })).body.trip;
  assert.deepEqual(t.companions, []);
  const r = await c.raw('PUT', `/api/trips/${t.id}/companions`, { names: ['  Sarah ', 'Karim', 'sarah', 'Jean   Luc'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.trip.companions, ['Sarah', 'Karim', 'Jean Luc']);
  assert.equal(r.body.trip.travelers, 4, '1 + 3 prénoms');
  const less = (await c.raw('PUT', `/api/trips/${t.id}/companions`, { names: ['Sarah'] })).body.trip;
  assert.equal(less.travelers, 4, 'ne redescend pas tout seul');
  assert.deepEqual((await c.get('/api/trips')).body.trips.find((x) => x.id === t.id).companions, ['Sarah']);
  const html = (await c.raw('PUT', `/api/trips/${t.id}/companions`, { names: ['<b>Zoé</b>'] })).body.trip;
  assert.deepEqual(html.companions, ['<b>Zoé</b>'], 'stocké tel quel (échappé à l\'affichage)');
  assert.equal((await c.raw('PUT', `/api/trips/${t.id}/companions`, { names: ['  '] })).status, 400);
  assert.equal((await c.raw('PUT', `/api/trips/${t.id}/companions`, { names: ['x'.repeat(41)] })).status, 400);
  assert.equal((await c.raw('PUT', `/api/trips/${t.id}/companions`, { names: Array.from({ length: 21 }, (_, i) => `P${i}`) })).status, 400);
  assert.equal((await c.raw('PUT', `/api/trips/${t.id}/companions`, { names: 'Sarah' })).status, 400);
  const other = client();
  await signup(other, 'people2@test.fr');
  assert.equal((await other.raw('PUT', `/api/trips/${t.id}/companions`, { names: ['Intrus'] })).status, 404);
});

test('voyage partagé : lien d\'invitation, accès commun, suppression réservée au propriétaire', { skip }, async () => {
  const owner = client(); await signup(owner, 'share-own@test.fr', { firstName: 'Olive' });
  const t = (await owner.post('/api/trips', trip)).body.trip;
  assert.equal(t.role, 'owner');
  assert.equal(t.inviteToken ?? null, null);
  const inv = await owner.post(`/api/trips/${t.id}/invite`);
  assert.equal(inv.status, 200);
  const token = (inv.body.trip ?? inv.body).inviteToken;
  assert.ok(token);

  // Aperçu public minimal
  const anon = client();
  const pv = await anon.get(`/api/invites/${token}`);
  assert.equal(pv.status, 200);
  assert.equal(pv.body.invite.ownerFirstName, 'Olive');
  assert.equal(pv.body.invite.budgetEur, undefined);
  assert.equal((await anon.get('/api/invites/' + 'x'.repeat(32))).status, 404);

  // Inscriptions fermées : seule une invitation valide ouvre la porte
  process.env.ALLOW_REGISTRATION = 'false';
  try {
    const bob = client();
    assert.equal((await signup(bob, 'share-bob@test.fr', { firstName: 'Bob' })).status, 202);
    assert.equal((await signup(bob, 'share-bob@test.fr', { firstName: 'Bob', invite: 'y'.repeat(32) })).status, 202);
    assert.equal((await signup(bob, 'share-bob@test.fr', { firstName: 'Bob', invite: token })).status, 201);
    const list = (await bob.get('/api/trips')).body.trips;
    assert.equal(list.length, 1);
    assert.equal(list[0].role, 'member');
    assert.equal(list[0].inviteToken ?? null, null);
    assert.deepEqual(list[0].members.map((m) => m.firstName).sort(), ['Bob', 'Olive']);

    // Le membre modifie tout, sauf supprimer le voyage
    assert.equal((await bob.put(`/api/trips/${t.id}`, { ...trip, name: 'Lisbonne à deux' })).status, 200);
    const b = (await bob.post(`/api/trips/${t.id}/bookings`, { category: 'logement', name: 'Hôtel', amount: 100, status: 'reserve' })).body;
    assert.ok(b.booking ?? b.id);
    assert.equal((await owner.get(`/api/trips/${t.id}/bookings`)).body.bookings.length, 1);
    assert.equal((await bob.del(`/api/trips/${t.id}`)).status, 404);
    assert.equal((await bob.post(`/api/trips/${t.id}/invite`)).status, 404);
    assert.equal((await bob.del(`/api/trips/${t.id}/members/${list[0].members[0].id ?? ''}`)).status, 404);

    // Un tiers sans lien n'a aucun accès
    const eve = client(); const es = await signup(eve, 'share-eve@test.fr', { invite: token }); assert.equal(es.status, 201, JSON.stringify(es.body));
    await eve.del(`/api/trips/${t.id}/membership`);
    assert.equal((await eve.get('/api/trips')).body.trips.length, 0);
    assert.equal((await eve.get(`/api/trips/${t.id}/bookings`)).body.bookings.length, 0);

    // Le propriétaire retire Bob
    const bobId = (await owner.get('/api/trips')).body.trips[0].members.find((m) => m.firstName === 'Bob').id;
    assert.equal((await owner.del(`/api/trips/${t.id}/members/${bobId}`)).status, 200);
    assert.equal((await bob.get('/api/trips')).body.trips.length, 0);
    assert.equal((await bob.get(`/api/trips/${t.id}/bookings`)).body.bookings.length, 0);

    // Révocation du lien
    assert.equal((await owner.del(`/api/trips/${t.id}/invite`)).status, 200);
    assert.equal((await client().get(`/api/invites/${token}`)).status, 404);
    assert.equal((await signup(client(), 'share-zed@test.fr', { invite: token })).status, 202);
  } finally { delete process.env.ALLOW_REGISTRATION; }
});

test('export PDF : récapitulatif réservé aux membres, fichier PDF valide', { skip }, async () => {
  const owner = client(); await signup(owner, 'pdf-own@test.fr', { firstName: 'Paul' });
  const t = (await owner.post('/api/trips', { ...trip, name: 'Été à Lisbonne' })).body.trip;
  await owner.post(`/api/trips/${t.id}/bookings`, { category: 'billets', name: 'Vol Paris → Lisbonne', amount: 1234.5, status: 'reserve', startsOn: '2026-12-12' });
  await owner.post(`/api/trips/${t.id}/bookings`, { category: 'logement', name: 'Hôtel Alfama', amount: 650, status: 'reserve', startsOn: '2026-12-12', endsOn: '2026-12-19', location: 'Rua das Escolas 12' });
  const ok = await owner.file(`/api/trips/${t.id}/export.pdf`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/pdf');
  assert.match(ok.headers.get('content-disposition'), /attachment/);
  assert.equal(ok.buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(ok.buf.length > 1500);
  const stranger = client(); await signup(stranger, 'pdf-str@test.fr');
  assert.equal((await stranger.file(`/api/trips/${t.id}/export.pdf`)).status, 404);
  assert.equal((await client().file(`/api/trips/${t.id}/export.pdf`)).status, 401);
});

test('mot de passe oublié : code de récupération à usage unique, sessions fermées, nouveau lot sur demande', { skip }, async () => {
  const c = client();
  const reg = await signup(c, 'rec@test.fr', { firstName: 'Rémi' });
  assert.equal(reg.status, 201);
  const codes = reg.body.recoveryCodes;
  assert.equal(codes.length, 8);
  assert.match(codes[0], /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal((await c.get('/api/auth/recovery-codes')).body.remaining, 8);

  const other = client();
  assert.equal((await other.post('/api/auth/reset-password', { email: 'rec@test.fr', code: 'AAAAA-BBBBB', password: 'nouveau-mot-de-passe' })).status, 400);
  assert.equal((await other.post('/api/auth/reset-password', { email: 'rec@test.fr', code: codes[0], password: 'court' })).status, 400);
  assert.equal((await other.post('/api/auth/reset-password', { email: 'inconnu@test.fr', code: codes[0], password: 'nouveau-mot-de-passe' })).status, 400);
  // le code fonctionne en minuscules et sans tiret
  const done = await other.post('/api/auth/reset-password', { email: 'REC@test.fr', code: codes[0].toLowerCase().replace('-', ' '), password: 'nouveau-mot-de-passe' });
  assert.equal(done.status, 200);
  assert.equal((await c.get('/api/auth/me')).body.user, null); // ancienne session fermée
  assert.equal((await client().post('/api/auth/login', { email: 'rec@test.fr', password: 'motdepasse-long' })).status, 401);
  const fresh = client();
  assert.equal((await fresh.post('/api/auth/login', { email: 'rec@test.fr', password: 'nouveau-mot-de-passe' })).status, 200);
  // usage unique
  assert.equal((await other.post('/api/auth/reset-password', { email: 'rec@test.fr', code: codes[0], password: 'encore-un-autre-mdp' })).status, 400);
  assert.equal((await fresh.get('/api/auth/recovery-codes')).body.remaining, 7);

  // nouveau lot : mot de passe exigé, les anciens codes cessent de marcher
  assert.equal((await fresh.post('/api/auth/recovery-codes', { password: 'faux-mot-de-passe' })).status, 401);
  const lot = await fresh.post('/api/auth/recovery-codes', { password: 'nouveau-mot-de-passe' });
  assert.equal(lot.body.codes.length, 8);
  assert.equal((await other.post('/api/auth/reset-password', { email: 'rec@test.fr', code: codes[1], password: 'encore-un-autre-mdp' })).status, 400);
  assert.equal((await other.post('/api/auth/reset-password', { email: 'rec@test.fr', code: lot.body.codes[0], password: 'encore-un-autre-mdp' })).status, 200);
  assert.equal((await client().get('/api/auth/recovery-codes')).status, 401);
});

test('mot de passe oublié : essais limités', { skip }, async () => {
  const c = client(); await signup(c, 'rec2@test.fr');
  const x = client();
  let last;
  for (let i = 0; i < 6; i++) last = await x.post('/api/auth/reset-password', { email: 'rec2@test.fr', code: 'ZZZZZ-ZZZZZ', password: 'nouveau-mot-de-passe' });
  assert.equal(last.status, 429);
});

test('suggestions de villes et pays : connexion requise, résultats, panne = liste vide', { skip }, async () => {
  assert.equal((await client().get('/api/geo/suggest?q=lis')).status, 401);
  const c = client();
  assert.equal((await signup(c, `suggest-${Date.now()}@test.fr`)).status, 201);
  const city = await c.get('/api/geo/suggest?type=city&q=lis');
  assert.equal(city.status, 200);
  assert.deepEqual(city.body.results[0], { city: 'Lisbonne', region: 'Lisbonne', country: 'Portugal' });
  assert.deepEqual((await c.get('/api/geo/suggest?type=country&q=port')).body.results, [{ country: 'Portugal' }]);
  const down = await c.get('/api/geo/suggest?q=boom');
  assert.equal(down.status, 200);
  assert.deepEqual(down.body.results, []);
});

test('changement de mot de passe : ancien requis, confirmation, autres sessions fermées', { skip }, async () => {
  const email = `chg-${Date.now()}@test.fr`;
  const a = client(); const other = client();
  assert.equal((await signup(a, email)).status, 201);
  assert.equal((await other.post('/api/auth/login', { email, password: 'motdepasse-long' })).status, 200);
  assert.equal((await client().post('/api/auth/change-password', { current: 'x', password: 'nouveau-mdp-long' })).status, 401);
  assert.equal((await a.post('/api/auth/change-password', { current: 'mauvais-mot-de-passe', password: 'nouveau-mdp-long', confirm: 'nouveau-mdp-long' })).status, 401);
  assert.equal((await a.post('/api/auth/change-password', { current: 'motdepasse-long', password: 'court', confirm: 'court' })).status, 400);
  assert.equal((await a.post('/api/auth/change-password', { current: 'motdepasse-long', password: 'nouveau-mdp-long', confirm: 'autre-chose-long' })).status, 400);
  assert.equal((await a.post('/api/auth/change-password', { current: 'motdepasse-long', password: 'motdepasse-long', confirm: 'motdepasse-long' })).status, 400);
  assert.equal((await a.post('/api/auth/change-password', { current: 'motdepasse-long', password: 'nouveau-mdp-long', confirm: 'nouveau-mdp-long' })).status, 200);
  assert.equal((await a.get('/api/trips')).status, 200); // la session courante reste ouverte
  assert.equal((await other.get('/api/trips')).status, 401); // les autres sont fermées
  assert.equal((await client().post('/api/auth/login', { email, password: 'motdepasse-long' })).status, 401);
  assert.equal((await client().post('/api/auth/login', { email, password: 'nouveau-mdp-long' })).status, 200);
});

test('profil : changement du prénom (validation, connexion requise)', { skip }, async () => {
  assert.equal((await client().raw('PATCH', '/api/auth/profile', { firstName: 'X' })).status, 401);
  const c = client();
  assert.equal((await signup(c, `prof-${Date.now()}@test.fr`)).status, 201);
  assert.equal((await c.raw('PATCH', '/api/auth/profile', { firstName: '   ' })).status, 400);
  assert.equal((await c.raw('PATCH', '/api/auth/profile', { firstName: 'a'.repeat(61) })).status, 400);
  const ok = await c.raw('PATCH', '/api/auth/profile', { firstName: '  Marie  ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.firstName, 'Marie');
  assert.equal((await c.get('/api/auth/me')).body.user.firstName, 'Marie');
});

test('préférences : liste blanche, fusion, retour à la disposition d\'origine', { skip }, async () => {
  assert.equal((await client().raw('PUT', '/api/auth/prefs', { home: 'carte' })).status, 401);
  const c = client();
  const reg = await signup(c, `prefs-${Date.now()}@test.fr`);
  assert.deepEqual(reg.body.user.prefs, {});
  assert.equal((await c.put('/api/auth/prefs', { currency: 'GBP' })).status, 400);
  assert.equal((await c.put('/api/auth/prefs', { home: 'ailleurs' })).status, 400);
  assert.equal((await c.put('/api/auth/prefs', { textSize: 'enorme' })).status, 400);
  assert.equal((await c.put('/api/auth/prefs', { layout: { order: ['hero', 'pirate'], sizes: {} } })).status, 200); // id inconnu ignoré
  assert.equal((await c.put('/api/auth/prefs', { layout: 'x' })).status, 400);
  assert.equal((await c.put('/api/auth/prefs', {})).status, 400);
  await c.put('/api/auth/prefs', { currency: 'XAF', home: 'carte' });
  const r = await c.put('/api/auth/prefs', { textSize: 'large', layout: { order: ['map', 'hero', 'map'], hidden: ['alerts', 'x'], sizes: { hero: 'F', map: 'Z', weather: 'S' } } });
  assert.deepEqual(r.body.prefs, { currency: 'XAF', home: 'carte', textSize: 'large', layout: { order: ['map', 'hero'], hidden: ['alerts'], sizes: { hero: 'F', weather: 'S' } } });
  assert.equal((await c.get('/api/auth/me')).body.user.prefs.home, 'carte');
  const reset = await c.put('/api/auth/prefs', { layout: null });
  assert.equal(reset.body.prefs.layout, undefined);
  assert.equal(reset.body.prefs.currency, 'XAF');
});

test('appareils connectés : liste, déconnexion d\'un appareil, des autres', { skip }, async () => {
  const email = `dev-${Date.now()}@test.fr`;
  const a = client(); const b = client(); const c = client();
  await signup(a, email);
  await b.post('/api/auth/login', { email, password: 'motdepasse-long' });
  await c.post('/api/auth/login', { email, password: 'motdepasse-long' });
  assert.equal((await client().get('/api/auth/sessions')).status, 401);
  const list = (await a.get('/api/auth/sessions')).body.sessions;
  assert.equal(list.length, 3);
  assert.equal(list.filter((s) => s.current).length, 1);
  const me = list.find((s) => s.current);
  const other = list.find((s) => !s.current);
  assert.equal((await a.del(`/api/auth/sessions/${me.id}`)).status, 404); // pas sa propre session ici (voir « Se déconnecter »)
  assert.equal((await a.del('/api/auth/sessions/pas-un-uuid')).status, 404);
  assert.equal((await a.del(`/api/auth/sessions/${other.id}`)).status, 200);
  assert.equal((await a.get('/api/auth/sessions')).body.sessions.length, 2);
  assert.equal((await a.del('/api/auth/sessions')).body.closed, 1);
  assert.equal((await a.get('/api/trips')).status, 200);
  const stillOpen = [(await b.get('/api/trips')).status, (await c.get('/api/trips')).status].filter((s) => s === 200).length;
  assert.equal(stillOpen, 0);
  // un autre compte ne peut pas fermer mes sessions
  const x = client(); await signup(x, `dev2-${Date.now()}@test.fr`);
  assert.equal((await x.del(`/api/auth/sessions/${me.id}`)).status, 404);
  assert.equal((await a.get('/api/trips')).status, 200);
});

test('préférences : effets visuels', { skip }, async () => {
  const c = client(); await signup(c, `fx-${Date.now()}@test.fr`);
  assert.equal((await c.put('/api/auth/prefs', { effects: 'ultra' })).status, 400);
  assert.equal((await c.put('/api/auth/prefs', { effects: 'light' })).body.prefs.effects, 'light');
});

test('étapes : CRUD, réservation rattachée, accès réservé', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = await freshTrip(c);
  const mk = (b) => c.post(`/api/trips/${t.id}/stops`, b);
  assert.equal((await mk({ name: 'Penang', startDate: '2026-12-15', endDate: '2026-12-12' })).status, 400, 'fin avant début');
  assert.equal((await mk({ name: '', startDate: '2026-12-12', endDate: '2026-12-13' })).status, 400);
  const kl = (await mk({ name: 'Kuala Lumpur', startDate: '2026-12-12', endDate: '2026-12-14' })).body.stop;
  const pg = (await mk({ name: 'Penang', startDate: '2026-12-10', endDate: '2026-12-12' })).body.stop;
  const list = (await c.get(`/api/trips/${t.id}/stops`)).body.stops;
  assert.deepEqual(list.map((s) => s.name), ['Penang', 'Kuala Lumpur'], 'triées par date');
  assert.equal(list[0].geoDone, false);
  const g = (await c.post(`/api/stops/${kl.id}/geocode`)).body.stop;
  assert.equal(g.geoDone, true);
  assert.ok(g.lat !== null);
  const calls = geo.calls;
  await c.post(`/api/stops/${kl.id}/geocode`);
  assert.equal(geo.calls, calls, 'résultat mémorisé');
  const renamed = (await c.put(`/api/stops/${kl.id}`, { name: 'Ipoh', startDate: '2026-12-12', endDate: '2026-12-14' })).body.stop;
  assert.equal(renamed.geoDone, false, 'nouveau nom : position à recalculer');

  const b = (await bookingIn(t.id, c, { amount: 50, stopId: kl.id })).body.booking;
  assert.equal(b.stopId, kl.id);
  assert.equal((await bookingIn(t.id, c, { amount: 50, stopId: '00000000-0000-4000-8000-000000000000' })).status, 400);
  assert.equal((await c.put(`/api/bookings/${b.id}/stop`, { stopId: pg.id })).status, 200);
  assert.equal((await c.put(`/api/bookings/${b.id}/stop`, { stopId: null })).status, 200);
  assert.equal((await c.put(`/api/bookings/${b.id}/stop`, { stopId: 'nope' })).status, 400);

  const intruder = client();
  await signup(intruder, 'stops-intruder@test.fr');
  assert.equal((await intruder.get(`/api/trips/${t.id}/stops`)).body.stops.length, 0);
  assert.equal((await intruder.post(`/api/trips/${t.id}/stops`, { name: 'X', startDate: '2026-12-12', endDate: '2026-12-13' })).status, 404);
  assert.equal((await intruder.put(`/api/stops/${kl.id}`, { name: 'X', startDate: '2026-12-12', endDate: '2026-12-13' })).status, 404);
  assert.equal((await intruder.del(`/api/stops/${kl.id}`)).status, 404);

  await c.put(`/api/bookings/${b.id}/stop`, { stopId: kl.id });
  assert.equal((await c.del(`/api/stops/${kl.id}`)).status, 200);
  const after = (await c.get(`/api/trips/${t.id}/bookings`)).body.bookings.find((x) => x.id === b.id);
  assert.equal(after.stopId, null, 'réservation conservée, détachée');
});

test('logements : comparateur trié par prix, retenir / annuler', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = await freshTrip(c);
  const stop = (await c.post(`/api/trips/${t.id}/stops`, { name: 'Langkawi', startDate: '2026-12-14', endDate: '2026-12-17' })).body.stop;
  const add = (b) => c.post(`/api/stops/${stop.id}/stays`, b);
  const cher = (await add({ name: 'Resort', url: 'https://exemple.com/a', amount: 300 })).body.stay;
  const sans = (await add({ name: 'Sans prix', url: 'https://exemple.com/b' })).body.stay;
  const usd = (await add({ name: 'Villa', amount: 110, currency: 'USD', rating: '8,5' })).body.stay;
  const bon = (await add({ name: 'Auberge', amount: 40, notes: 'Près de la plage' })).body.stay;
  assert.equal(usd.amountEur, 100);
  assert.equal(usd.rating, 8.5);
  assert.equal(sans.amountEur, null);
  const order = (await c.get(`/api/trips/${t.id}/stays`)).body.stays.map((s) => s.name);
  assert.deepEqual(order, ['Auberge', 'Villa', 'Resort', 'Sans prix'], 'prix croissant, sans prix à la fin');
  assert.equal((await add({ name: 'X', url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await add({ name: 'X', rating: 11 })).status, 400);

  const up = (await c.put(`/api/stays/${cher.id}`, { name: 'Resort', url: 'https://exemple.com/a', amount: 20 })).body.stay;
  assert.equal(up.amountEur, 20);
  assert.equal((await c.get(`/api/trips/${t.id}/stays`)).body.stays[0].name, 'Resort', 'retriés après modification');

  const ch = (await c.post(`/api/stays/${bon.id}/choose`)).body;
  assert.equal(ch.stay.chosen, true);
  const bk = (await c.get(`/api/trips/${t.id}/bookings`)).body.bookings.find((x) => x.id === ch.bookingId);
  assert.equal(bk.category, 'logement');
  assert.equal(bk.startsOn, '2026-12-14');
  assert.equal(bk.endsOn, '2026-12-17');
  assert.equal(bk.amountEur, 40);
  assert.equal(bk.stopId, stop.id);
  assert.equal((await c.post(`/api/stays/${usd.id}/choose`)).status, 409, 'un seul logement retenu par étape');
  const un = (await c.post(`/api/stays/${bon.id}/unchoose`)).body.stay;
  assert.equal(un.chosen, false);
  assert.equal((await c.get(`/api/trips/${t.id}/bookings`)).body.bookings.some((x) => x.id === ch.bookingId), false);

  const intruder = client();
  await signup(intruder, 'stays-intruder@test.fr');
  assert.equal((await intruder.get(`/api/trips/${t.id}/stays`)).body.stays.length, 0);
  assert.equal((await intruder.post(`/api/stops/${stop.id}/stays`, { name: 'X' })).status, 404);
  assert.equal((await intruder.put(`/api/stays/${bon.id}`, { name: 'X' })).status, 404);
  assert.equal((await intruder.post(`/api/stays/${bon.id}/choose`)).status, 404);
  assert.equal((await intruder.del(`/api/stays/${bon.id}`)).status, 404);
  assert.equal((await c.del(`/api/stays/${bon.id}`)).status, 200);
});

test('demandes d\'accès : inscriptions fermées, le propriétaire approuve ou refuse', { skip }, async () => {
  process.env.ALLOW_REGISTRATION = 'false';
  try {
    assert.equal((await client().get('/api/auth/config')).body.registrationOpen, false);
    const asker = client();
    const r = await signup(asker, 'demande@test.fr', { firstName: 'Dem' });
    assert.equal(r.status, 202);
    assert.equal(r.body.pending, true);
    assert.equal((await asker.get('/api/auth/me')).body.user, null, 'aucune session avant approbation');
    assert.equal((await client().post('/api/auth/login', { email: 'demande@test.fr', password: 'motdepasse-long' })).status, 401, 'pas de compte avant approbation');
    assert.equal((await signup(client(), 'ana@test.fr')).status, 409, 'email déjà inscrit');
    assert.equal((await signup(client(), 'court@test.fr', { password: 'court' })).status, 400);

    const stranger = client();
    await stranger.post('/api/auth/login', { email: 'bob@test.fr', password: 'motdepasse-long' });
    assert.equal((await stranger.get('/api/auth/access-requests')).status, 403, 'réservé au propriétaire');
    assert.equal((await client().get('/api/auth/access-requests')).status, 401);

    const owner = client();
    await owner.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
    const list = (await owner.get('/api/auth/access-requests')).body.requests;
    const req = list.find((x) => x.email === 'demande@test.fr');
    assert.ok(req);
    assert.equal(req.password_hash, undefined);
    assert.equal((await owner.post(`/api/auth/access-requests/${req.id}/approve`)).status, 200);
    assert.equal((await client().post('/api/auth/login', { email: 'demande@test.fr', password: 'motdepasse-long' })).status, 200, 'peut se connecter avec son mot de passe');
    assert.equal((await owner.post(`/api/auth/access-requests/${req.id}/approve`)).status, 404);

    await signup(client(), 'refus@test.fr', { firstName: 'Ref' });
    const no = (await owner.get('/api/auth/access-requests')).body.requests.find((x) => x.email === 'refus@test.fr');
    assert.equal((await owner.del(`/api/auth/access-requests/${no.id}`)).status, 200);
    assert.equal((await client().post('/api/auth/login', { email: 'refus@test.fr', password: 'motdepasse-long' })).status, 401);
  } finally { delete process.env.ALLOW_REGISTRATION; }
});
