import express from 'express';
import { UUID } from '../validate.js';
import { rateLimit } from '../ratelimit.js';
import { geoKey } from './trips.js';
import { canAccess } from '../access.js';

export function createGeoRoutes(pool, geocoder, suggest) {
  const router = express.Router();

  // Suggestions de villes / pays pendant la saisie (le formulaire de voyage). Jamais d'erreur bloquante : liste vide en cas de panne.
  router.get('/geo/suggest', rateLimit({ max: 120, windowMs: 60 * 1000, message: 'Trop de recherches. Réessayez dans une minute.' }), async (req, res) => {
    try {
      const results = suggest ? await suggest(String(req.query.q ?? ''), req.query.type === 'country' ? 'country' : 'city') : [];
      res.json({ results });
    } catch {
      res.json({ results: [], unavailable: true });
    }
  });

  // Calcule les coordonnées du lieu d'une réservation (une seule fois par texte de lieu, résultat mémorisé).
  router.post('/bookings/:id/geocode', rateLimit({ max: 70, windowMs: 60 * 1000, message: 'Trop de recherches de lieux. Réessayez dans une minute.' }), async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Introuvable.' });
      const { rows } = await pool.query(
        `SELECT b.location, b.lat, b.lng, b.geo_query FROM bookings b JOIN trips t ON t.id=b.trip_id WHERE b.id=$1 AND ${canAccess('t', '$2')}`,
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

  // Coordonnées utiles à la carte de l'accueil : départ, destination et emprise du pays (mémorisées par voyage).
  router.post('/trips/:id/geo', rateLimit({ max: 20, windowMs: 60 * 1000, message: 'Trop de recherches. Réessayez dans une minute.' }), async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Introuvable.' });
      const { rows } = await pool.query(`SELECT * FROM trips t WHERE t.id=$1 AND ${canAccess('t', '$2')}`, [req.params.id, req.user.id]);
      const t = rows[0];
      if (!t) return res.status(404).json({ error: 'Introuvable.' });
      const key = geoKey(t);
      if (t.geo_key === key && t.geo?.dest) return res.json({ geo: t.geo });
      let dest;
      let country;
      let origin = null;
      try {
        dest = await geocoder.geocode([t.destination, t.country].filter(Boolean).join(', '));
        country = t.country ? await geocoder.geocode(t.country) : dest;
        if (t.origin) origin = await geocoder.geocode(t.origin);
      } catch {
        return res.status(503).json({ error: 'Service de localisation indisponible. Réessayez plus tard.' });
      }
      const point = (p) => (p ? { lat: p.lat, lng: p.lng } : null);
      const geo = { dest: point(dest), origin: point(origin), box: country?.box ?? dest?.box ?? null };
      if (!geo.dest) return res.json({ geo }); // introuvable : rien n'est mémorisé, on réessaiera
      await pool.query('UPDATE trips SET geo=$2::jsonb, geo_key=$3 WHERE id=$1 AND origin=$4 AND destination=$5 AND country=$6', [t.id, JSON.stringify(geo), key, t.origin, t.destination, t.country]);
      res.json({ geo });
    } catch (err) { next(err); }
  });

  return router;
}
