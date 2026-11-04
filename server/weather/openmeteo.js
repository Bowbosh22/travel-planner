// Météo et fuseau horaire d'une ville avec Open-Meteo : gratuit, sans compte ni clé.
// Le serveur n'interroge que deux adresses fixes ; seul le nom de la ville varie (aucun risque de SSRF).

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const TTL_MS = 20 * 60 * 1000;

async function defaultFetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TravelPlanner-personal-app/1.0' }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Codes météo WMO → libellé français et pictogramme.
export function describeWeather(code) {
  if (code === 0) return { label: 'Ciel dégagé', kind: 'sun' };
  if (code === 1 || code === 2) return { label: 'Peu nuageux', kind: 'partly' };
  if (code === 3) return { label: 'Couvert', kind: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Brouillard', kind: 'fog' };
  if (code >= 51 && code <= 57) return { label: 'Bruine', kind: 'rain' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Pluie', kind: 'rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Neige', kind: 'snow' };
  if (code >= 95 && code <= 99) return { label: 'Orage', kind: 'storm' };
  return { label: 'Variable', kind: 'cloud' };
}

const TIMEZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/;

export function parseWeather(geo, forecast) {
  const place = geo?.results?.[0];
  const cur = forecast?.current;
  const temp = Number(cur?.temperature_2m);
  const code = Number(cur?.weather_code);
  const timezone = typeof forecast?.timezone === 'string' ? forecast.timezone : place?.timezone;
  if (!place || !Number.isFinite(temp) || !Number.isFinite(code) || typeof timezone !== 'string' || !TIMEZONE.test(timezone)) return null;
  return { tempC: Math.round(temp), timezone, ...describeWeather(code) };
}

export function createWeather({ fetchJson = defaultFetchJson, now = () => Date.now() } = {}) {
  const cache = new Map();
  // Renvoie {tempC, label, kind, timezone}, ou null si la ville est introuvable ou le service indisponible.
  const get = async (destination) => {
    const name = String(destination ?? '').split(',')[0].trim().slice(0, 80);
    if (!name) return null;
    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    try {
      const geo = await fetchJson(`${GEO}?name=${encodeURIComponent(name)}&count=1&language=fr&format=json`);
      const p = geo?.results?.[0];
      if (!p || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude))) return null;
      const forecast = await fetchJson(`${FORECAST}?latitude=${Number(p.latitude)}&longitude=${Number(p.longitude)}&current=temperature_2m,weather_code&timezone=auto`);
      const value = parseWeather(geo, forecast);
      if (value) cache.set(key, { at: now(), value });
      return value;
    } catch { return null; }
  };
  return { get };
}
