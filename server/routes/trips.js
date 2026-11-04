import express from 'express';
import { UUID, validateBooking, validatePayment, validateTrip } from '../validate.js';
import { FxError, round2, toEur } from '../fx/rates.js';

const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;
const num = (n, code) => `${n.toFixed(2).replace('.', ',')} ${code}`;
const cents = (n) => Math.round(n * 100);
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
    b.currency, b.original_amount, b.fx_rate, to_char(b.fx_date, 'YYYY-MM-DD') AS fx_date, b.fx_source, b.lat, b.lng, b.geo_query,
    COALESCE(json_agg(json_build_object('id', p.id, 'date', to_char(p.paid_on, 'YYYY-MM-DD'),
      'amount', p.original_amount::float8, 'amountEur', p.amount_eur::float8)
      ORDER BY p.paid_on, p.created_at) FILTER (WHERE p.id IS NOT NULL), '[]') AS payments
  FROM bookings b
  JOIN trips t ON t.id = b.trip_id
  LEFT JOIN payments p ON p.booking_id = b.id`;

const bookingOut = (r) => ({
  id: r.id, tripId: r.trip_id, category: r.category, name: r.name, status: r.status,
  amount: r.original_amount, currency: r.currency, amountEur: r.amount_eur,
  fxRate: r.fx_rate, fxDate: r.fx_date, fxSource: r.fx_source,
  sourceUrl: r.source_url, startsOn: r.starts_on, endsOn: r.ends_on, location: r.location, payments: r.payments,
  // Coordonnées valables seulement pour le lieu actuel ; geoDone = le lieu a déjà été recherché (même sans résultat).
  lat: r.location && r.geo_query === r.location ? r.lat : null,
  lng: r.location && r.geo_query === r.location ? r.lng : null,
  geoDone: !r.location || r.geo_query === r.location,
});

// Recalcule le montant en euros de chaque paiement avec le taux figé de la réservation.
// Méthode « cumulée » : la somme des paiements en euros tombe toujours juste (le dernier paiement
// qui solde la réservation reprend exactement le montant en euros de la réservation, sans écart d'un centime).
async function recomputePaymentsEur(client, bookingId) {
  const { rows: [b] } = await client.query('SELECT amount_eur, original_amount, fx_rate FROM bookings WHERE id=$1', [bookingId]);
  const { rows: pays } = await client.query('SELECT id, original_amount FROM payments WHERE booking_id=$1 ORDER BY paid_on, created_at, id', [bookingId]);
  let cumOrig = 0;
  let prevEur = 0;
  for (const p of pays) {
    cumOrig += cents(p.original_amount);
    const eurAfter = b.original_amount !== null && cumOrig === cents(b.original_amount) ? b.amount_eur : round2(cumOrig / 100 / b.fx_rate);
    await client.query('UPDATE payments SET amount_eur=$2 WHERE id=$1', [p.id, round2(eurAfter - prevEur)]);
    prevEur = eurAfter;
  }
}

export function createTripRoutes(pool, fx) {
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
  // Taux à appliquer : euros = 1, taux manuel saisi, ou taux du jour (puis figé sur la réservation).
  async function resolveRate(v) {
    const today = todayIso();
    if (v.currency === 'EUR') return { rate: 1, date: today, source: 'EUR' };
    if (v.manualRate) return { rate: v.manualRate, date: today, source: 'Saisi à la main' };
    const r = await fx.getRate(v.currency);
    return { rate: r.rate, date: r.date, source: r.source };
  }

  async function withTx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const fxFail = (res, err) => res.status(err.status).json({ error: err.message, code: err.code });

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
      const r = await resolveRate(v);
      const amountEur = v.amount === null ? null : toEur(v.amount, r.rate);
      if (amountEur !== null && amountEur > 9_999_999_999) return bad(res, 'Le montant converti est trop élevé.');
      const { rows } = await pool.query(
        `INSERT INTO bookings (trip_id, category, name, amount_eur, status, source_url, starts_on, ends_on, location, currency, original_amount, fx_rate, fx_date, fx_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [req.params.id, v.category, v.name, amountEur, v.status, v.sourceUrl ?? null, v.startsOn ?? null, v.endsOn ?? null, v.location ?? null,
          v.currency, v.amount, r.rate, r.date, r.source]
      );
      res.status(201).json({ booking: await loadBooking(rows[0].id, req.user.id) });
    } catch (err) {
      if (err instanceof FxError) return fxFail(res, err);
      next(err);
    }
  });

  router.put('/bookings/:id', async (req, res, next) => {
    try {
      const p = validateBooking(req.body);
      if (p.error) return bad(res, p.error);
      const current = await loadBooking(req.params.id, req.user.id);
      if (!current) return notFound(res);
      const v = p.value;
      const paid = current.payments.reduce((s, x) => s + x.amount, 0);
      const currencyChanged = v.currency !== current.currency;
      if (currencyChanged && current.payments.length) return bad(res, 'Cette réservation a déjà des paiements : supprimez-les avant de changer sa devise.');
      if (paid > 0 && v.amount === null) return bad(res, 'Cette réservation a déjà des paiements : le montant est obligatoire.');
      if (v.amount !== null && cents(v.amount) < cents(paid)) return bad(res, `Le montant ne peut pas être inférieur aux paiements déjà enregistrés (${num(paid, v.currency)}).`);

      // Le taux reste FIGÉ tant qu'on ne change ni la devise, ni le taux, et qu'on ne demande pas de l'actualiser.
      const keep = !currencyChanged && !v.manualRate && !v.refreshRate;
      const r = keep ? { rate: current.fxRate, date: current.fxDate, source: current.fxSource } : await resolveRate(v);
      const amountEur = v.amount === null ? null : toEur(v.amount, r.rate);
      if (amountEur !== null && amountEur > 9_999_999_999) return bad(res, 'Le montant converti est trop élevé.');

      const pick = (key) => (v[key] === undefined ? current[key] : v[key]); // détail absent : valeur conservée
      const startsOn = pick('startsOn');
      const endsOn = pick('endsOn');
      if (startsOn && endsOn && endsOn < startsOn) return bad(res, 'La date de fin ne peut pas être avant le début.');

      await withTx(async (client) => {
        await client.query(
          `UPDATE bookings SET category=$2, name=$3, amount_eur=$4, status=$5, source_url=$6, starts_on=$7, ends_on=$8, location=$9,
             currency=$10, original_amount=$11, fx_rate=$12, fx_date=$13, fx_source=$14 WHERE id=$1`,
          [req.params.id, v.category, v.name, amountEur, v.status, pick('sourceUrl'), startsOn, endsOn, pick('location'), v.currency, v.amount, r.rate, r.date, r.source]
        );
        await recomputePaymentsEur(client, req.params.id);
      });
      res.json({ booking: await loadBooking(req.params.id, req.user.id) });
    } catch (err) {
      if (err instanceof FxError) return fxFail(res, err);
      next(err);
    }
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

  // ---- Paiements : saisis dans la devise de la réservation, convertis au taux figé de la réservation ----
  router.post('/bookings/:id/payments', async (req, res, next) => {
    try {
      const p = validatePayment(req.body);
      if (p.error) return bad(res, p.error);
      const booking = await loadBooking(req.params.id, req.user.id);
      if (!booking) return notFound(res);
      if (booking.amount === null) return bad(res, 'Renseignez d\'abord le montant de la réservation.');
      const paid = booking.payments.reduce((s, x) => s + x.amount, 0);
      if (cents(paid) + cents(p.value.amount) > cents(booking.amount)) {
        return bad(res, `Ce paiement dépasserait le montant de la réservation (reste ${num(booking.amount - paid, booking.currency)}).`);
      }
      await withTx(async (client) => {
        await client.query('INSERT INTO payments (booking_id, paid_on, original_amount, amount_eur) VALUES ($1,$2,$3,0)', [req.params.id, p.value.date, p.value.amount]);
        await recomputePaymentsEur(client, req.params.id);
      });
      res.status(201).json({ booking: await loadBooking(req.params.id, req.user.id) });
    } catch (err) { next(err); }
  });

  router.delete('/payments/:id', async (req, res, next) => {
    try {
      const out = await withTx(async (client) => {
        const { rows } = await client.query(
          `DELETE FROM payments p USING bookings b, trips t
           WHERE p.id=$1 AND b.id=p.booking_id AND t.id=b.trip_id AND t.user_id=$2 RETURNING p.booking_id`,
          [req.params.id, req.user.id]
        );
        if (rows[0]) await recomputePaymentsEur(client, rows[0].booking_id);
        return rows[0];
      });
      if (!out) return notFound(res);
      res.json({ booking: await loadBooking(out.booking_id, req.user.id) });
    } catch (err) { next(err); }
  });

  return router;
}
