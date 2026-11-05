// Préférences du compte : liste blanche stricte (rien d'autre n'est jamais enregistré).
export const DISPLAY_CURRENCIES = ['EUR', 'USD', 'XAF', 'XOF'];
export const HOMES = ['dashboard', 'voyages', 'carte'];
export const TEXT_SIZES = ['small', 'normal', 'large'];
export const EFFECTS = ['full', 'light'];
export const WIDGETS = ['hero', 'weather', 'people', 'budget', 'map', 'categories', 'upcoming', 'paid', 'alerts', 'stops'];
export const WIDGET_SIZES = ['S', 'M', 'L', 'F'];

const uniqueWidgets = (v) => (Array.isArray(v) ? [...new Set(v.filter((id) => WIDGETS.includes(id)))] : null);

// Renvoie { value } (les seules clés valides, à fusionner) ou { error }.
export function validatePrefs(body = {}) {
  const out = {};
  if (body.currency !== undefined) {
    if (!DISPLAY_CURRENCIES.includes(body.currency)) return { error: 'Devise non prise en charge.' };
    out.currency = body.currency;
  }
  if (body.home !== undefined) {
    if (!HOMES.includes(body.home)) return { error: 'Page de lancement invalide.' };
    out.home = body.home;
  }
  if (body.textSize !== undefined) {
    if (!TEXT_SIZES.includes(body.textSize)) return { error: 'Taille du texte invalide.' };
    out.textSize = body.textSize;
  }
  if (body.effects !== undefined) {
    if (!EFFECTS.includes(body.effects)) return { error: 'Choix des effets invalide.' };
    out.effects = body.effects;
  }
  if (body.layout !== undefined) {
    if (body.layout === null) out.layout = null; // retour à la disposition d'origine
    else {
      const l = body.layout;
      const order = uniqueWidgets(l?.order);
      const hidden = uniqueWidgets(l?.hidden ?? []);
      if (!order || !hidden) return { error: 'Disposition invalide.' };
      const sizes = {};
      for (const [id, s] of Object.entries(l.sizes && typeof l.sizes === 'object' ? l.sizes : {})) {
        if (WIDGETS.includes(id) && WIDGET_SIZES.includes(s)) sizes[id] = s;
      }
      out.layout = { order, hidden, sizes };
    }
  }
  return Object.keys(out).length ? { value: out } : { error: 'Aucune préférence à enregistrer.' };
}

export const mergePrefs = (current, patch) => {
  const next = { ...(current && typeof current === 'object' ? current : {}), ...patch };
  if (next.layout === null) delete next.layout;
  return next;
};
