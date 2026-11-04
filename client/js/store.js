// Voyage actif, mémorisé dans le navigateur. Les autres pages s'y brancheront aux étapes suivantes.

const KEY = 'tp.activeTrip';

export const getActiveTripId = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export function setActiveTripId(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignoré */
  }
  window.dispatchEvent(new CustomEvent('tripchange', { detail: { id } }));
}
