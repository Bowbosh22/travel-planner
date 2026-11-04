// Contours des pays (Natural Earth, domaine public) : sert à surligner le pays de départ et de destination.
let cache = null;
export const loadCountries = () => (cache ??= fetch('/data/countries.json').then((r) => (r.ok ? r.json() : null)).catch(() => null));

const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPolygon = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));

// Pays contenant le point {lat,lng}, ou null (îles trop petites pour le tracé simplifié, océan…).
export function countryAt(fc, pt) {
  if (!fc || !pt) return null;
  for (const f of fc.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (polys.some((p) => inPolygon(pt.lng, pt.lat, p))) return f;
  }
  return null;
}
