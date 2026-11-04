import express from 'express';
import { importFromUrl, ImportError } from '../importer/index.js';

// 10 analyses par minute et par utilisateur : évite de transformer le serveur en robot d'exploration.
export function createImportRoutes(importOptions = {}) {
  const router = express.Router();
  const hits = new Map();

  router.post('/import', async (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.user.id) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 10) return res.status(429).json({ error: 'Trop d\'analyses en peu de temps. Réessayez dans une minute.' });
    hits.set(req.user.id, [...recent, now]);
    try {
      res.json({ result: await importFromUrl(req.body?.url, importOptions) });
    } catch (err) {
      if (err instanceof ImportError) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });
  return router;
}
