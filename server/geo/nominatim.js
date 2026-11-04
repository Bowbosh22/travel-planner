// Géocodage (texte → coordonnées) avec Nominatim / OpenStreetMap : gratuit, sans compte.
// Règles d'usage respectées : une requête par seconde au maximum, identification de l'application, usage léger.
// Le serveur n'interroge QUE cette adresse fixe ; seul le texte du lieu varie (aucun risque de SSRF).

const HOST = 'https://nominatim.openstreetmap.org/search';
const FALLBACK = 'https://geocoding-api.open-meteo.com/v1/search'; // secours gratuit si Nominatim refuse ou ne trouve rien

async function defaultFetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TravelPlanner-personal-app/1.0' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function parseNominatim(data) {
  const first = Array.isArray(data) ? data[0] : null;
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  if (!first || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // Emprise du lieu [sud, ouest, nord, est] si Nominatim la fournit (utile pour cadrer un pays).
  const [south, north, west, east] = (Array.isArray(first.boundingbox) ? first.boundingbox : []).map(Number);
  const box = [south, west, north, east].every(Number.isFinite) && south >= -90 && north <= 90 && west >= -180 && east <= 180 && south <= north ? [south, west, north, east] : null;
  return box ? { lat, lng, box } : { lat, lng };
}

export function parseOpenMeteo(data) {
  const p = data?.results?.[0];
  const lat = Number(p?.latitude);
  const lng = Number(p?.longitude);
  return p && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export function createGeocoder({ fetchJson = defaultFetchJson, minIntervalMs = 1100, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let chain = Promise.resolve();
  let last = 0;
  // Renvoie {lat,lng}, ou null si le lieu est introuvable ; lève une erreur si le service est indisponible.
  const geocode = (query) => {
    const run = async () => {
      const delay = last + minIntervalMs - Date.now();
      if (delay > 0) await wait(delay);
      last = Date.now();
      const text = String(query).slice(0, 200);
      let found = null;
      let failed = null;
      try { found = parseNominatim(await fetchJson(`${HOST}?format=jsonv2&limit=1&q=${encodeURIComponent(text)}`)); } catch (err) { failed = err; }
      if (found) return found;
      // Nominatim indisponible (ou lieu inconnu) : on tente Open-Meteo avec le nom de la ville seul.
      const name = text.split(',')[0].trim();
      try { return name ? parseOpenMeteo(await fetchJson(`${FALLBACK}?name=${encodeURIComponent(name)}&count=1&language=fr&format=json`)) : null; }
      catch (err) { throw failed ?? err; }
    };
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  };
  return { geocode };
}
