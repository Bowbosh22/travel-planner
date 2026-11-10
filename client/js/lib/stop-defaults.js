// Préremplissage depuis une mini destination : dates d'arrivée / départ et lieu (nom de la destination).
// On ne remplace jamais ce que l'utilisateur a saisi : seuls les champs vides, ou remplis automatiquement avant, sont mis à jour.
const FIELDS = (ids, stop) => [[ids.start, stop.startDate], [ids.end, stop.endDate], [ids.loc, stop.name]];

export function applyStopDefaults(root, stop, ids) {
  if (!stop) return;
  for (const [id, value] of FIELDS(ids, stop)) {
    const input = root.querySelector(`#${id}`);
    if (!input || !value) continue;
    if (input.value && input.dataset.auto !== '1') continue;
    input.value = value;
    input.dataset.auto = '1';
    input.dispatchEvent(new Event('input', { bubbles: true })); // rafraîchit l'affichage du calendrier
  }
}

// Une saisie manuelle (événement venu de l'utilisateur ou du calendrier) retire le caractère automatique.
export function watchManualEdits(root, ids) {
  for (const id of [ids.start, ids.end, ids.loc]) {
    for (const ev of ['input', 'change']) root.querySelector(`#${id}`)?.addEventListener(ev, (e) => { if (e.isTrusted || e.detail === 'manual') e.target.dataset.auto = ''; });
  }
}
