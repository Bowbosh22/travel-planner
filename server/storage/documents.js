// Stockage des documents. Aujourd'hui : dans PostgreSQL (gratuit, aucun compte supplémentaire).
// Tout le reste de l'application passe par cette interface : un autre stockage (Cloudflare R2, par exemple)
// pourra la remplacer sans toucher aux routes ni à l'interface.

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 Mo par fichier
export const MAX_USER_BYTES = 200 * 1024 * 1024; // 200 Mo par utilisateur (la base gratuite fait 1 Go)

// Le type est déterminé par le CONTENU du fichier, jamais par son nom ni par ce qu'annonce le navigateur.
export function sniffMime(buf) {
  const b = buf;
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

// Nom d'affichage : sans chemin, sans caractères de contrôle ou invisibles, longueur limitée.
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060\\ufeff]', 'g');
export function cleanFileName(raw, ext) {
  let n = String(raw ?? '').normalize('NFC');
  n = n.replace(CONTROL, ' ').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^\.+/, '').slice(0, 110).trim();
  if (!n) n = 'document';
  return /\.[A-Za-z0-9]{2,4}$/.test(n) ? n : `${n}.${ext}`;
}

export function createDocumentStore(pool) {
  return {
    async usage(userId) {
      const { rows } = await pool.query('SELECT COALESCE(SUM(size_bytes),0)::float8 AS total FROM documents WHERE user_id=$1', [userId]);
      return rows[0].total;
    },
    async list(tripId, userId) {
      const { rows } = await pool.query(
        `SELECT d.id, d.name, d.mime, d.size_bytes, d.created_at, d.booking_id, b.name AS booking_name
         FROM documents d LEFT JOIN bookings b ON b.id = d.booking_id
         WHERE d.trip_id=$1 AND d.user_id=$2 ORDER BY d.created_at DESC`,
        [tripId, userId]
      );
      return rows.map((r) => ({ id: r.id, name: r.name, mime: r.mime, size: r.size_bytes, createdAt: r.created_at, bookingId: r.booking_id, bookingName: r.booking_name }));
    },
    async put({ userId, tripId, bookingId, name, mime, data }) {
      const { rows } = await pool.query(
        `INSERT INTO documents (user_id, trip_id, booking_id, name, mime, size_bytes, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, name, mime, size_bytes, created_at, booking_id`,
        [userId, tripId, bookingId ?? null, name, mime, data.length, data]
      );
      const r = rows[0];
      return { id: r.id, name: r.name, mime: r.mime, size: r.size_bytes, createdAt: r.created_at, bookingId: r.booking_id, bookingName: null };
    },
    async get(id, userId) {
      const { rows } = await pool.query('SELECT name, mime, data FROM documents WHERE id=$1 AND user_id=$2', [id, userId]);
      return rows[0] ?? null;
    },
    async remove(id, userId) {
      const { rowCount } = await pool.query('DELETE FROM documents WHERE id=$1 AND user_id=$2', [id, userId]);
      return rowCount > 0;
    },
  };
}
