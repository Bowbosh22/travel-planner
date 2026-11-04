// Géocodage (texte → coordonnées) avec Nominatim / OpenStreetMap : gratuit, sans compte.
// Règles d'usage respectées : une requête par seconde au maximum, identification de l'application, usage léger.
// Le serveur n'interroge QUE cette adresse fixe ; seul le texte du lieu varie (aucun risque de SSRF).

const HOST = 'https://nominatim.openstreetmap.org/search';

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
  return { lat, lng };
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
      return parseNominatim(await fetchJson(`${HOST}?format=jsonv2&limit=1&q=${encodeURIComponent(String(query).slice(0, 200))}`));
    };
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  };
  return { geocode };
}
