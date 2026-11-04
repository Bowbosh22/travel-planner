// Fonds de carte gratuits, sans clé : CARTO (plan clair / sombre, suit le thème) et Esri (satellite).
const CARTO = (style) => `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png`;
const OSM_CREDIT = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_CREDIT = 'Imagerie © Esri, Maxar, Earthstar Geographics';
const opts = { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin' };

const isDark = () => document.documentElement.dataset.mode === 'dark';
const plan = (L) => L.tileLayer(CARTO(isDark() ? 'dark_all' : 'voyager'), { ...opts, subdomains: 'abcd', attribution: OSM_CREDIT });

// Ajoute le fond « Plan » (adapté au thème). Avec { switcher: true } : bouton Plan / Satellite.
export function addBasemap(L, map, { switcher = false } = {}) {
  let base = plan(L).addTo(map);
  const onTheme = () => { if (map.hasLayer(base)) { map.removeLayer(base); base = plan(L).addTo(map); base.bringToBack(); } };
  window.addEventListener('themechange', onTheme);
  map.on('unload', () => window.removeEventListener('themechange', onTheme));
  if (switcher) {
    const sat = L.tileLayer(ESRI, { ...opts, maxZoom: 18, attribution: ESRI_CREDIT });
    const ctl = L.control.layers({ 'Plan': base, 'Satellite': sat }, null, { position: 'topright', collapsed: true }).addTo(map);
    map.on('baselayerchange', (e) => { if (e.layer === sat) return; base = e.layer; });
    return ctl;
  }
  return null;
}
