// Suggestions de villes et de pays pendant la saisie (Open-Meteo Geocoding : gratuit, sans compte, en français).
// Le serveur n'interroge QUE cette adresse fixe ; seul le texte saisi varie (aucun risque de SSRF).
const HOST = 'https://geocoding-api.open-meteo.com/v1/search';

async function defaultFetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TravelPlanner-personal-app/1.0' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120);

export function parseSuggestions(data, type) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(data?.results) ? data.results : []) {
    const name = clean(p.name);
    if (!name) continue;
    const isCountry = String(p.feature_code ?? '').startsWith('PCL');
    if (type === 'country') {
      if (!isCountry) continue;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ country: name });
    } else {
      if (isCountry) continue;
      const country = clean(p.country);
      const region = clean(p.admin1);
      const key = `${name}|${region}|${country}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ city: name, region: region && region !== name ? region : '', country });
    }
  }
  return out.slice(0, 8);
}

export function createSuggest({ fetchJson = defaultFetchJson, ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const cache = new Map();
  // Renvoie une liste (vide si rien) ; lève une erreur si le service est indisponible.
  return async function suggest(query, type = 'city') {
    const q = clean(query);
    if (q.length < 2) return [];
    const kind = type === 'country' ? 'country' : 'city';
    const key = `${kind}:${q.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    const url = `${HOST}?name=${encodeURIComponent(q)}&count=${kind === 'country' ? 15 : 10}&language=fr&format=json`;
    const value = parseSuggestions(await fetchJson(url), kind);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: now() + ttlMs });
    return value;
  };
}
