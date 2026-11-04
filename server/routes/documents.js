import express from 'express';
import { UUID } from '../validate.js';
import { rateLimit } from '../ratelimit.js';
import { canAccess } from '../access.js';
import { MAX_FILE_BYTES, MAX_USER_BYTES, cleanFileName, createDocumentStore, sniffMime } from '../storage/documents.js';

export function createDocumentRoutes(pool, store = createDocumentStore(pool)) {
  const router = express.Router();
  const bad = (res, status, msg) => res.status(status).json({ error: msg });
  const notFound = (res) => bad(res, 404, 'Introuvable.');
  router.param('id', (_req, res, next, id) => (UUID.test(id) ? next() : notFound(res)));

  const ownsTrip = async (tripId, userId) => (await pool.query(`SELECT 1 FROM trips t WHERE t.id=$1 AND ${canAccess('t', '$2')}`, [tripId, userId])).rowCount > 0;

  router.get('/trips/:id/documents', async (req, res, next) => {
    try {
      if (!(await ownsTrip(req.params.id, req.user.id))) return notFound(res);
      res.json({ documents: await store.list(req.params.id), usedBytes: await store.usage(req.user.id), maxFileBytes: MAX_FILE_BYTES, maxUserBytes: MAX_USER_BYTES });
    } catch (err) { next(err); }
  });

  // Envoi : le contenu du fichier est le corps de la requête ; nom et réservation liée sont dans l'adresse.
  router.post('/trips/:id/documents', rateLimit({ max: 30, windowMs: 60 * 1000, message: 'Trop d\'envois en peu de temps. Réessayez dans une minute.' }), express.raw({ type: () => true, limit: MAX_FILE_BYTES }), async (req, res, next) => {
    try {
      if (!(await ownsTrip(req.params.id, req.user.id))) return notFound(res);
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (data.length === 0) return bad(res, 400, 'Fichier vide.');
      const kind = sniffMime(data);
      if (!kind) return bad(res, 415, 'Format non accepté : PDF, JPG, PNG ou WebP uniquement.');
      const bookingId = typeof req.query.bookingId === 'string' && req.query.bookingId ? req.query.bookingId : null;
      if (bookingId) {
        const ok = UUID.test(bookingId) && (await pool.query('SELECT 1 FROM bookings WHERE id=$1 AND trip_id=$2', [bookingId, req.params.id])).rowCount > 0;
        if (!ok) return bad(res, 400, 'Réservation introuvable pour ce voyage.');
      }
      if ((await store.usage(req.user.id)) + data.length > MAX_USER_BYTES) return bad(res, 413, 'Espace de stockage plein (200 Mo). Supprimez des documents.');
      const doc = await store.put({
        userId: req.user.id, tripId: req.params.id, bookingId,
        name: cleanFileName(req.query.name, kind.ext), mime: kind.mime, data,
      });
      res.status(201).json({ document: doc });
    } catch (err) { next(err); }
  });

  router.get('/documents/:id/file', async (req, res, next) => {
    try {
      const doc = await store.get(req.params.id, req.user.id);
      if (!doc) return notFound(res);
      const download = req.query.download === '1';
      res.setHeader('Content-Type', doc.mime);
      res.setHeader('Content-Length', doc.data.length);
      res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      if (doc.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.end(doc.data);
    } catch (err) { next(err); }
  });

  router.delete('/documents/:id', async (req, res, next) => {
    try {
      (await store.remove(req.params.id, req.user.id)) ? res.json({ ok: true }) : notFound(res);
    } catch (err) { next(err); }
  });

  return router;
}
