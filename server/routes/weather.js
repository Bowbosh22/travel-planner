import express from 'express';
import { UUID } from '../validate.js';

export function createWeatherRoutes(pool, weather) {
  const router = express.Router();
  // Météo actuelle et fuseau horaire de la destination d'un voyage de l'utilisateur.
  router.get('/trips/:id/weather', async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Introuvable.' });
      const { rows } = await pool.query('SELECT destination FROM trips WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Introuvable.' });
      res.json({ weather: await weather.get(rows[0].destination) });
    } catch (err) { next(err); }
  });
  return router;
}
