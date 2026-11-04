// Planning : répartit les réservations (et leurs paiements) jour par jour. Fonctions pures.
const DAY = 86400000;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => toIso(toMs(iso) + n * DAY);
export const weekday = (iso) => new Date(toMs(iso)).getUTCDay(); // 0 = dimanche

// Renvoie { days: [{ date, inTrip, items }], undated: [réservations sans date] }.
// items : { kind: 'booking', booking, edge } (edge : 'single' | 'start' | 'middle' | 'end') ou { kind: 'payment', booking, payment }.
// La plage couvre le voyage et les réservations qui le dépassent (vol la veille...), limitée à maxDays.
export function buildPlanning(trip, bookings, { maxDays = 120 } = {}) {
  const live = bookings.filter((b) => b.status !== 'annule');
  const dated = live.filter((b) => b.startsOn);
  const undated = live.filter((b) => !b.startsOn);

  let first = trip.startDate;
  let last = trip.endDate;
  for (const b of dated) {
    const end = b.endsOn ?? b.startsOn;
    if (b.startsOn < first) first = b.startsOn;
    if (end > last) last = end;
  }
  for (const b of live) for (const p of b.payments ?? []) { if (p.date < first) first = p.date; if (p.date > last) last = p.date; }
  if (last < first) last = first;
  const span = Math.min(Math.round((toMs(last) - toMs(first)) / DAY) + 1, maxDays);

  const days = [];
  for (let i = 0; i < span; i++) {
    const date = addDays(first, i);
    const items = [];
    for (const b of dated) {
      const end = b.endsOn ?? b.startsOn;
      if (date < b.startsOn || date > end) continue;
      const edge = b.startsOn === end ? 'single' : date === b.startsOn ? 'start' : date === end ? 'end' : 'middle';
      items.push({ kind: 'booking', booking: b, edge });
    }
    for (const b of live) for (const p of b.payments ?? []) if (p.date === date) items.push({ kind: 'payment', booking: b, payment: p });
    days.push({ date, inTrip: date >= trip.startDate && date <= trip.endDate, items });
  }
  return { days, undated };
}
