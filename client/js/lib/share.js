// Lien reçu via le menu « Partager » (Android : le site installé ; iPhone : Raccourci qui ouvre /?url=...).
// Les applications mettent le lien tantôt dans « url », tantôt dans « text » (avec du texte autour).
export function takeSharedUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has('url') && !q.has('text') && !q.has('title')) return null;
  let found = null;
  for (const key of ['url', 'text', 'title']) {
    const m = String(q.get(key) ?? '').match(/https?:\/\/[^\s<>"']+/i);
    if (m) { found = m[0].slice(0, 2000); break; }
  }
  history.replaceState(null, '', location.pathname + location.hash); // l'adresse redevient propre
  try { return found && /^https?:$/.test(new URL(found).protocol) ? found : null; } catch { return null; }
}
