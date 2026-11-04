// Thème = couleur (bleu, gris, marron) + mode (clair, sombre, auto).
// Les valeurs sont appliquées via data-theme / data-mode sur <html> (voir css/tokens.css).
// Étape 3 : le choix sera aussi enregistré sur le compte (users.theme_color, users.theme_mode).

const KEY = 'tp.theme';
const DEFAULTS = { color: 'bleu', mode: 'clair' };

export const COLORS = [
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
