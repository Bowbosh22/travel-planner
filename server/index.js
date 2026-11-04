import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // 'unsafe-inline' uniquement pour les styles : le rendu pose quelques largeurs en ligne.
        styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // Désactivé en local (http://localhost), actif en production (HTTPS sur Railway).
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
  })
);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Chart.js est servi depuis node_modules : pas de CDN, pas de dépendance externe au rendu.
app.use(
  '/vendor/chart.js',
  express.static(path.join(root, 'node_modules', 'chart.js', 'dist'), { maxAge: '1d' })
);

app.use(express.static(path.join(root, 'client'), { extensions: ['html'] }));

app.use((_req, res) => {
  res.status(404).type('text/plain').send('Page introuvable');
});

app.listen(port, () => {
  console.log(`Travel Planner : http://localhost:${port}`);
});
