import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.js';
import { createTripRoutes } from './routes/trips.js';
import { createImportRoutes } from './routes/import.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// importOptions : réservé aux tests (autoriser un serveur local). Jamais piloté par une variable d'environnement.
export function createApp(pool, { isProd = process.env.NODE_ENV === 'production', importOptions = {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (isProd) app.set('trust proxy', 1); // Railway : HTTPS terminé en amont

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: isProd ? [] : null,
        },
      },
    })
  );

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database_unavailable' });
    }
  });

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));

  // Protection CSRF : en plus du cookie SameSite=Lax, toute écriture doit venir du site lui-même
  // (en-tête personnalisé + Origin identique si présent). Un site tiers ne peut pas envoyer cela.
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    const sameOrigin = !origin || new URL(origin).host === req.headers.host;
    if (req.headers['x-requested-with'] !== 'tp' || !sameOrigin) return res.status(403).json({ error: 'Requête refusée.' });
    next();
  });

  const auth = createAuth(pool, { secureCookie: isProd });
  api.use(auth.loadUser);
  api.use('/auth', auth.router);
  api.use(auth.requireUser, createImportRoutes(importOptions), createTripRoutes(pool));

  api.use((_req, res) => res.status(404).json({ error: 'Introuvable.' }));
  // JSON invalide, etc. : jamais de trace technique envoyée au navigateur.
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne. Réessayez.' });
  });
  app.use('/api', api);

  app.use('/vendor/chart.js', express.static(path.join(root, 'node_modules', 'chart.js', 'dist'), { maxAge: '1d' }));
  app.use(express.static(path.join(root, 'client'), { extensions: ['html'] }));
  app.use((_req, res) => res.status(404).type('text/plain').send('Page introuvable'));
  return app;
}
