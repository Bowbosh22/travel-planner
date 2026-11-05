// Préférences du compte : devise d'affichage, page de lancement, taille du texte, disposition du tableau de bord.
// Enregistrées sur le compte (elles suivent l'utilisateur d'un appareil à l'autre) et appliquées tout de suite.
import { api } from './api.js';
import { setDisplayCurrency } from './lib/format.js';

export const HOME_ROUTES = { dashboard: '/', voyages: '/voyages', carte: '/carte' };
export const WIDGET_IDS = ['hero', 'weather', 'people', 'budget', 'map', 'stops', 'categories', 'upcoming', 'paid', 'alerts'];
export const WIDGET_LABELS = { hero: 'Voyage (photo)', weather: 'Heure et météo', people: 'Voyageurs', budget: 'Budget', map: 'Carte du voyage', categories: 'Par catégorie', upcoming: 'Prochaines réservations', paid: 'Prévu et payé', alerts: 'À surveiller', stops: 'Mini destinations' };
// Disposition d'origine : voyage à gauche (large) ; heure, voyageurs, budget et carte à droite ; trois cartes dessous ; alertes en bas.
export const DEFAULT_LAYOUT = { order: [...WIDGET_IDS], hidden: [], sizes: { hero: 'L', weather: 'S', people: 'S', budget: 'S', map: 'S', categories: 'S', upcoming: 'S', paid: 'S', alerts: 'F', stops: 'F' } };

let prefs = {};

export const getPrefs = () => prefs;

export function getLayout() {
  const l = prefs.layout;
  if (!l) return structuredClone(DEFAULT_LAYOUT);
  // widgets absents de la disposition enregistrée (ajoutés plus tard) : placés à la fin
  const order = [...l.order.filter((id) => WIDGET_IDS.includes(id)), ...WIDGET_IDS.filter((id) => !l.order.includes(id))];
  return { order, hidden: (l.hidden ?? []).filter((id) => WIDGET_IDS.includes(id)), sizes: { ...DEFAULT_LAYOUT.sizes, ...(l.sizes ?? {}) } };
}

export function applyEffects(fx = 'full') {
  document.documentElement.dataset.fx = fx === 'light' ? 'light' : 'full';
}

const SCALE = { small: 'small', normal: 'normal', large: 'large' };
export function applyTextSize(size = 'normal') {
  document.documentElement.dataset.text = SCALE[size] ?? 'normal';
}

// Charge les préférences du compte et les applique (devise : le taux du jour est demandé au serveur).
export async function loadPrefs(p = {}) {
  prefs = p && typeof p === 'object' ? { ...p } : {};
  applyTextSize(prefs.textSize);
  applyEffects(prefs.effects);
  await applyCurrency(prefs.currency);
}

async function applyCurrency(code = 'EUR') {
  if (code === 'EUR') return setDisplayCurrency('EUR', 1);
  try {
    const r = await api.fxRate(code);
    setDisplayCurrency(code, Number(r.rate));
  } catch {
    setDisplayCurrency('EUR', 1); // taux indisponible : on reste en euros plutôt que d'afficher un montant faux
  }
}

// Enregistre un changement : appliqué immédiatement ; renvoie false si l'enregistrement échoue (le choix reste appliqué sur cet appareil).
export async function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  if (patch.layout === null) delete prefs.layout;
  if ('textSize' in patch) applyTextSize(patch.textSize);
  if ('effects' in patch) applyEffects(patch.effects);
  if ('currency' in patch) await applyCurrency(patch.currency);
  try {
    const r = await api.savePrefs(patch);
    prefs = r.prefs ?? prefs;
    return true;
  } catch {
    return false;
  }
}

export function resetPrefs() {
  prefs = {};
  applyTextSize('normal');
  applyEffects('full');
  setDisplayCurrency('EUR', 1);
}

// Page affichée au lancement (ouverture du site ou connexion), seulement si l'adresse ne désigne pas déjà une page.
export function launchRoute() {
  return HOME_ROUTES[prefs.home] ?? '/';
}
