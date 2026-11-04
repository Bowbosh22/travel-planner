import pg from 'pg';

// Les dates SQL restent des chaînes « 2026-12-12 » (pas de décalage de fuseau) et
// les montants numeric deviennent des nombres.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL manquant : indiquez l\'adresse de la base PostgreSQL.');
  }
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString) || connectionString.includes('host=/');
  return new pg.Pool({
    connectionString,
    max: 10,
    // Railway (réseau privé) n'exige pas de TLS ; une base externe oui.
    ssl: process.env.PGSSL === 'true' && !local ? { rejectUnauthorized: false } : undefined,
  });
}
