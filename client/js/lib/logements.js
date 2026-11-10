// Calculs du comparateur de logements unifié et du budget « et si ? » (fonctions pures, sans accès au réseau).
import { summarize } from '../services/budget.js';

const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
const nightsBetween = (a, b) => (a && b ? Math.max(dayNum(b) - dayNum(a), 0) : 0);

const isLodging = (b) => b.category === 'logement' && b.status !== 'annule';
const counted = (b) => b.inBudget !== false;

// Dates d'un logement : les siennes, sinon celles de sa destination.
const spanOf = (b, stop) => ({ start: b.startsOn || stop?.startDate || null, end: b.endsOn || stop?.endDate || null });

// Une ligne par logement connu d'une destination : réservations « logement » + pistes du comparateur pas encore retenues.
export function lodgingRows(stop, stays, bookings) {
  const chosenIds = new Set(stays.filter((x) => x.stopId === stop.id && x.bookingId).map((x) => x.bookingId));
  const stopNights = nightsBetween(stop.startDate, stop.endDate);
  const rows = bookings.filter((b) => isLodging(b) && b.stopId === stop.id).map((b) => {
    const sp = spanOf(b, stop);
    const nights = nightsBetween(sp.start, sp.end) || stopNights;
    return { key: `b:${b.id}`, kind: 'booking', id: b.id, name: b.name, url: b.sourceUrl, amountEur: b.amountEur, nights, perNight: b.amountEur !== null && nights > 0 ? b.amountEur / nights : null, inBudget: counted(b), fromStay: chosenIds.has(b.id) };
  });
  const pistes = stays.filter((x) => x.stopId === stop.id && !x.bookingId).map((x) => ({
    key: `s:${x.id}`, kind: 'piste', id: x.id, name: x.name, url: x.url, amountEur: x.amountEur, nights: stopNights, perNight: x.amountEur !== null && stopNights > 0 ? x.amountEur / stopNights : null, inBudget: false,
  }));
  return [...rows, ...pistes].sort((a, b) => (a.amountEur ?? Infinity) - (b.amountEur ?? Infinity));
}

// Budget « et si ? » : effet sur le budget restant si cette ligne devenait le logement compté de sa destination.
// Les autres logements comptés de la même destination seraient détachés : on les retire du calcul.
export function whatIf(trip, bookings, stopId, row) {
  if (row.inBudget) return null;
  const base = summarize(trip, bookings);
  const replaced = bookings.filter((b) => isLodging(b) && b.stopId === stopId && counted(b) && typeof b.amountEur === 'number').reduce((n, b) => n + b.amountEur, 0);
  if (row.amountEur === null) return { unknown: true, replaced };
  const after = trip.budgetEur - (base.forecast - replaced + row.amountEur);
  return { unknown: false, replaced, after, delta: after - base.available, over: after < 0 };
}

// Résumé et alertes : logements comptés, budget restant, destinations sans logement, nuits non couvertes, chevauchements.
export function lodgingOverview(trip, stops, stays, bookings) {
  const base = summarize(trip, bookings);
  const lodgings = bookings.filter((b) => isLodging(b) && counted(b) && b.stopId && stops.some((s) => s.id === b.stopId));
  const total = lodgings.reduce((n, b) => n + (typeof b.amountEur === 'number' ? b.amountEur : 0), 0);
  const alerts = [];
  const spans = [];
  for (const s of stops) {
    const mine = lodgings.filter((b) => b.stopId === s.id);
    const nights = nightsBetween(s.startDate, s.endDate);
    if (!mine.length) {
      if (nights > 0) alerts.push({ type: 'none', text: `${s.name} : aucun logement attaché au budget.` });
      continue;
    }
    const covered = new Set();
    for (const b of mine) {
      const sp = spanOf(b, s);
      spans.push({ name: b.name, ...sp });
      if (sp.start && sp.end) for (let d = dayNum(sp.start); d < dayNum(sp.end); d += 1) if (d >= dayNum(s.startDate) && d < dayNum(s.endDate)) covered.add(d);
    }
    const missing = nights - covered.size;
    if (missing > 0) alerts.push({ type: 'gap', text: `${s.name} : ${missing} nuit${missing > 1 ? 's' : ''} sans logement.` });
  }
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const a = spans[i]; const b = spans[j];
      if (a.start && a.end && b.start && b.end && dayNum(a.start) < dayNum(b.end) && dayNum(b.start) < dayNum(a.end)) alerts.push({ type: 'overlap', text: `${a.name} et ${b.name} se chevauchent.` });
    }
  }
  return { total, remaining: base.available, alerts };
}
