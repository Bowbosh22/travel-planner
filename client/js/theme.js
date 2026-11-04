// Thème = couleur (bleu, gris, marron) + mode (clair, sombre, auto).
// Les valeurs sont appliquées via data-theme / data-mode sur <html> (voir css/tokens.css).
// Étape 3 : le choix sera aussi enregistré sur le compte (users.theme_color, users.theme_mode).

const KEY = 'tp.theme';
const DEFAULTS = { color: 'paysage', mode: 'sombre', bg: 'paysage' };
const CUSTOM_KEY = 'tp.bgcustom';

// Fonds d'écran du thème Paysage (photos dans /img/bg/). « perso » = photo choisie sur cet appareil.
export const BACKGROUNDS = [
  { id: 'paysage', label: 'Montagnes', thumb: '/img/paysage.svg' },
  { id: 'savane', label: 'Savane', thumb: '/img/bg/savane-s.jpg' },
  { id: 'plage', label: 'Plage', thumb: '/img/bg/plage-s.jpg' },
  { id: 'foret', label: 'Forêt', thumb: '/img/bg/foret-s.jpg' },
  { id: 'neige', label: 'Neige', thumb: '/img/bg/neige-s.jpg' },
];

export const getCustomBackground = () => { try { return localStorage.getItem(CUSTOM_KEY); } catch { return null; } };
export function setCustomBackground(dataUrl) {
  try { dataUrl ? localStorage.setItem(CUSTOM_KEY, dataUrl) : localStorage.removeItem(CUSTOM_KEY); return true; } catch { return false; }
}

// Réduit la photo choisie (2000 px max, JPEG) pour tenir dans le stockage du navigateur.
export async function photoToDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

export const COLORS = [
  { id: 'paysage', label: 'Paysage', swatches: ['#10211F', '#3A5F5A', '#9FD3C2', '#F0A25A'] },
  { id: 'bleu', label: 'Bleu', swatches: ['#1B3F8F', '#2456C9', '#7FA6F5', '#C9D3E8'] },
  { id: 'gris', label: 'Gris', swatches: ['#1F262E', '#4A5663', '#8794A3', '#CBD1D7'] },
  { id: 'marron', label: 'Marron', swatches: ['#5B3A24', '#8A5A3C', '#C79A78', '#E3D3C6'] },
];
export const MODES = [
  { id: 'clair', label: 'Clair' },
  { id: 'sombre', label: 'Sombre' },
  { id: 'auto', label: 'Automatique' },
];

export function getTheme() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function resolveMode(mode) {
  if (mode === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return mode === 'sombre' ? 'dark' : 'light';
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  root.dataset.theme = theme.color;
  root.dataset.mode = resolveMode(theme.mode);
  const custom = theme.bg === 'perso' ? getCustomBackground() : null;
  root.dataset.bg = theme.bg === 'perso' && !custom ? 'paysage' : theme.bg;
  if (custom) root.style.setProperty('--bg-custom', `url("${custom}")`); else root.style.removeProperty('--bg-custom');
  window.dispatchEvent(new CustomEvent('themechange'));
}

export function setTheme(patch) {
  const next = { ...getTheme(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible : le thème s'applique quand même pour la session */
  }
  applyTheme(next);
  return next;
}

export function watchSystemTheme() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme().mode === 'auto') applyTheme();
  });
}
