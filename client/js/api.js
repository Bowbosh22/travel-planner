// Couche d'accès aux données : appelle le backend (cookie de session httpOnly, envoyé automatiquement).
// L'en-tête X-Requested-With fait partie de la protection CSRF côté serveur.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
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
  register: async (firstName, email, password, remember) => (await request('POST', '/auth/register', { firstName, email, password, remember })).user,
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
  getWeather: async (id) => (await request('GET', `/trips/${id}/weather`)).weather,
  refreshTripImage: (id) => request('POST', `/trips/${id}/image`),
  geocodeTrip: async (id) => (await request('POST', `/trips/${id}/geo`)).geo,
  geocodeBooking: (id) => request('POST', `/bookings/${id}/geocode`),
};
