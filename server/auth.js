import { joinByToken, INVITE_TOKEN } from './access.js';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import { validateRegistration } from './validate.js';

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

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const publicUser = (u) => ({ id: u.id, email: u.email, firstName: u.first_name, theme: { color: u.theme_color, mode: u.theme_mode } });

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
  const ipLimiter = createLimiter(40); // filet : trop d'échecs depuis une même adresse, quels que soient les emails essayés

  async function startSession(res, userId, remember) {
    const token = crypto.randomBytes(32).toString('base64url');
    const ttl = remember ? REMEMBER_MS : SHORT_MS;
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), userId, new Date(Date.now() + ttl)]);
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
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1 AND s.expires_at > now()`,
          [sha256(token)]
        );
        if (rows[0]) req.user = rows[0];
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
        if (!valid) return res.status(403).json({ error: 'Les inscriptions sont fermées.' });
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
      await startSession(res, user.id, req.body.remember === true);
      res.status(201).json({ user: publicUser(user) });
    } catch (err) {
      next(err);
    }
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
      await startSession(res, rows[0].id, req.body.remember === true);
      res.json({ user: publicUser(rows[0]) });
    } catch (err) {
      next(err);
    }
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
