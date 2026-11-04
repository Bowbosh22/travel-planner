import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanning, addDays, weekday } from '../client/js/services/planning.js';

const trip = { startDate: '2026-12-12', endDate: '2026-12-14' };
const b = (id, extra) => ({ id, name: id, category: 'autres', status: 'reserve', payments: [], ...extra });

test('planning : réservations réparties par jour, début / milieu / fin', () => {
  const { days, undated } = buildPlanning(trip, [
    b('hotel', { startsOn: '2026-12-12', endsOn: '2026-12-14' }),
    b('resto', { startsOn: '2026-12-13' }),
    b('idee', {}),
    b('annule', { startsOn: '2026-12-12', status: 'annule' }),
  ]);
  assert.deepEqual(days.map((d) => d.date), ['2026-12-12', '2026-12-13', '2026-12-14']);
  assert.deepEqual(days.map((d) => d.items.map((i) => `${i.booking.id}:${i.edge}`)), [['hotel:start'], ['hotel:middle', 'resto:single'], ['hotel:end']]);
  assert.deepEqual(undated.map((x) => x.id), ['idee'], 'sans date : listée à part');
});

test('planning : la plage couvre les réservations hors voyage et les paiements', () => {
  const { days } = buildPlanning(trip, [
    b('vol', { startsOn: '2026-12-11', endsOn: '2026-12-11', payments: [{ date: '2026-11-30', amount: 100, amountEur: 100 }] }),
  ]);
  assert.equal(days[0].date, '2026-11-30');
  assert.equal(days[0].inTrip, false);
  assert.equal(days[0].items[0].kind, 'payment');
  assert.equal(days.at(-1).date, '2026-12-14');
});

test('planning : plage limitée et dates utilitaires', () => {
  assert.equal(buildPlanning({ startDate: '2026-01-01', endDate: '2027-12-31' }, [], { maxDays: 30 }).days.length, 30);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday('2026-12-12'), 6, 'samedi');
});
