// Photos de villes via l'API gratuite d'Unsplash (clé gratuite, sans carte bancaire).
// Règles Unsplash respectées : photos affichées depuis images.unsplash.com, nom du photographe cité avec lien,
// et signalement « téléchargement » (download_location) quand une photo est retenue.
// La clé vient de la variable d'environnement UNSPLASH_ACCESS_KEY : jamais dans le code.

const IMG = /^https:\/\/images\.unsplash\.com\/[^\s'"\\<>]+$/;
const LINK = /^https:\/\/unsplash\.com\/[^\s'"\\<>]*$/;
const MAX_PHOTOS = 6;
const UTM = 'utm_source=travel_planner&utm_medium=referral';

const withUtm = (u) => `${u}${u.includes('?') ? '&' : '?'}${UTM}`;

export function parseUnsplash(data) {
  const out = [];
  for (const r of Array.isArray(data?.results) ? data.results : []) {
    const url = r?.urls?.regular;
    const author = typeof r?.user?.name === 'string' ? r.user.name.slice(0, 80) : '';
    const profile = r?.user?.links?.html;
    if (typeof url !== 'string' || !IMG.test(url) || !author || typeof profile !== 'string' || !LINK.test(profile)) continue;
    const dl = typeof r?.links?.download_location === 'string' && r.links.download_location.startsWith('https://api.unsplash.com/') ? r.links.download_location : null;
    out.push({ url, author, link: withUtm(profile), source: 'unsplash', dl });
    if (out.length === MAX_PHOTOS) break;
  }
  return out;
}

export function createUnsplash({ key = process.env.UNSPLASH_ACCESS_KEY, fetchJson } = {}) {
  const get = fetchJson ?? (async (url) => {
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  const enabled = Boolean(key) || Boolean(fetchJson);
  // Renvoie une liste de photos (vide si rien n'est trouvé ou si le service ne répond pas).
  const search = async (query) => {
    if (!enabled) return [];
    const q = String(query ?? '').trim().slice(0, 100);
    if (!q) return [];
    try {
      const photos = parseUnsplash(await get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=10&orientation=landscape&content_filter=high`));
      for (const p of photos) if (p.dl) get(p.dl).catch(() => {}); // signalement d'usage, sans attendre
      return photos.map(({ dl, ...p }) => p);
    } catch { return []; }
  };
  return { search, enabled };
}
