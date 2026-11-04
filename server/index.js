import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const pool = createPool();

const applied = await migrate(pool);
if (applied.length) console.log(`Migrations appliquées : ${applied.join(', ')}`);

createApp(pool).listen(port, () => console.log(`Travel Planner : http://localhost:${port}`));
