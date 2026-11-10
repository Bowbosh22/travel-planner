// Calculs budgétaires : fonctions pures, sans accès au DOM ni au réseau.
// Règle centrale : une dépense RÉSERVÉE n'est jamais confondue avec une dépense PAYÉE.
//   - prévisionnel actualisé = toutes les réservations non annulées qui ont un montant
//   - payé                   = somme des paiements réellement effectués
//   - reste à payer          = prévisionnel - payé
//   - disponible             = budget initial - prévisionnel
// Les montants sont en euros : le taux de change est figé à l'enregistrement (étape 5).

import { formatEUR, formatShortDate, plural } from '../lib/format.js';

export const CATEGORIES = [
  { id: 'billets', label: 'Billets' },
  { id: 'logement', label: 'Logement' },
  { id: 'transport', label: 'Transport' },
  { id: 'restaurants', label: 'Restaurants' },
  { id: 'activites', label: 'Activités' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'documents', label: 'Documents' },
  { id: 'autres', label: 'Autres dépenses' },
];

export const NEAR_LIMIT_RATIO = 0.75; // alerte « budget bientôt atteint »
export const ABNORMAL_RATIO = 0.5; // une seule dépense au-delà de 50 % du budget

const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);
const paidOf = (booking) => sum(booking.payments ?? [], (p) => p.amountEur);

export function summarize(trip, bookings) {
  const active = bookings.filter((b) => b.status !== 'annule' && b.inBudget !== false); // « détaché du budget » : listé mais non compté
  const priced = active.filter((b) => typeof b.amountEur === 'number');

  const forecast = sum(priced, (b) => b.amountEur);
  const reserved = sum(priced.filter((b) => b.status === 'reserve'), (b) => b.amountEur);
  const paid = sum(priced, paidOf);
  const toPay = Math.max(forecast - paid, 0);
  const available = trip.budgetEur - forecast;

  const ratio = (value) => (trip.budgetEur > 0 ? (value / trip.budgetEur) * 100 : 0);

  const byCategory = CATEGORIES.map((c) => {
    const items = priced.filter((b) => b.category === c.id);
    return { id: c.id, label: c.label, forecast: sum(items, (b) => b.amountEur), paid: sum(items, paidOf) };
  }).filter((c) => c.forecast > 0);

  // Courbe cumulée des paiements, triés par date.
  let running = 0;
  const timeline = priced
    .flatMap((b) => (b.payments ?? []).map((p) => ({ date: p.date, amountEur: p.amountEur })))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => {
      running += p.amountEur;
      return { date: p.date, cumulative: running };
    });

  return {
    budget: trip.budgetEur,
    forecast,
    reserved,
    paid,
    toPay,
    available,
    engagedPct: ratio(forecast),
    paidPct: ratio(paid),
    reservedPct: ratio(Math.max(forecast - paid, 0)),
    byCategory,
    timeline,
    count: active.length,
    alerts: buildAlerts(trip, active, forecast, available, ratio(forecast)),
  };
}

function buildAlerts(trip, active, forecast, available, engagedPct) {
  const alerts = [];

  if (available < 0) {
    alerts.push({ level: 'danger', title: 'Budget dépassé', text: `Dépassement de ${formatEUR(-available)} par rapport au budget initial.` });
  } else if (engagedPct >= NEAR_LIMIT_RATIO * 100) {
    alerts.push({ level: 'warn', title: 'Budget bientôt atteint', text: `Il reste ${formatEUR(available)} disponibles.` });
  }

  const unpaid = active.filter((b) => b.status === 'reserve' && typeof b.amountEur === 'number' && paidOf(b) < b.amountEur);
  if (unpaid.length) {
    const left = sum(unpaid, (b) => b.amountEur - paidOf(b));
    alerts.push({
      level: 'warn',
      title: plural(unpaid.length, 'Réservation non soldée', 'Réservations non soldées'),
      text: `${unpaid.length} ${plural(unpaid.length, 'réservation', 'réservations')} : ${formatEUR(left)} restent à régler.`,
    });
  }

  const noAmount = active.filter((b) => typeof b.amountEur !== 'number');
  if (noAmount.length) {
    alerts.push({
      level: 'warn',
      title: 'Dépense sans montant',
      text: noAmount.length === 1 ? `« ${noAmount[0].name} » n'a pas de prix renseigné.` : `${noAmount.length} éléments n'ont pas de prix renseigné.`,
    });
  }

  const abnormal = active.filter((b) => typeof b.amountEur === 'number' && b.amountEur > ABNORMAL_RATIO * trip.budgetEur);
  for (const b of abnormal) {
    alerts.push({ level: 'warn', title: 'Dépense élevée', text: `« ${b.name} » représente plus de la moitié du budget (${formatEUR(b.amountEur)}).` });
  }

  return alerts;
}

// Avis de dépassement du budget. lastOverBy = dépassement déjà signalé dans cette session (0 si aucun).
// announce = vrai quand le dépassement est nouveau ou s'est aggravé : c'est alors qu'il faut prévenir l'utilisateur.
export function budgetNotice(summary, lastOverBy = 0) {
  const overBy = summary.available < 0 ? Math.round(-summary.available * 100) / 100 : 0;
  if (overBy <= 0) return null;
  return {
    overBy,
    announce: overBy > lastOverBy + 0.004,
    title: `Budget dépassé de ${formatEUR(overBy)}`,
    text: `${formatEUR(summary.forecast)} prévus pour un budget de ${formatEUR(summary.budget)}.`,
  };
}

export function tripTiming(trip, todayIso, daysBetween) {
  const untilStart = daysBetween(todayIso, trip.startDate);
  const untilEnd = daysBetween(todayIso, trip.endDate);
  if (untilStart > 0) return { phase: 'upcoming', days: untilStart, text: `dans ${untilStart} ${plural(untilStart, 'jour', 'jours')}` };
  if (untilEnd >= 0) return { phase: 'ongoing', days: 0, text: 'en cours' };
  return { phase: 'done', days: 0, text: `terminé le ${formatShortDate(trip.endDate)}` };
}
