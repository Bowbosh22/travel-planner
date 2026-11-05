import express from 'express';
import { UUID, validateStop, validateStay } from '../validate.js';
import { FxError, toEur } from '../fx/rates.js';
import { rateLimit } from '../ratelimit.js';
import { canAccess } from '../access.js';

const todayIso = () => new Date().toISOString().slice(0, 10);
const geoKeyOf = (name, country) => `${name}|${country ?? ''}`;

const stopOut = (r) => ({
  id: r.id, tripId: r.trip_id, name: r.name, startDate: r.start_date, endDate: r.end_date,
  // coordonnées valables seulement pour le nom actuel ; geoDone = déjà recherché
  lat: r.geo_query === geoKeyOf(r.name, r.country) ? r.lat : null,
  lng: r.geo_query === geoKeyOf(r.name, r.country) ? r.lng : null,
  geoDone: r.geo_query === geoKeyOf(r.name, r.country),
});

const stayOut = (r) => ({
  id: r.id, tripId: r.trip_id, stopId: r.stop_id, url: r.url, name: r.name, location: r.location,
  amount: r.original_amount, currency: r.currency, amountEur: r.amount_eur, fxRate: r.fx_rate, fxDate: r.fx_date,
  rating: r.rating, notes: r.notes, bookingId: r.booking_id, chosen: Boolean(r.booking_id),
});

const STOP_SELECT = 'SELECT s.*, t.country FROM trip_stops s JOIN trips t ON t.id = s.trip_id';
const STAY_COLS = "id, trip_id, stop_id, url, name, location, currency, original_amount, amount_eur, fx_rate, to_char(fx_date, 'YYYY-MM-DD') AS fx_date, rating, notes, booking_id";

export function createStopRoutes(pool, fx, geocoder) {
  const router = express.Router();
  const bad = (res, msg) => res.status(400).json({ error: msg });
  const notFound = (res) => res.status(404).json({ error: 'Introuvable.' });
  const validId = (id) => UUID.test(String(id));

  const tripAccess = async (tripId, userId) => validId(tripId) && (await pool.query(`SELECT 1 FROM trips t WHERE t.id=$1 AND ${canAccess('t', '$2')}`, [tripId, userId])).rowCount > 0;
  const loadStop = async (id, userId) => {
    if (!validId(id)) return null;
    const { rows } = await pool.query(`${STOP_SELECT} WHERE s.id=$1 AND ${canAccess('t', '$2')}`, [id, userId]);
    return rows[0] ?? null;
  };
  const loadStay = async (id, userId) => {
    if (!validId(id)) return null;
    const { rows } = await pool.query(`SELECT o.*, to_char(o.fx_date, 'YYYY-MM-DD') AS fx_date_s FROM stay_options o JOIN trips t ON t.id=o.trip_id WHERE o.id=$1 AND ${canAccess('t', '$2')}`, [id, userId]);
    return rows[0] ?? null;
  };
  const stayById = async (id) => stayOut((await pool.query(`SELECT ${STAY_COLS} FROM stay_options WHERE id=$1`, [id])).rows[0]);

  async function resolveRate(v) {
    if (v.currency === 'EUR') return { rate: 1, date: todayIso(), source: 'EUR' };
    if (v.manualRate) return { rate: v.manualRate, date: todayIso(), source: 'Saisi à la main' };
    const r = await fx.getRate(v.currency);
    return { rate: r.rate, date: r.date, source: r.source };
  }
  const fxFail = (res, err) => res.status(err.status).json({ error: err.message, code: err.code });

  // ---- Étapes ----
  router.get('/trips/:id/stops', async (req, res, next) => {
    try {
      if (!(await tripAccess(req.params.id, req.user.id))) return res.json({ stops: [] });
      const { rows } = await pool.query(`${STOP_SELECT} WHERE s.trip_id=$1 ORDER BY s.start_date, s.created_at`, [req.params.id]);
      res.json({ stops: rows.map(stopOut) });
    } catch (err) { next(err); }
  });

  router.post('/trips/:id/stops', async (req, res, next) => {
    try {
      const p = validateStop(req.body);
      if (p.error) return bad(res, p.error);
      if (!(await tripAccess(req.params.id, req.user.id))) return notFound(res);
      const count = (await pool.query('SELECT count(*)::int AS n FROM trip_stops WHERE trip_id=$1', [req.params.id])).rows[0].n;
      if (count >= 30) return bad(res, 'Un voyage peut avoir 30 destinations au maximum.');
      const { rows } = await pool.query('INSERT INTO trip_stops (trip_id, name, start_date, end_date) VALUES ($1,$2,$3,$4) RETURNING id', [req.params.id, p.value.name, p.value.startDate, p.value.endDate]);
      res.status(201).json({ stop: stopOut(await loadStop(rows[0].id, req.user.id)) });
    } catch (err) { next(err); }
  });

  router.put('/stops/:id', async (req, res, next) => {
    try {
      const p = validateStop(req.body);
      if (p.error) return bad(res, p.error);
      if (!(await loadStop(req.params.id, req.user.id))) return notFound(res);
      await pool.query('UPDATE trip_stops SET name=$2, start_date=$3, end_date=$4 WHERE id=$1', [req.params.id, p.value.name, p.value.startDate, p.value.endDate]);
      res.json({ stop: stopOut(await loadStop(req.params.id, req.user.id)) });
    } catch (err) { next(err); }
  });

  router.delete('/stops/:id', async (req, res, next) => {
    try {
      if (!(await loadStop(req.params.id, req.user.id))) return notFound(res);
      await pool.query('DELETE FROM trip_stops WHERE id=$1', [req.params.id]); // réservations détachées (conservées), logements comparés supprimés
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Position de la destination sur la carte (une fois par nom, résultat mémorisé).
  router.post('/stops/:id/geocode', rateLimit({ max: 40, windowMs: 60 * 1000, message: 'Trop de recherches. Réessayez dans une minute.' }), async (req, res, next) => {
    try {
      const s = await loadStop(req.params.id, req.user.id);
      if (!s) return notFound(res);
      const key = geoKeyOf(s.name, s.country);
      if (s.geo_query === key) return res.json({ stop: stopOut(s) });
      let pos;
      try { pos = await geocoder.geocode(s.country ? `${s.name}, ${s.country}` : s.name); } catch { return res.status(503).json({ error: 'Service de localisation indisponible. Réessayez plus tard.' }); }
      await pool.query('UPDATE trip_stops SET lat=$2, lng=$3, geo_query=$4 WHERE id=$1 AND name=$5', [req.params.id, pos?.lat ?? null, pos?.lng ?? null, key, s.name]);
      res.json({ stop: stopOut(await loadStop(req.params.id, req.user.id)) });
    } catch (err) { next(err); }
  });

  // Rattacher / détacher une réservation d'une étape.
  router.put('/bookings/:id/stop', async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return notFound(res);
      const stopId = req.body?.stopId ?? null;
      const { rows } = await pool.query(`SELECT b.trip_id FROM bookings b JOIN trips t ON t.id=b.trip_id WHERE b.id=$1 AND ${canAccess('t', '$2')}`, [req.params.id, req.user.id]);
      if (!rows[0]) return notFound(res);
      if (stopId !== null && (!validId(stopId) || !(await pool.query('SELECT 1 FROM trip_stops WHERE id=$1 AND trip_id=$2', [stopId, rows[0].trip_id])).rowCount)) return bad(res, 'Destination introuvable pour ce voyage.');
      await pool.query('UPDATE bookings SET stop_id=$2 WHERE id=$1', [req.params.id, stopId]);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // ---- Logements à comparer ----
  router.get('/trips/:id/stays', async (req, res, next) => {
    try {
      if (!(await tripAccess(req.params.id, req.user.id))) return res.json({ stays: [] });
      const { rows } = await pool.query(`SELECT ${STAY_COLS} FROM stay_options WHERE trip_id=$1 ORDER BY amount_eur ASC NULLS LAST, created_at`, [req.params.id]);
      res.json({ stays: rows.map(stayOut) });
    } catch (err) { next(err); }
  });

  router.post('/stops/:id/stays', async (req, res, next) => {
    try {
      const p = validateStay(req.body);
      if (p.error) return bad(res, p.error);
      const stop = await loadStop(req.params.id, req.user.id);
      if (!stop) return notFound(res);
      const count = (await pool.query('SELECT count(*)::int AS n FROM stay_options WHERE stop_id=$1', [stop.id])).rows[0].n;
      if (count >= 30) return bad(res, 'Une destination peut comparer 30 logements au maximum.');
      const v = p.value;
      if (v.amount === null) { v.currency = 'EUR'; v.manualRate = null; }
      const r = await resolveRate(v);
      const eurAmount = v.amount === null ? null : toEur(v.amount, r.rate);
      if (eurAmount !== null && eurAmount > 9_999_999_999) return bad(res, 'Le montant converti est trop élevé.');
      const { rows } = await pool.query(
        `INSERT INTO stay_options (trip_id, stop_id, url, name, location, currency, original_amount, amount_eur, fx_rate, fx_date, fx_source, rating, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [stop.trip_id, stop.id, v.url ?? null, v.name, v.location ?? null, v.currency, v.amount, eurAmount, r.rate, r.date, r.source, v.rating, v.notes ?? null]
      );
      res.status(201).json({ stay: await stayById(rows[0].id) });
    } catch (err) {
      if (err instanceof FxError) return fxFail(res, err);
      next(err);
    }
  });

  router.put('/stays/:id', async (req, res, next) => {
    try {
      const p = validateStay(req.body);
      if (p.error) return bad(res, p.error);
      const cur = await loadStay(req.params.id, req.user.id);
      if (!cur) return notFound(res);
      const v = p.value;
      if (v.amount === null) { v.currency = 'EUR'; v.manualRate = null; }
      const keep = v.currency === cur.currency && !v.manualRate && v.amount !== null && cur.fx_rate; // taux figé tant que la devise ne change pas
      const r = keep ? { rate: cur.fx_rate, date: cur.fx_date_s, source: cur.fx_source } : await resolveRate(v);
      const eurAmount = v.amount === null ? null : toEur(v.amount, r.rate);
      if (eurAmount !== null && eurAmount > 9_999_999_999) return bad(res, 'Le montant converti est trop élevé.');
      await pool.query(
        `UPDATE stay_options SET url=$2, name=$3, location=$4, currency=$5, original_amount=$6, amount_eur=$7, fx_rate=$8, fx_date=$9, fx_source=$10, rating=$11, notes=$12 WHERE id=$1`,
        [req.params.id, v.url === undefined ? cur.url : v.url, v.name, v.location === undefined ? cur.location : v.location, v.currency, v.amount, eurAmount, r.rate, r.date, r.source, v.rating, v.notes === undefined ? cur.notes : v.notes]
      );
      res.json({ stay: await stayById(req.params.id) });
    } catch (err) {
      if (err instanceof FxError) return fxFail(res, err);
      next(err);
    }
  });

  router.delete('/stays/:id', async (req, res, next) => {
    try {
      if (!(await loadStay(req.params.id, req.user.id))) return notFound(res);
      await pool.query('DELETE FROM stay_options WHERE id=$1', [req.params.id]); // la réservation éventuellement créée est conservée
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // « Retenir » : crée la réservation de logement de la destination (dates de la destination, prix et taux du logement).
  router.post('/stays/:id/choose', async (req, res, next) => {
    try {
      const o = await loadStay(req.params.id, req.user.id);
      if (!o) return notFound(res);
      if (o.booking_id) return res.json({ stay: await stayById(o.id), bookingId: o.booking_id });
      const other = await pool.query('SELECT 1 FROM stay_options WHERE stop_id=$1 AND booking_id IS NOT NULL', [o.stop_id]);
      if (other.rowCount) return res.status(409).json({ error: 'Un autre logement est déjà retenu pour cette destination. Retirez-le d\'abord.' });
      const { rows: [stop] } = await pool.query('SELECT * FROM trip_stops WHERE id=$1', [o.stop_id]);
      const { rows: [b] } = await pool.query(
        `INSERT INTO bookings (trip_id, category, name, amount_eur, status, source_url, starts_on, ends_on, location, currency, original_amount, fx_rate, fx_date, fx_source, stop_id)
         VALUES ($1,'logement',$2,$3,'a_reserver',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [o.trip_id, o.name, o.amount_eur, o.url, stop.start_date, stop.end_date, o.location, o.currency, o.original_amount, o.fx_rate ?? 1, o.fx_date_s ?? todayIso(), o.fx_source ?? 'EUR', o.stop_id]
      );
      await pool.query('UPDATE stay_options SET booking_id=$2 WHERE id=$1', [o.id, b.id]);
      res.json({ stay: await stayById(o.id), bookingId: b.id });
    } catch (err) { next(err); }
  });

  // Annule le choix : supprime la réservation créée, seulement si aucun paiement n'y est enregistré.
  router.post('/stays/:id/unchoose', async (req, res, next) => {
    try {
      const o = await loadStay(req.params.id, req.user.id);
      if (!o) return notFound(res);
      if (o.booking_id) {
        if ((await pool.query('SELECT 1 FROM payments WHERE booking_id=$1', [o.booking_id])).rowCount) return bad(res, 'Cette réservation a déjà des paiements : supprimez-les d\'abord dans Réservations.');
        await pool.query('DELETE FROM bookings WHERE id=$1', [o.booking_id]);
      }
      await pool.query('UPDATE stay_options SET booking_id=NULL WHERE id=$1', [o.id]);
      res.json({ stay: await stayById(o.id) });
    } catch (err) { next(err); }
  });

  return router;
}
