import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const pool = createPool();

const applied = await migrate(pool);
if (applied.length) console.log(`Migrations appliquées : ${applied.join(', ')}`);

// Nettoyage des sessions expirées : au démarrage puis chaque heure.
const purge = () => pool.query('DELETE FROM sessions WHERE expires_at < now()').catch((err) => console.warn('Nettoyage des sessions impossible :', err.message));
await purge();
const timer = setInterval(purge, 60 * 60 * 1000);
timer.unref();

const server = createApp(pool).listen(port, () => console.log(`Travel Planner : http://localhost:${port}`));

// Arrêt propre (redéploiement Render) : on termine les requêtes en cours puis on ferme la base.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => { await pool.end().catch(() => {}); process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
