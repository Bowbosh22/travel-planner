import { joinByToken, INVITE_TOKEN } from './access.js';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import { validateRegistration, validateFirstName } from './validate.js';
import { validatePrefs, mergePrefs } from './prefs.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'tp_session';
const DAY = 24 * 60 * 60 * 1000;
const REMEMBER_MS = 30 * DAY; // « se souvenir de moi »
const SHORT_MS = 12 * 60 * 60 * 1000; // sinon : cookie de session, 12 h maximum côté serveur

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Codes de récupération : 8 codes de 10 caractères (sans 0/O/1/I/L pour éviter les confusions), affichés une seule fois.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_COUNT = 8;
const newRecoveryCode = () => {
  const c = Array.from({ length: 10 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
};
const normalizeCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const codeHash = (v) => sha256(`recovery:${normalizeCode(v)}`);

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const publicUser = (u) => ({ id: u.id, email: u.email, firstName: u.first_name, theme: { color: u.theme_color, mode: u.theme_mode }, prefs: u.prefs ?? {} });

// Anti force brute : 8 échecs par adresse email + IP sur 15 minutes.
function createLimiter(max = 8, windowMs = 15 * 60 * 1000) {
  const hits = new Map();
  return {
    blocked(key) {
      const e = hits.get(key);
      return !!e && e.resetAt > Date.now() && e.count >= max;
    },
    fail(key) {
      const now = Date.now();
      const e = hits.get(key);
      if (!e || e.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
      else e.count += 1;
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    },
    clear: (key) => hits.delete(key),
  };
}

export function createAuth(pool, { secureCookie = false } = {}) {
  const limiter = createLimiter();
  const resetLimiter = createLimiter(5); // 5 essais par e-mail + adresse sur 15 minutes
  const resetIpLimiter = createLimiter(20);

  // Remplace tous les codes de l'utilisateur par un nouveau lot ; renvoie les codes en clair (une seule fois).
  async function issueRecoveryCodes(userId) {
    const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
      for (const c of codes) await client.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, codeHash(c)]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return codes;
  }
  const ipLimiter = createLimiter(40); // filet : trop d'échecs depuis une même adresse, quels que soient les emails essayés

  async function startSession(req, res, userId, remember) {
    const token = crypto.randomBytes(32).toString('base64url');
    const ttl = remember ? REMEMBER_MS : SHORT_MS;
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)', [sha256(token), userId, new Date(Date.now() + ttl), String(req.headers['user-agent'] ?? '').slice(0, 300)]);
    const opts = { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/' };
    if (remember) opts.maxAge = ttl; // sans maxAge : cookie de session, effacé à la fermeture du navigateur
    res.cookie(COOKIE, token, opts);
  }

  // Middleware : charge req.user si la session est valide.
  async function loadUser(req, _res, next) {
    try {
      const token = readCookie(req, COOKIE);
      if (token) {
        const { rows } = await pool.query(
          `SELECT u.*, s.id AS session_id, s.last_seen_at AS session_seen FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1 AND s.expires_at > now()`,
          [sha256(token)]
        );
        if (rows[0]) {
          req.user = rows[0];
          req.sessionId = rows[0].session_id;
          // dernière activité : au plus une écriture toutes les 10 minutes par appareil
          if (Date.now() - new Date(rows[0].session_seen).getTime() > 10 * 60 * 1000) pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [rows[0].session_id]).catch(() => {});
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  }

  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Connexion requise.' }));

  const router = express.Router();

  router.post('/register', async (req, res, next) => {
    try {
      // Inscriptions fermées : seule une invitation valide à un voyage permet de créer un compte.
      const invite = typeof req.body.invite === 'string' && INVITE_TOKEN.test(req.body.invite) ? req.body.invite : null;
      if (process.env.ALLOW_REGISTRATION === 'false') {
        const valid = invite && (await pool.query('SELECT 1 FROM trips WHERE invite_token = $1', [invite])).rowCount > 0;
        if (!valid) {
          // Pas d'invitation : la demande est mise en attente, le propriétaire du site l'approuve ou la refuse.
          const asked = validateRegistration(req.body);
          if (asked.error) return res.status(400).json({ error: asked.error });
          const a = asked.value;
          if ((await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [a.email])).rowCount) return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
          if ((await pool.query('SELECT count(*)::int AS n FROM access_requests')).rows[0].n >= 50) return res.status(429).json({ error: 'Trop de demandes en attente. Réessayez plus tard.' });
          const h = await hashPassword(a.password);
          await pool.query(
            `INSERT INTO access_requests (email, first_name, password_hash) VALUES ($1, $2, $3)
             ON CONFLICT (lower(email)) DO UPDATE SET first_name = EXCLUDED.first_name, password_hash = EXCLUDED.password_hash, created_at = now()`,
            [a.email, a.firstName, h]
          );
          return res.status(202).json({ pending: true });
        }
      }
      const parsed = validateRegistration(req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { firstName, email, password } = parsed.value;
      const hash = await hashPassword(password);
      let user;
      try {
        ({ rows: [user] } = await pool.query('INSERT INTO users (email, first_name, password_hash) VALUES ($1, $2, $3) RETURNING *', [email, firstName, hash]));
      } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
        throw err;
      }
      if (invite) await joinByToken(pool, user.id, invite); // le nouveau compte rejoint le voyage tout de suite
      const recoveryCodes = await issueRecoveryCodes(user.id);
      await startSession(req, res, user.id, req.body.remember === true);
      res.status(201).json({ user: publicUser(user), recoveryCodes });
    } catch (err) {
      next(err);
    }
  });

  // L'écran de connexion adapte son texte : « Créer un compte » ou « Demander l'accès ».
  router.get('/config', (_req, res) => res.json({ registrationOpen: process.env.ALLOW_REGISTRATION !== 'false' }));

  // Propriétaire du site : l'adresse ADMIN_EMAIL si elle est définie, sinon le tout premier compte créé.
  const requireAdmin = async (req, res, next) => {
    try {
      const adminEmail = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
      const ok = adminEmail
        ? req.user.email.toLowerCase() === adminEmail
        : (await pool.query('SELECT id FROM users ORDER BY created_at, id LIMIT 1')).rows[0]?.id === req.user.id;
      return ok ? next() : res.status(403).json({ error: 'Réservé au propriétaire du site.' });
    } catch (err) { return next(err); }
  };

  router.get('/access-requests', requireUser, requireAdmin, async (_req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT id, email, first_name, created_at FROM access_requests ORDER BY created_at');
      res.json({ requests: rows.map((r) => ({ id: r.id, email: r.email, firstName: r.first_name, createdAt: r.created_at })) });
    } catch (err) { next(err); }
  });

  router.post('/access-requests/:id/approve', requireUser, requireAdmin, async (req, res, next) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Introuvable.' });
      const { rows: [r] } = await pool.query('SELECT * FROM access_requests WHERE id = $1', [req.params.id]);
      if (!r) return res.status(404).json({ error: 'Introuvable.' });
      try {
        await pool.query('INSERT INTO users (email, first_name, password_hash) VALUES ($1, $2, $3)', [r.email, r.first_name, r.password_hash]);
      } catch (err) {
        if (err.code === '23505') { await pool.query('DELETE FROM access_requests WHERE id = $1', [r.id]); return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' }); }
        throw err;
      }
      await pool.query('DELETE FROM access_requests WHERE id = $1', [r.id]);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.delete('/access-requests/:id', requireUser, requireAdmin, async (req, res, next) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Introuvable.' });
      await pool.query('DELETE FROM access_requests WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const key = `${req.ip}|${email}`;
      if (limiter.blocked(key) || ipLimiter.blocked(req.ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
      // On vérifie toujours un hash (même si le compte n'existe pas) : temps de réponse identique.
      const ok = await verifyPassword(password, rows[0]?.password_hash ?? 'scrypt$AAAA$AAAA');
      if (!rows[0] || !ok) {
        limiter.fail(key);
        ipLimiter.fail(req.ip);
        return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
      }
      limiter.clear(key);
      await startSession(req, res, rows[0].id, req.body.remember === true);
      res.json({ user: publicUser(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

  // Mot de passe oublié : e-mail + un code de récupération non utilisé + nouveau mot de passe.
  router.post('/reset-password', async (req, res, next) => {
    try {
      const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const key = `${req.ip}|${email}`;
      if (resetLimiter.blocked(key) || resetIpLimiter.blocked(req.ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      if (password.length < 10) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 10 caractères.' });
      if (password.length > 200) return res.status(400).json({ error: 'Le mot de passe est trop long.' });
      const { rows } = await pool.query(
        `SELECT u.id, rc.id AS code_id FROM users u JOIN recovery_codes rc ON rc.user_id = u.id
         WHERE lower(u.email) = $1 AND rc.code_hash = $2 AND rc.used_at IS NULL`,
        [email, codeHash(req.body.code)]
      );
      if (!rows[0]) {
        resetLimiter.fail(key);
        resetIpLimiter.fail(req.ip);
        return res.status(400).json({ error: 'E-mail ou code de récupération incorrect.' });
      }
      const hash = await hashPassword(password);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const used = await client.query('UPDATE recovery_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL', [rows[0].code_id]);
        if (used.rowCount !== 1) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'E-mail ou code de récupération incorrect.' }); }
        await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [rows[0].id, hash]);
        await client.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]); // déconnecte tous les appareils
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      resetLimiter.clear(key);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Préférences (devise d'affichage, page de lancement, taille du texte, disposition du tableau de bord).
  router.put('/prefs', requireUser, async (req, res, next) => {
    try {
      const parsed = validatePrefs(req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { rows } = await pool.query('UPDATE users SET prefs = $2::jsonb WHERE id = $1 RETURNING *', [req.user.id, JSON.stringify(mergePrefs(req.user.prefs, parsed.value))]);
      res.json({ prefs: rows[0].prefs });
    } catch (err) { next(err); }
  });

  // Appareils connectés.
  const deviceLabel = (ua = '') => {
    const os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Appareil inconnu';
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /(Chrome|CriOS)\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
    return `${browser} · ${os}`;
  };
  router.get('/sessions', requireUser, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT id, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC', [req.user.id]);
      res.json({ sessions: rows.map((r) => ({ id: r.id, device: deviceLabel(r.user_agent ?? ''), createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === req.sessionId })) });
    } catch (err) { next(err); }
  });
  router.delete('/sessions/:id', requireUser, async (req, res, next) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || req.params.id === req.sessionId) return res.status(404).json({ error: 'Introuvable.' });
      const { rowCount } = await pool.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Introuvable.' });
    } catch (err) { next(err); }
  });
  router.delete('/sessions', requireUser, async (req, res, next) => {
    try {
      const { rowCount } = await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user.id, req.sessionId]);
      res.json({ closed: rowCount });
    } catch (err) { next(err); }
  });

  // Changement du prénom affiché.
  router.patch('/profile', requireUser, async (req, res, next) => {
    try {
      const parsed = validateFirstName(req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { rows } = await pool.query('UPDATE users SET first_name = $2 WHERE id = $1 RETURNING *', [req.user.id, parsed.value]);
      res.json({ user: publicUser(rows[0]) });
    } catch (err) { next(err); }
  });

  // Changement de mot de passe : mot de passe actuel + nouveau mot de passe (confirmé). Les AUTRES sessions sont fermées.
  router.post('/change-password', requireUser, async (req, res, next) => {
    try {
      const { current, password, confirm } = req.body ?? {};
      const key = `${req.ip}|${req.user.email.toLowerCase()}`;
      if (limiter.blocked(key)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      if (typeof current !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Requête invalide.' });
      if (password.length < 10) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 10 caractères.' });
      if (password.length > 200) return res.status(400).json({ error: 'Le mot de passe est trop long.' });
      if (confirm !== undefined && confirm !== password) return res.status(400).json({ error: 'La confirmation ne correspond pas au nouveau mot de passe.' });
      if (!(await verifyPassword(current, req.user.password_hash))) { limiter.fail(key); return res.status(401).json({ error: 'Mot de passe actuel incorrect.' }); }
      limiter.clear(key);
      if (current === password) return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent de l\'actuel.' });
      const hash = await hashPassword(password);
      const mine = sha256(readCookie(req, COOKIE) ?? '');
      await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, hash]);
      await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.id, mine]);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Codes de récupération du compte connecté : nombre restant, et nouveau lot (mot de passe demandé).
  router.get('/recovery-codes', requireUser, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [req.user.id]);
      res.json({ remaining: rows[0].n });
    } catch (err) { next(err); }
  });
  router.post('/recovery-codes', requireUser, async (req, res, next) => {
    try {
      const key = `${req.ip}|${req.user.email.toLowerCase()}`;
      if (limiter.blocked(key)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      const ok = await verifyPassword(typeof req.body.password === 'string' ? req.body.password : '', req.user.password_hash);
      if (!ok) { limiter.fail(key); return res.status(401).json({ error: 'Mot de passe incorrect.' }); }
      limiter.clear(key);
      res.json({ codes: await issueRecoveryCodes(req.user.id) });
    } catch (err) { next(err); }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = readCookie(req, COOKIE);
      if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
      res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // 200 avec user: null quand personne n'est connecté : ce n'est pas une erreur, et la console reste propre.
  router.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

  router.patch('/theme', requireUser, async (req, res, next) => {
    try {
      const { color, mode } = req.body ?? {};
      const colors = ['paysage', 'bleu', 'gris', 'marron'];
      const modes = ['clair', 'sombre', 'auto'];
      if ((color !== undefined && !colors.includes(color)) || (mode !== undefined && !modes.includes(mode))) {
        return res.status(400).json({ error: 'Thème invalide.' });
      }
      const { rows } = await pool.query(
        'UPDATE users SET theme_color = COALESCE($2, theme_color), theme_mode = COALESCE($3, theme_mode) WHERE id = $1 RETURNING *',
        [req.user.id, color ?? null, mode ?? null]
      );
      res.json({ user: publicUser(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

  return { router, loadUser, requireUser };
}
