import express from 'express';
import { UUID } from '../validate.js';
import { rateLimit } from '../ratelimit.js';

export function createGeoRoutes(pool, geocoder) {
  const router = express.Router();

  // Calcule les coordonnées du lieu d'une réservation (une seule fois par texte de lieu, résultat mémorisé).
  router.post('/bookings/:id/geocode', rateLimit({ max: 70, windowMs: 60 * 1000, message: 'Trop de recherches de lieux. Réessayez dans une minute.' }), async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Introuvable.' });
      const { rows } = await pool.query(
        `SELECT b.location, b.lat, b.lng, b.geo_query FROM bookings b JOIN trips t ON t.id=b.trip_id WHERE b.id=$1 AND t.user_id=$2`,
        [req.params.id, req.user.id]
      );
      const b = rows[0];
      if (!b) return res.status(404).json({ error: 'Introuvable.' });
      if (!b.location) return res.status(400).json({ error: 'Cette réservation n\'a pas de lieu.' });
      if (b.geo_query === b.location) return res.json({ lat: b.lat, lng: b.lng, found: b.lat !== null });
      let pos;
      try {
        pos = await geocoder.geocode(b.location);
      } catch {
        return res.status(503).json({ error: 'Service de localisation indisponible. Réessayez plus tard.' });
      }
      await pool.query('UPDATE bookings SET lat=$2, lng=$3, geo_query=$4 WHERE id=$1 AND location=$4', [req.params.id, pos?.lat ?? null, pos?.lng ?? null, b.location]);
      res.json({ lat: pos?.lat ?? null, lng: pos?.lng ?? null, found: Boolean(pos) });
    } catch (err) { next(err); }
  });

  return router;
}
