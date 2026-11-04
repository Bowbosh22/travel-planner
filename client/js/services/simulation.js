// Simulateur : calcule un scénario « et si... » SANS rien modifier ni enregistrer. Fonctions pures.
// scénario = { budgetEur, excluded: [ids], overrides: { id: montant € }, extras: [{ id, name, category, amountEur }], pct }
//  - pct : variation en % appliquée aux réservations dont le montant n'est pas saisi à la main
//  - les paiements déjà faits restent ceux de la réalité
import { summarize } from './budget.js';

const round2 = (n) => Math.round(n * 100) / 100;

export function simulate(trip, bookings, scenario = {}) {
  const { budgetEur = trip.budgetEur, excluded = [], overrides = {}, extras = [], pct = 0 } = scenario;
  const out = new Set(excluded);
  const factor = 1 + pct / 100;

  const lines = bookings
    .filter((b) => !out.has(b.id))
    .map((b) => {
      if (typeof b.amountEur !== 'number') return b;
      const own = overrides[b.id];
      const amountEur = typeof own === 'number' && Number.isFinite(own) && own >= 0 ? round2(own) : round2(b.amountEur * factor);
      return { ...b, amountEur };
    });

  const added = extras
    .filter((e) => Number.isFinite(e.amountEur) && e.amountEur > 0)
    .map((e) => ({ id: e.id, name: e.name, category: e.category, status: 'a_reserver', amountEur: round2(e.amountEur), payments: [] }));

  const real = summarize(trip, bookings);
  const sim = summarize({ ...trip, budgetEur: Number.isFinite(budgetEur) && budgetEur >= 0 ? budgetEur : trip.budgetEur }, [...lines, ...added]);
  return { real, sim, delta: { forecast: round2(sim.forecast - real.forecast), available: round2(sim.available - real.available) } };
}
