// Droits d'accès aux voyages : le propriétaire et les membres invités peuvent tout consulter et modifier.
// Seul le propriétaire supprime le voyage, gère le lien d'invitation et retire des membres.
import crypto from 'node:crypto';

export const MAX_MEMBERS = 20;

// Fragment SQL : « l'utilisateur $p a accès au voyage alias ».
export const canAccess = (alias, param) =>
  `(${alias}.user_id = ${param} OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = ${alias}.id AND tm.user_id = ${param}))`;

export const newInviteToken = () => crypto.randomBytes(24).toString('base64url');
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

// Ajoute l'utilisateur au voyage lié au jeton. Renvoie { tripId, already } ou { error, status }.
export async function joinByToken(pool, userId, token) {
  if (typeof token !== 'string' || !INVITE_TOKEN.test(token)) return { error: 'Invitation invalide ou expirée.', status: 404 };
  const { rows: [trip] } = await pool.query('SELECT id, user_id, companions FROM trips WHERE invite_token = $1', [token]);
  if (!trip) return { error: 'Invitation invalide ou expirée.', status: 404 };
  if (trip.user_id === userId) return { tripId: trip.id, already: true };
  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM trip_members WHERE trip_id = $1', [trip.id]);
  const { rowCount } = await pool.query('SELECT 1 FROM trip_members WHERE trip_id = $1 AND user_id = $2', [trip.id, userId]);
  if (rowCount) return { tripId: trip.id, already: true };
  if (n >= MAX_MEMBERS) return { error: `Ce voyage a atteint ${MAX_MEMBERS} invités.`, status: 409 };
  await pool.query('INSERT INTO trip_members (trip_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [trip.id, userId]);
  // le nombre de voyageurs suit : propriétaire + invités + personnes ajoutées à la main
  await pool.query('UPDATE trips SET travelers = GREATEST(travelers, 1 + $2 + jsonb_array_length(companions)) WHERE id = $1', [trip.id, n + 1]);
  return { tripId: trip.id, already: false };
}
