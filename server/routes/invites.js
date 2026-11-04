import express from 'express';
import { rateLimit } from '../ratelimit.js';
import { INVITE_TOKEN, joinByToken } from '../access.js';

// Aperçu public d'une invitation (nom du voyage seulement, jamais de montants) et adhésion d'un utilisateur connecté.
export function createInviteRoutes(pool, requireUser) {
  const router = express.Router();
  const limit = rateLimit({ max: 40, windowMs: 60 * 1000, key: (req) => req.ip, message: 'Trop de tentatives. Réessayez dans une minute.' });
  const gone = (res) => res.status(404).json({ error: 'Invitation invalide ou expirée.' });

  router.get('/invites/:token', limit, async (req, res, next) => {
    try {
      if (!INVITE_TOKEN.test(req.params.token)) return gone(res);
      const { rows } = await pool.query(
        'SELECT t.name, t.destination, t.country, t.start_date, t.end_date, u.first_name FROM trips t JOIN users u ON u.id = t.user_id WHERE t.invite_token = $1',
        [req.params.token]
      );
      if (!rows[0]) return gone(res);
      const r = rows[0];
      res.json({ invite: { name: r.name, destination: r.destination, country: r.country, startDate: r.start_date, endDate: r.end_date, ownerFirstName: r.first_name } });
    } catch (err) { next(err); }
  });

  router.post('/invites/:token/join', limit, requireUser, async (req, res, next) => {
    try {
      const r = await joinByToken(pool, req.user.id, req.params.token);
      if (r.error) return res.status(r.status).json({ error: r.error });
      res.json({ tripId: r.tripId, already: r.already });
    } catch (err) { next(err); }
  });

  return router;
}
