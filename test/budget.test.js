import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../client/js/services/budget.js';

const trip = { id: 't', name: 'Test', budgetEur: 2000 };

// Exemple du cahier des charges : 400 + 650 + 250 + 200 = 1 500 € prévus, 900 € payés.
const example = [
  { name: 'Avion', category: 'billets', amountEur: 400, status: 'reserve', payments: [{ date: '2026-09-14', amountEur: 400 }] },
  { name: 'Hôtel', category: 'logement', amountEur: 650, status: 'reserve', payments: [{ date: '2026-10-10', amountEur: 300 }] },
  { name: 'Voiture', category: 'transport', amountEur: 250, status: 'reserve', payments: [{ date: '2026-11-02', amountEur: 100 }] },
  { name: 'Activités', category: 'activites', amountEur: 200, status: 'reserve', payments: [{ date: '2026-11-04', amountEur: 100 }] },
];

test('exemple du cahier des charges', () => {
  const s = summarize(trip, example);
  assert.equal(s.forecast, 1500);
  assert.equal(s.paid, 900);
  assert.equal(s.toPay, 600);
  assert.equal(s.available, 500);
  assert.equal(s.engagedPct, 75);
});

test('réservé et payé ne sont jamais confondus', () => {
  const s = summarize(trip, [{ name: 'Hôtel', category: 'logement', amountEur: 500, status: 'reserve', payments: [] }]);
  assert.equal(s.reserved, 500);
  assert.equal(s.paid, 0);
  assert.equal(s.toPay, 500);
});

test('une réservation annulée sort du prévisionnel', () => {
  const s = summarize(trip, [...example, { name: 'Annulé', category: 'autres', amountEur: 300, status: 'annule', payments: [] }]);
  assert.equal(s.forecast, 1500);
  assert.equal(s.count, 4);
});

test('une dépense sans montant ne compte pas et déclenche une alerte', () => {
  const s = summarize(trip, [...example, { name: 'Dîner', category: 'restaurants', amountEur: null, status: 'a_reserver', payments: [] }]);
  assert.equal(s.forecast, 1500);
  assert.ok(s.alerts.some((a) => a.title === 'Dépense sans montant'));
});

test('alertes de budget : bientôt atteint puis dépassé', () => {
  assert.ok(summarize(trip, example).alerts.some((a) => a.title === 'Budget bientôt atteint'));
  const over = summarize({ ...trip, budgetEur: 1000 }, example);
  assert.ok(over.alerts.some((a) => a.title === 'Budget dépassé'));
  assert.equal(over.available, -500);
});

test('courbe cumulée triée par date', () => {
  const s = summarize(trip, example);
  assert.deepEqual(s.timeline.map((p) => p.cumulative), [400, 700, 800, 900]);
});

test('voyage sans réservation', () => {
  const s = summarize(trip, []);
  assert.equal(s.forecast, 0);
  assert.equal(s.available, 2000);
  assert.deepEqual(s.alerts, []);
});
