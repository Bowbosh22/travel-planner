// Tests d'intégration de l'API : nécessitent une base PostgreSQL de test.
// Lancer avec : DATABASE_URL=postgres://... npm test   (la base est vidée au début !)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createApp } from '../server/app.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL non défini (tests API ignorés)';

let pool, server, base;

// Mini client HTTP avec « cookie jar » : un client = un navigateur.
function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'tp', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, setCookie: set, body: await res.json().catch(() => null) };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p), raw: call };
}

const trip = { name: 'Lisbonne', destination: 'Lisbonne', country: 'Portugal', startDate: '2026-12-12', endDate: '2026-12-19', travelers: 2, budgetEur: 2000 };
const signup = (c, email = 'a@test.fr', extra = {}) => c.post('/api/auth/register', { firstName: 'Ana', email, password: 'motdepasse-long', ...extra });

before(async () => {
  if (skip) return;
  pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  server = createApp(pool, { isProd: false }).listen(0);
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
  const b1 = (await a.post(`/api/trips/${t.id}/bookings`, { category: 'billets', name: 'Vol', amountEur: 400, status: 'reserve' })).body.booking;

  const intruder = client();
  await signup(intruder, 'bob@test.fr');
  assert.equal((await intruder.get('/api/trips')).body.trips.length, 0);
  assert.equal((await intruder.get(`/api/trips/${t.id}/bookings`)).body.bookings.length, 0);
  assert.equal((await intruder.put(`/api/trips/${t.id}`, trip)).status, 404);
  assert.equal((await intruder.del(`/api/trips/${t.id}`)).status, 404);
  assert.equal((await intruder.put(`/api/bookings/${b1.id}`, { category: 'billets', name: 'x', amountEur: 1 })).status, 404);
  assert.equal((await intruder.post(`/api/bookings/${b1.id}/payments`, { amountEur: 10, date: '2026-11-01' })).status, 404);
  assert.equal((await intruder.post(`/api/trips/${t.id}/bookings`, { category: 'billets', name: 'x' })).status, 404);
  assert.equal((await a.get('/api/trips')).body.trips.length, 1, 'rien n\'a été supprimé');
});

test('réservations et paiements : réservé ≠ payé, pas de trop-payé', { skip }, async () => {
  const c = client();
  await c.post('/api/auth/login', { email: 'ana@test.fr', password: 'motdepasse-long' });
  const t = (await c.get('/api/trips')).body.trips[0];
  const hotel = (await c.post(`/api/trips/${t.id}/bookings`, { category: 'logement', name: 'Hôtel', amountEur: '650,50', status: 'reserve' })).body.booking;
  assert.equal(hotel.amountEur, 650.5, 'virgule décimale acceptée');
  assert.deepEqual(hotel.payments, []);

  const noPrice = (await c.post(`/api/trips/${t.id}/bookings`, { category: 'restaurants', name: 'Dîner', amountEur: null })).body.booking;
  assert.equal(noPrice.amountEur, null);
  assert.equal((await c.post(`/api/bookings/${noPrice.id}/payments`, { amountEur: 10, date: '2026-11-01' })).status, 400, 'pas de paiement sans montant');

  const p1 = await c.post(`/api/bookings/${hotel.id}/payments`, { amountEur: 150, date: '2026-10-10' });
  assert.equal(p1.status, 201);
  assert.equal((await c.post(`/api/bookings/${hotel.id}/payments`, { amountEur: 600, date: '2026-10-11' })).status, 400, 'dépasserait le montant');
  assert.equal((await c.post(`/api/bookings/${hotel.id}/payments`, { amountEur: 0, date: '2026-10-11' })).status, 400);
  assert.equal((await c.post(`/api/bookings/${hotel.id}/payments`, { amountEur: 5, date: '2026-13-45' })).status, 400);

  assert.equal((await c.put(`/api/bookings/${hotel.id}`, { category: 'logement', name: 'Hôtel', amountEur: 100 })).status, 400, 'montant < déjà payé');
  assert.equal((await c.put(`/api/bookings/${hotel.id}`, { category: 'logement', name: 'Hôtel', amountEur: null })).status, 400);
  assert.equal((await c.put(`/api/bookings/${hotel.id}`, { category: 'inconnue', name: 'Hôtel', amountEur: 700 })).status, 400);

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
  const b = (await c.post(`/api/trips/${t.id}/bookings`, { category: 'billets', name: 'Vol', amountEur: 100, status: 'reserve' })).body.booking;
  await c.post(`/api/bookings/${b.id}/payments`, { amountEur: 50, date: '2026-11-01' });
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
