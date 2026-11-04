import express from 'express';
import { UUID, validateBooking, validatePayment, validateTrip } from '../validate.js';

const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;
const todayIso = () => new Date().toISOString().slice(0, 10);

// Statut affiché : « en cours » et « terminé » se déduisent des dates ; le reste est choisi par l'utilisateur.
function tripOut(r, today = todayIso()) {
  const status = r.end_date < today ? 'termine' : r.start_date <= today ? 'en_cours' : r.plan_status;
  return {
    id: r.id, name: r.name, destination: r.destination, country: r.country,
    startDate: r.start_date, endDate: r.end_date, travelers: r.travelers,
    budgetEur: r.budget_eur, planStatus: r.plan_status, status,
  };
}

const BOOKING_SELECT = `
  SELECT b.id, b.trip_id, b.category, b.name, b.amount_eur, b.status, b.source_url, b.starts_on, b.ends_on, b.location,
    COALESCE(json_agg(json_build_object('id', p.id, 'date', to_char(p.paid_on, 'YYYY-MM-DD'), 'amountEur', p.amount_eur::float8)
      ORDER BY p.paid_on, p.created_at) FILTER (WHERE p.id IS NOT NULL), '[]') AS payments
  FROM bookings b
  JOIN trips t ON t.id = b.trip_id
  LEFT JOIN payments p ON p.booking_id = b.id`;

const bookingOut = (r) => ({ id: r.id, tripId: r.trip_id, category: r.category, name: r.name, amountEur: r.amount_eur, status: r.status, sourceUrl: r.source_url, startsOn: r.starts_on, endsOn: r.ends_on, location: r.location, payments: r.payments });

export function createTripRoutes(pool) {
  const router = express.Router();
  const bad = (res, msg) => res.status(400).json({ error: msg });
  const notFound = (res) => res.status(404).json({ error: 'Introuvable.' });

  // Les identifiants invalides répondent 404 (et évitent une erreur SQL).
  router.param('id', (_req, res, next, id) => (UUID.test(id) ? next() : notFound(res)));

  async function loadBooking(id, userId) {
    const { rows } = await pool.query(`${BOOKING_SELECT} WHERE b.id = $1 AND t.user_id = $2 GROUP BY b.id`, [id, userId]);
    return rows[0] ? bookingOut(rows[0]) : null;
  }

  // ---- Voyages ----
  router.get('/trips', async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT * FROM trips WHERE user_id = $1 ORDER BY start_date, created_at', [req.user.id]);
      res.json({ trips: rows.map((r) => tripOut(r)) });
    } catch (err) { next(err); }
  });

  router.post('/trips', async (req, res, next) => {
    try {
      const p = validateTrip(req.body);
      if (p.error) return bad(res, p.error);
      const v = p.value;
      const { rows } = await pool.query(
        `INSERT INTO trips (user_id, name, destination, country, start_date, end_date, travelers, budget_eur, plan_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.user.id, v.name, v.destination, v.country, v.startDate, v.endDate, v.travelers, v.budgetEur, v.planStatus]
      );
      res.status(201).json({ trip: tripOut(rows[0]) });
    } catch (err) { next(err); }
  });

  router.put('/trips/:id', async (req, res, next) => {
    try {
      const p = validateTrip(req.body);
      if (p.error) return bad(res, p.error);
      const v = p.value;
      const { rows } = await pool.query(
        `UPDATE trips SET name=$3, destination=$4, country=$5, start_date=$6, end_date=$7, travelers=$8, budget_eur=$9, plan_status=$10
         WHERE id=$1 AND user_id=$2 RETURNING *`,
        [req.params.id, req.user.id, v.name, v.destination, v.country, v.startDate, v.endDate, v.travelers, v.budgetEur, v.planStatus]
      );
      rows[0] ? res.json({ trip: tripOut(rows[0]) }) : notFound(res);
    } catch (err) { next(err); }
  });

  router.delete('/trips/:id', async (req, res, next) => {
    try {
      const { rowCount } = await pool.query('DELETE FROM trips WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      rowCount ? res.json({ ok: true }) : notFound(res);
    } catch (err) { next(err); }
  });

  // ---- Réservations ----
  router.get('/trips/:id/bookings', async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `${BOOKING_SELECT} WHERE b.trip_id = $1 AND t.user_id = $2 GROUP BY b.id ORDER BY b.created_at`,
        [req.params.id, req.user.id]
      );
      res.json({ bookings: rows.map(bookingOut) });
    } catch (err) { next(err); }
  });

  router.post('/trips/:id/bookings', async (req, res, next) => {
    try {
      const p = validateBooking(req.body);
      if (p.error) return bad(res, p.error);
      const owned = await pool.query('SELECT 1 FROM trips WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return notFound(res);
      const v = p.value;
      const { rows } = await pool.query(
        `INSERT INTO bookings (trip_id, category, name, amount_eur, status, source_url, starts_on, ends_on, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [req.params.id, v.category, v.name, v.amountEur, v.status, v.sourceUrl ?? null, v.startsOn ?? null, v.endsOn ?? null, v.location ?? null]
      );
      res.status(201).json({ booking: await loadBooking(rows[0].id, req.user.id) });
    } catch (err) { next(err); }
  });

  router.put('/bookings/:id', async (req, res, next) => {
    try {
      const p = validateBooking(req.body);
      if (p.error) return bad(res, p.error);
      const current = await loadBooking(req.params.id, req.user.id);
      if (!current) return notFound(res);
      const v = p.value;
      const paid = current.payments.reduce((s, x) => s + x.amountEur, 0);
      if (paid > 0 && v.amountEur === null) return bad(res, 'Cette réservation a déjà des paiements : le montant est obligatoire.');
      if (v.amountEur !== null && v.amountEur < paid - 0.001) return bad(res, `Le montant ne peut pas être inférieur aux paiements déjà enregistrés (${eur(paid)}).`);
      // Détails absents de la requête : on garde les valeurs actuelles.
      const pick = (key) => (v[key] === undefined ? current[key] : v[key]);
      const startsOn = pick('startsOn');
      const endsOn = pick('endsOn');
      if (startsOn && endsOn && endsOn < startsOn) return bad(res, 'La date de fin ne peut pas être avant le début.');
      await pool.query(
        'UPDATE bookings SET category=$2, name=$3, amount_eur=$4, status=$5, source_url=$6, starts_on=$7, ends_on=$8, location=$9 WHERE id=$1',
        [req.params.id, v.category, v.name, v.amountEur, v.status, pick('sourceUrl'), startsOn, endsOn, pick('location')]
      );
      res.json({ booking: await loadBooking(req.params.id, req.user.id) });
    } catch (err) { next(err); }
  });

  router.delete('/bookings/:id', async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM bookings b USING trips t WHERE b.id=$1 AND t.id=b.trip_id AND t.user_id=$2',
        [req.params.id, req.user.id]
      );
      rowCount ? res.json({ ok: true }) : notFound(res);
    } catch (err) { next(err); }
  });

  // ---- Paiements : ce qui est réellement payé, distinct de ce qui est réservé ----
  router.post('/bookings/:id/payments', async (req, res, next) => {
    try {
      const p = validatePayment(req.body);
      if (p.error) return bad(res, p.error);
      const booking = await loadBooking(req.params.id, req.user.id);
      if (!booking) return notFound(res);
      if (booking.amountEur === null) return bad(res, 'Renseignez d\'abord le montant de la réservation.');
      const paid = booking.payments.reduce((s, x) => s + x.amountEur, 0);
      if (paid + p.value.amountEur > booking.amountEur + 0.001) {
        return bad(res, `Ce paiement dépasserait le montant de la réservation (reste ${eur(booking.amountEur - paid)}).`);
      }
      await pool.query('INSERT INTO payments (booking_id, paid_on, amount_eur) VALUES ($1,$2,$3)', [req.params.id, p.value.date, p.value.amountEur]);
      res.status(201).json({ booking: await loadBooking(req.params.id, req.user.id) });
    } catch (err) { next(err); }
  });

  router.delete('/payments/:id', async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `DELETE FROM payments p USING bookings b, trips t
         WHERE p.id=$1 AND b.id=p.booking_id AND t.id=b.trip_id AND t.user_id=$2 RETURNING p.booking_id`,
        [req.params.id, req.user.id]
      );
      if (!rows[0]) return notFound(res);
      res.json({ booking: await loadBooking(rows[0].booking_id, req.user.id) });
    } catch (err) { next(err); }
  });

  return router;
}
