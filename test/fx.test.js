import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createFxService, parseFrankfurter, parseCurrencyApi, toEur, round2, isSupportedCurrency, FIXED_RATES, FxError } from '../server/fx/rates.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL non défini';
let pool;
const DAY = new Date('2026-11-04T10:00:00Z');

before(async () => {
  if (skip) return;
  pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});
after(async () => { if (pool) await pool.end(); });
const fresh = () => pool.query('DELETE FROM fx_rates');

test('conversions et arrondis', () => {
  assert.equal(toEur(110, 1.1), 100);
  assert.equal(toEur(100000, 655.957), 152.45);
  assert.equal(toEur(1, 3), 0.33);
  assert.equal(round2(1.005), 1.01);
  assert.equal(FIXED_RATES.XAF, 655.957);
  assert.equal(FIXED_RATES.XOF, 655.957);
});

test('devises prises en charge', () => {
  for (const c of ['EUR', 'USD', 'XAF', 'XOF']) assert.equal(isSupportedCurrency(c), true, c);
  for (const c of ['MAD', 'GBP', 'XYZ', 'usd', '', null, undefined, 'EUR; DROP', 42]) assert.equal(isSupportedCurrency(c), false);
});

test('lecteurs de réponses : valeurs absurdes ou inattendues refusées', () => {
  assert.deepEqual(parseFrankfurter({ date: '2026-11-03', rates: { USD: 1.1 } }, 'USD'), { rate: 1.1, date: '2026-11-03' });
  assert.deepEqual(parseCurrencyApi({ date: '2026-11-04', eur: { usd: 1.1 } }, 'USD'), { rate: 1.1, date: '2026-11-04' });
  for (const bad of [null, {}, { rates: { USD: 0 } }, { rates: { USD: -1 } }, { rates: { USD: 'abc' } }, { rates: { USD: NaN } }, { rates: { USD: 1e12 } }, { rates: { USD: Infinity } }, { rates: [] }]) {
    assert.equal(parseFrankfurter(bad, 'USD'), null);
  }
  assert.equal(parseCurrencyApi({ eur: { usd: '1.1' } }, 'USD'), null);
  assert.equal(parseCurrencyApi({ date: 'hier', eur: { usd: 1.1 } }, 'USD').date, null, 'date illisible ignorée');
});

test('EUR et franc CFA : aucun appel réseau', { skip }, async () => {
  const fx = createFxService(pool, { fetchJson: () => { throw new Error('ne doit pas être appelé'); }, now: () => DAY });
  assert.equal((await fx.getRate('EUR')).rate, 1);
  const cfa = await fx.getRate('XAF');
  assert.equal(cfa.rate, 655.957);
  assert.match(cfa.source, /fixe/);
  assert.equal((await fx.getRate('XOF')).rate, 655.957);
});

test('devise non prise en charge : erreur', { skip }, async () => {
  const fx = createFxService(pool, { fetchJson: async () => ({}), now: () => DAY });
  await assert.rejects(() => fx.getRate('XYZ'), FxError);
});

test('BCE d\'abord, mémorisation du jour (un seul appel)', { skip }, async () => {
  await fresh();
  let calls = 0;
  const fx = createFxService(pool, { fetchJson: async () => { calls += 1; return { date: '2026-11-03', rates: { USD: 1.25 } }; }, now: () => DAY });
  const a = await fx.getRate('USD');
  const b = await fx.getRate('USD');
  assert.equal(a.rate, 1.25);
  assert.equal(b.rate, 1.25);
  assert.match(a.source, /BCE/);
  assert.equal(calls, 1);
});

test('repli : BCE en panne → jsDelivr → pages.dev', { skip }, async () => {
  await fresh();
  const seen = [];
  const fx = createFxService(pool, {
    now: () => DAY,
    fetchJson: async (u) => {
      seen.push(u);
      if (u.includes('frankfurter') || u.includes('jsdelivr')) throw new Error('panne');
      return { date: '2026-11-04', eur: { usd: 1.15 } };
    },
  });
  const r = await fx.getRate('USD');
  assert.equal(r.rate, 1.15);
  assert.match(r.source, /pages\.dev/);
  assert.equal(seen.length, 3);
});

test('réponse invalide d\'une source : on passe à la suivante, jamais de valeur inventée', { skip }, async () => {
  await fresh();
  const fx = createFxService(pool, {
    now: () => DAY,
    fetchJson: async (u) => (u.includes('frankfurter') ? { rates: { USD: -5 } } : u.includes('jsdelivr') ? { eur: { usd: 'beaucoup' } } : { date: '2026-11-04', eur: { usd: 1.2 } }),
  });
  assert.equal((await fx.getRate('USD')).rate, 1.2);
});

test('tout est en panne : dernier taux connu (10 jours), sinon erreur', { skip }, async () => {
  await fresh();
  const ok = createFxService(pool, { fetchJson: async () => ({ date: '2026-11-01', rates: { USD: 1.3 } }), now: () => new Date('2026-11-01T10:00:00Z') });
  await ok.getRate('USD');
  const down = (d) => createFxService(pool, { fetchJson: async () => { throw new Error('panne'); }, now: () => new Date(d) });
  const old = await down('2026-11-05T10:00:00Z').getRate('USD');
  assert.equal(old.rate, 1.3);
  assert.match(old.source, /dernier taux connu/);
  assert.equal(old.date, '2026-11-01', 'la vraie date du taux est indiquée');
  await assert.rejects(() => down('2026-12-01T10:00:00Z').getRate('USD'), (e) => e instanceof FxError && e.code === 'fx_unavailable');
});
