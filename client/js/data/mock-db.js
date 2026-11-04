// DONNÉES D'EXEMPLE, uniquement pour l'étape 2 (dashboard sans base de données).
// À l'étape 3, ce fichier est supprimé : js/api.js appelle le backend PostgreSQL.
// La forme des objets suit déjà le schéma prévu (trips, bookings, payments).

export const MOCK_TODAY = '2026-11-04';

export const user = { firstName: 'Mbemba' };

export const trips = [
  { id: 'lisbonne', name: 'Escapade à Lisbonne', destination: 'Lisbonne', country: 'Portugal', startDate: '2026-12-12', endDate: '2026-12-19', travelers: 2, budgetEur: 2000, status: 'confirme' },
  { id: 'marrakech', name: 'Printemps à Marrakech', destination: 'Marrakech', country: 'Maroc', startDate: '2027-04-03', endDate: '2027-04-10', travelers: 3, budgetEur: 1800, status: 'preparation' },
  { id: 'quebec', name: 'Road trip au Québec', destination: 'Montréal', country: 'Canada', startDate: '2027-07-14', endDate: '2027-07-28', travelers: 2, budgetEur: 4000, status: 'preparation' },
  { id: 'geneve', name: 'Week-end à Genève', destination: 'Genève', country: 'Suisse', startDate: '2026-10-31', endDate: '2026-11-06', travelers: 1, budgetEur: 900, status: 'en_cours' },
  { id: 'istanbul', name: 'Istanbul en famille', destination: 'Istanbul', country: 'Turquie', startDate: '2026-08-05', endDate: '2026-08-12', travelers: 4, budgetEur: 3400, status: 'termine' },
];

// status : 'reserve' | 'a_reserver' | 'annule' ; amountEur peut être null (prix non renseigné).
export const bookings = [
  { id: 'b1', tripId: 'lisbonne', category: 'billets', name: 'Vol aller-retour', amountEur: 400, status: 'reserve', payments: [{ date: '2026-09-14', amountEur: 400 }] },
  { id: 'b2', tripId: 'lisbonne', category: 'logement', name: 'Hôtel Exemple · Alfama', amountEur: 650, status: 'reserve', payments: [{ date: '2026-10-10', amountEur: 150 }, { date: '2026-10-28', amountEur: 150 }] },
  { id: 'b3', tripId: 'lisbonne', category: 'transport', name: 'Location de voiture', amountEur: 250, status: 'reserve', payments: [{ date: '2026-11-02', amountEur: 100 }] },
  { id: 'b4', tripId: 'lisbonne', category: 'activites', name: 'Visite guidée de Sintra', amountEur: 200, status: 'reserve', payments: [{ date: '2026-11-04', amountEur: 100 }] },
  { id: 'b5', tripId: 'lisbonne', category: 'restaurants', name: 'Dîner d\'adieu', amountEur: null, status: 'a_reserver', payments: [] },

  { id: 'b6', tripId: 'marrakech', category: 'billets', name: 'Vol aller-retour', amountEur: 380, status: 'reserve', payments: [{ date: '2026-10-20', amountEur: 380 }] },
  { id: 'b7', tripId: 'marrakech', category: 'logement', name: 'Riad Exemple', amountEur: 260, status: 'a_reserver', payments: [] },
];
