import express from 'express';
import { CURRENCIES, FxError } from '../fx/rates.js';

export function createFxRoutes(fx) {
  const router = express.Router();
  const hits = new Map();

  router.get('/fx', (_req, res) => res.json({ currencies: CURRENCIES }));

  // Aperçu du taux du jour (formulaires). 60 demandes par minute et par utilisateur.
  router.get('/fx/:code', async (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.user.id) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 60) return res.status(429).json({ error: 'Trop de demandes. Réessayez dans une minute.' });
    hits.set(req.user.id, [...recent, now]);
    try {
      res.json(await fx.getRate(String(req.params.code).toUpperCase()));
    } catch (err) {
      if (err instanceof FxError) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });
  return router;
}
