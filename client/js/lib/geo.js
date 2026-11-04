// Calculs géographiques pour le trajet en avion (aucune dépendance).

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Distance à vol d'oiseau en km (formule de haversine).
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Durée de vol approximative : 800 km/h + 30 min de montée et descente.
export const flightMinutes = (km) => Math.round((km / 800) * 60 + 30);

// Points de l'arc de grand cercle entre a et b (route réelle d'un avion), longitudes continues pour Leaflet.
export function greatCircle(a, b, steps = 64) {
  const [la1, lo1, la2, lo2] = [rad(a.lat), rad(a.lng), rad(b.lat), rad(b.lng)];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (!Number.isFinite(d) || d < 1e-9) return [[a.lat, a.lng], [b.lat, b.lng]];
  const pts = [];
  let prevLng = a.lng;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    let lng = deg(Math.atan2(y, x));
    while (lng - prevLng > 180) lng -= 360; // pas de saut de ±360° au passage de la ligne de date
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    pts.push([deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lng]);
  }
  return pts;
}

// Cap (en degrés, 0 = nord) entre deux points consécutifs : sert à orienter l'avion.
export function bearing(p, q) {
  const [la1, la2, dLo] = [rad(p[0]), rad(q[0]), rad(q[1] - p[1])];
  const y = Math.sin(dLo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export const formatDuration = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;

// Estimation d'un trajet entre deux lieux (sans service d'itinéraire) : distance à vol d'oiseau, allongée de 30 % pour
// tenir compte des rues, puis vitesses moyennes en ville ou sur route. C'est une estimation, pas un itinéraire exact.
export function travelEstimate(a, b) {
  const km = distanceKm(a, b);
  const road = km * 1.3;
  const speed = road < 3 ? 22 : road < 15 ? 32 : road < 80 ? 55 : 80; // km/h en voiture
  const car = Math.max(Math.round((road / speed) * 60), road < 0.2 ? 1 : 2);
  const walk = Math.round((road / 5) * 60);
  return { km, road, car, walk, walkable: road <= 3.5 };
}

// Durée lisible : « 12 min », « 1 h 05 ».
export const formatMinutes = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);
