// Fonds de carte gratuits, sans clé : Esri « gris » (clair / sombre, suit le thème), satellite Esri,
// et OpenStreetMap en secours automatique si les tuiles ne se chargent pas.
const ESRI = (path) => `https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`;
const ESRI_CREDIT = 'Fond © Esri, HERE, Garmin, OpenStreetMap contributors';
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_CREDIT = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
const opts = { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin' };

const isDark = () => document.documentElement.dataset.mode === 'dark';
const osm = (L) => L.tileLayer(OSM, { ...opts, attribution: OSM_CREDIT });
const plan = (L) => {
  const layer = L.tileLayer(ESRI(isDark() ? 'Canvas/World_Dark_Gray_Base' : 'Canvas/World_Light_Gray_Base'), { ...opts, maxNativeZoom: 16, attribution: ESRI_CREDIT });
  let errors = 0;
  layer.on('tileerror', () => { // service bloqué ou indisponible : on bascule sur OpenStreetMap
    if (++errors !== 4 || !layer._map) return;
    const map = layer._map;
    map.removeLayer(layer);
    osm(L).addTo(map).bringToBack();
  });
  return layer;
};

// Ajoute le fond « Plan » (adapté au thème). Avec { switcher: true } : bouton Plan / Satellite.
export function addBasemap(L, map, { switcher = false } = {}) {
  let base = plan(L).addTo(map);
  const onTheme = () => { if (map.hasLayer(base)) { map.removeLayer(base); base = plan(L).addTo(map); base.bringToBack(); } };
  window.addEventListener('themechange', onTheme);
  map.on('unload', () => window.removeEventListener('themechange', onTheme));
  if (switcher) {
    const sat = L.tileLayer(ESRI('World_Imagery'), { ...opts, maxNativeZoom: 18, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics' });
    return L.control.layers({ 'Plan': base, 'Satellite': sat }, null, { position: 'topright', collapsed: true }).addTo(map);
  }
  return null;
}
