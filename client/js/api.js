// Couche d'accès aux données : appelle le backend (cookie de session httpOnly, envoyé automatiquement).
// L'en-tête X-Requested-With fait partie de la protection CSRF côté serveur.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Cache des lectures (GET) : 30 s, avec fusion des demandes identiques en cours. Toute écriture (ou connexion / déconnexion) vide le cache.
// Les pages enchaînent « liste des voyages » puis « réservations » : sans cache, chaque changement d'onglet attend deux allers-retours réseau.
const READ_TTL = 30_000;
const NO_CACHE = /^\/(auth|geo\/suggest|fx)/;
const reads = new Map();
export const clearApiCache = () => reads.clear();

async function request(method, path, body) {
  if (method !== 'GET') {
    reads.clear();
    try { return await send(method, path, body); } finally { reads.clear(); } // aussi après la réponse : une lecture lancée entre-temps serait périmée
  }
  if (NO_CACHE.test(path)) return send(method, path, body);
  const hit = reads.get(path);
  if (hit && Date.now() - hit.at < READ_TTL) return structuredClone(await hit.promise);
  const promise = send(method, path, body);
  reads.set(path, { at: Date.now(), promise });
  promise.catch(() => { if (reads.get(path)?.promise === promise) reads.delete(path); });
  return structuredClone(await promise);
}

async function send(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'tp', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Connexion impossible. Vérifiez votre réseau.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Session expirée en cours d'utilisation : l'application revient à l'écran de connexion.
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('unauthorized'));
    throw new ApiError(data.error || 'Une erreur est survenue.', res.status);
  }
  return data;
}

// Envoi d'un fichier : le contenu est le corps de la requête, le nom et la réservation liée sont dans l'adresse.
async function uploadFile(tripId, file, bookingId) {
  const qs = new URLSearchParams({ name: file.name });
  if (bookingId) qs.set('bookingId', bookingId);
  let res;
  try {
    res = await fetch(`/api/trips/${tripId}/documents?${qs}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'X-Requested-With': 'tp', 'Content-Type': 'application/octet-stream' },
      body: file,
    });
  } catch {
    throw new ApiError('Connexion impossible. Vérifiez votre réseau.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('unauthorized'));
    throw new ApiError(data.error || 'Envoi impossible.', res.status);
  }
  return data.document;
}

const pad = (n) => String(n).padStart(2, '0');

export const api = {
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  // Auth
  async me() {
    return (await request('GET', '/auth/me')).user;
  },
  login: async (email, password, remember) => (await request('POST', '/auth/login', { email, password, remember })).user,
  register: async (firstName, email, password, remember, invite) => { const r = await request('POST', '/auth/register', { firstName, email, password, remember, invite }); if (r.pending) return { pending: true }; return { ...r.user, recoveryCodes: r.recoveryCodes }; },
  authConfig: async () => await request('GET', '/auth/config'),
  accessRequests: async () => (await request('GET', '/auth/access-requests')).requests,
  approveRequest: async (id) => await request('POST', `/auth/access-requests/${encodeURIComponent(id)}/approve`),
  rejectRequest: async (id) => await request('DELETE', `/auth/access-requests/${encodeURIComponent(id)}`),
  resetPassword: async (email, code, password) => await request('POST', '/auth/reset-password', { email, code, password }),
  savePrefs: async (patch) => await request('PUT', '/auth/prefs', patch),
  sessions: async () => (await request('GET', '/auth/sessions')).sessions,
  closeSession: async (id) => await request('DELETE', `/auth/sessions/${encodeURIComponent(id)}`),
  closeOtherSessions: async () => (await request('DELETE', '/auth/sessions')).closed,
  updateProfile: async (firstName) => (await request('PATCH', '/auth/profile', { firstName })).user,
  changePassword: async (current, password, confirm) => await request('POST', '/auth/change-password', { current, password, confirm }),
  recoveryStatus: async () => (await request('GET', '/auth/recovery-codes')).remaining,
  newRecoveryCodes: async (password) => (await request('POST', '/auth/recovery-codes', { password })).codes,
  getInvite: async (token) => (await request('GET', `/invites/${encodeURIComponent(token)}`)).invite,
  joinInvite: async (token) => await request('POST', `/invites/${encodeURIComponent(token)}/join`),
  createInvite: async (id) => (await request('POST', `/trips/${id}/invite`)).trip,
  revokeInvite: async (id) => (await request('DELETE', `/trips/${id}/invite`)).trip ?? null,
  removeMember: async (id, userId) => await request('DELETE', `/trips/${id}/members/${userId}`),
  leaveTrip: async (id) => await request('DELETE', `/trips/${id}/membership`),
  logout: () => request('POST', '/auth/logout'),
  saveTheme: (theme) => request('PATCH', '/auth/theme', theme),

  // Voyages
  listTrips: async () => (await request('GET', '/trips')).trips,
  createTrip: async (trip) => (await request('POST', '/trips', trip)).trip,
  updateTrip: async (id, trip) => (await request('PUT', `/trips/${id}`, trip)).trip,
  deleteTrip: (id) => request('DELETE', `/trips/${id}`),

  // Import par lien : renvoie ce qui est écrit sur la page, sans rien inventer
  importUrl: async (url) => (await request('POST', '/import', { url })).result,

  // Devises
  currencies: () => (api._cur ??= request('GET', '/fx').then((d) => d.currencies).catch((e) => { api._cur = null; throw e; })),
  fxRate: (code) => request('GET', `/fx/${encodeURIComponent(code)}`),

  // Réservations et paiements
  listBookings: async (tripId) => (await request('GET', `/trips/${tripId}/bookings`)).bookings,
  createBooking: async (tripId, b) => (await request('POST', `/trips/${tripId}/bookings`, b)).booking,
  updateBooking: async (id, b) => (await request('PUT', `/bookings/${id}`, b)).booking,
  deleteBooking: (id) => request('DELETE', `/bookings/${id}`),
  addPayment: async (bookingId, p) => (await request('POST', `/bookings/${bookingId}/payments`, p)).booking,
  deletePayment: async (id) => (await request('DELETE', `/payments/${id}`)).booking,

  // Documents et carte
  listDocuments: (tripId) => request('GET', `/trips/${tripId}/documents`),
  uploadDocument: uploadFile,
  deleteDocument: (id) => request('DELETE', `/documents/${id}`),
  setCompanions: async (id, names) => (await request('PUT', `/trips/${id}/companions`, { names })).trip,
  getWeather: async (id) => (await request('GET', `/trips/${id}/weather`)).weather,
  refreshTripImage: (id) => request('POST', `/trips/${id}/image`),
  geocodeTrip: async (id) => (await request('POST', `/trips/${id}/geo`)).geo,
  suggestPlaces: async (q, type) => (await request('GET', `/geo/suggest?type=${type}&q=${encodeURIComponent(q)}`)).results,
  geocodeBooking: (id) => request('POST', `/bookings/${id}/geocode`),

  // Étapes d'un voyage et logements à comparer
  listStops: async (tripId) => (await request('GET', `/trips/${tripId}/stops`)).stops,
  createStop: async (tripId, s) => (await request('POST', `/trips/${tripId}/stops`, s)).stop,
  updateStop: async (id, s) => (await request('PUT', `/stops/${id}`, s)).stop,
  deleteStop: (id) => request('DELETE', `/stops/${id}`),
  geocodeStop: async (id) => (await request('POST', `/stops/${id}/geocode`)).stop,
  setBookingStop: (bookingId, stopId) => request('PUT', `/bookings/${bookingId}/stop`, { stopId }),
  listStays: async (tripId) => (await request('GET', `/trips/${tripId}/stays`)).stays,
  createStay: async (stopId, s) => (await request('POST', `/stops/${stopId}/stays`, s)).stay,
  updateStay: async (id, s) => (await request('PUT', `/stays/${id}`, s)).stay,
  deleteStay: (id) => request('DELETE', `/stays/${id}`),
  chooseStay: (id) => request('POST', `/stays/${id}/choose`),
  unchooseStay: (id) => request('POST', `/stays/${id}/unchoose`),
};
