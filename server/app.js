import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.js';
import { createTripRoutes } from './routes/trips.js';
import { createImportRoutes } from './routes/import.js';
import { createFxRoutes } from './routes/fx.js';
import { createFxService } from './fx/rates.js';
import { createDocumentRoutes } from './routes/documents.js';
import { createGeoRoutes } from './routes/geo.js';
import { createGeocoder } from './geo/nominatim.js';
import { createSuggest } from './geo/suggest.js';
import { createPhotoFinder } from './images/photos.js';
import { createWeather } from './weather/openmeteo.js';
import { createWeatherRoutes } from './routes/weather.js';
import { createInviteRoutes } from './routes/invites.js';
import { createStopRoutes } from './routes/stops.js';
import { rateLimit } from './ratelimit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// importOptions : réservé aux tests (autoriser un serveur local). Jamais piloté par une variable d'environnement.
export function createApp(pool, { isProd = process.env.NODE_ENV === 'production', importOptions = {}, fx = createFxService(pool), geocoder = createGeocoder(), suggest = createSuggest(), images = createPhotoFinder(), weather = createWeather(), limits = {} } = {}) {
  const maxRegistrations = limits.registrationsPerHour ?? 10; // réglable pour les tests uniquement
  const app = express();
  app.use(compression()); // pages, scripts et données compressés : chargement bien plus rapide, surtout sur mobile
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
          imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com', 'https://server.arcgisonline.com', 'https://upload.wikimedia.org', 'https://images.unsplash.com'], // fonds de carte OpenStreetMap + photos des villes (Unsplash, Wikipédia)
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: isProd ? [] : null,
        },
      },
    })
  );

  // Réveil léger pour un service de « ping » : ne touche pas la base (qui peut ainsi se mettre en veille).
  app.get('/api/ping', (_req, res) => res.type('text/plain').send('ok'));

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database_unavailable' });
    }
  });

  // Les réponses de l'API contiennent des données personnelles : jamais mises en cache ; capteurs du navigateur désactivés.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });

  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
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

  const writeLimit = rateLimit({ max: 300, windowMs: 60 * 1000 });
  const auth = createAuth(pool, { secureCookie: isProd });
  api.use(auth.loadUser);
  api.use('/auth/register', rateLimit({ max: maxRegistrations, windowMs: 60 * 60 * 1000, key: (req) => req.ip, message: 'Trop d\'inscriptions depuis cette adresse. Réessayez plus tard.' }));
  api.use('/auth', auth.router);
  api.use(createInviteRoutes(pool, auth.requireUser));
  // Filet de sécurité : au plus 300 écritures par minute et par utilisateur connecté.
  api.use(auth.requireUser, (req, res, next) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : writeLimit(req, res, next)));
  api.use(auth.requireUser, createImportRoutes(importOptions), createFxRoutes(fx), createTripRoutes(pool, fx, images), createDocumentRoutes(pool), createGeoRoutes(pool, geocoder, suggest), createWeatherRoutes(pool, weather), createStopRoutes(pool, fx, geocoder));

  api.use((_req, res) => res.status(404).json({ error: 'Introuvable.' }));
  // JSON invalide, etc. : jamais de trace technique envoyée au navigateur.
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop volumineux (5 Mo maximum).' });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne. Réessayez.' });
  });
  app.use('/api', api);

  app.use('/vendor/leaflet', express.static(path.join(root, 'node_modules', 'leaflet', 'dist'), { maxAge: '1d' }));
  app.use('/vendor/chart.js', express.static(path.join(root, 'node_modules', 'chart.js', 'dist'), { maxAge: '1d' }));
  // no-cache : le navigateur revérifie à chaque visite (ETag), donc une mise à jour du site s'affiche tout de suite.
  // Images et données : longue durée de cache (elles changent rarement) ; le code reste revalidé à chaque visite.
  app.use('/img', express.static(path.join(root, 'client', 'img'), { maxAge: '7d' }));
  app.use('/data', express.static(path.join(root, 'client', 'data'), { maxAge: '7d' }));
  app.use(express.static(path.join(root, 'client'), { extensions: ['html'], setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  app.use((_req, res) => res.status(404).type('text/plain').send('Page introuvable'));
  return app;
}
