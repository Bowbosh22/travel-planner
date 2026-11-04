// Couche d'accès aux données. Les pages ne connaissent que cette interface.
// Étape 3 : remplacer chaque fonction par un fetch('/api/...') vers le backend PostgreSQL.

import { MOCK_TODAY, user, trips, bookings } from './data/mock-db.js';

const respond = (value) => new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), 40));

export const api = {
  today: () => MOCK_TODAY,
  me: () => respond(user),
  listTrips: () => respond(trips),
  listBookings: (tripId) => respond(bookings.filter((b) => b.tripId === tripId)),
};
