export const NAV = [
  { path: '/', label: 'Dashboard', icon: 'home', tab: true },
  { path: '/voyages', label: 'Mes voyages', icon: 'plane', tab: true },
  { path: '/reservations', label: 'Réservations', icon: 'bag' },
  { path: '/budget', label: 'Budget', icon: 'wallet', tab: true },
  { path: '/simulateur', label: 'Simulateur', icon: 'sliders' },
  { path: '/planning', label: 'Planning', icon: 'calendar' },
  { path: '/carte', label: 'Carte', icon: 'pin' },
  { path: '/documents', label: 'Documents', icon: 'file' },
  { path: '/parametres', label: 'Paramètres', icon: 'user', footer: true },
];

// Sections pas encore développées : la page indique l'étape prévue.
export const PLACEHOLDERS = {
  '/budget': { step: 6, text: 'Suivi complet du budget : initial, prévisionnel, payé, restant, avec alertes.' },
  '/simulateur': { step: 6, text: 'Tester des scénarios sans toucher à vos vraies réservations.' },
  '/planning': { step: 7, text: 'Vue calendrier et vue quotidienne de votre séjour.' },
  '/carte': { step: 7, text: 'Hôtels, restaurants et activités sur une carte interactive.' },
  '/documents': { step: 7, text: 'Billets, confirmations et factures rattachés à chaque réservation.' },
};
