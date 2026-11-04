import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../client/js/services/simulation.js';
import { summarize, budgetNotice } from '../client/js/services/budget.js';

const trip = { id: 't', budgetEur: 3000 };
const bk = (id, category, amountEur, extra = {}) => ({ id, name: id, category, status: 'reserve', amountEur, payments: [], ...extra });
const bookings = [
  bk('vol', 'billets', 1000, { payments: [{ date: '2026-11-01', amountEur: 400 }] }),
  bk('hotel', 'logement', 1500),
  bk('safari', 'activites', 700, { status: 'a_reserver' }),
  bk('sans-prix', 'autres', null),
];

test('simulateur : sans changement, le scénario égale la réalité', () => {
  const { real, sim, delta } = simulate(trip, bookings);
  assert.equal(sim.forecast, real.forecast);
  assert.equal(real.forecast, 3200);
  assert.deepEqual(delta, { forecast: 0, available: 0 });
});

test('simulateur : retirer, modifier, ajouter, variation et budget', () => {
  const r = simulate(trip, bookings, { excluded: ['safari'], overrides: { hotel: 1200 }, extras: [{ id: 'x1', name: 'Souvenirs', category: 'shopping', amountEur: 150 }] });
  assert.equal(r.sim.forecast, 1000 + 1200 + 150);
  assert.equal(r.sim.available, 3000 - 2350);
  assert.equal(r.delta.forecast, 2350 - 3200);
  const pct = simulate(trip, bookings, { pct: -10, overrides: { hotel: 1500 } });
  assert.equal(pct.sim.forecast, 900 + 1500 + 630, 'la saisie manuelle n\'est pas touchée par le pourcentage');
  assert.equal(simulate(trip, bookings, { budgetEur: 5000 }).sim.available, 5000 - 3200);
});

test('simulateur : paiements réels conservés, valeurs invalides ignorées, données d\'origine intactes', () => {
  const copy = JSON.stringify(bookings);
  const r = simulate(trip, bookings, { overrides: { vol: -5, hotel: NaN }, extras: [{ id: 'x', name: 'n', category: 'autres', amountEur: -3 }], budgetEur: NaN });
  assert.equal(r.sim.paid, 400);
  assert.equal(r.sim.forecast, 3200, 'montants négatifs ou NaN ignorés');
  assert.equal(r.sim.budget, 3000, 'budget invalide : budget réel');
  assert.equal(JSON.stringify(bookings), copy);
});

test('avis de dépassement : seulement si dépassé, et annoncé quand nouveau ou aggravé', () => {
  assert.equal(budgetNotice(summarize(trip, bookings.slice(0, 2))), null, '2 500 € sur 3 000 € : pas de dépassement');
  const over = summarize(trip, bookings); // 3 200 € > 3 000 €
  const n = budgetNotice(over, 0);
  assert.equal(n.overBy, 200);
  assert.equal(n.announce, true);
  assert.match(n.title, /Budget dépassé de/);
  assert.equal(budgetNotice(over, 200).announce, false, 'déjà signalé : pas de répétition');
  assert.equal(budgetNotice(over, 150).announce, true, 'dépassement aggravé : on prévient de nouveau');
  assert.equal(budgetNotice({ ...over, available: 0 }), null, 'budget pile atteint : pas de dépassement');
});
