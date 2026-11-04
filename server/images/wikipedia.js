// Photo d'une ville via l'API gratuite de Wikipédia (sans compte ni clé).
// Le serveur n'interroge que wikipedia.org (adresse fixe) ; seul le titre de la page varie.
// L'image doit venir de upload.wikimedia.org : toute autre adresse est refusée.

const IMAGE_URL = /^https:\/\/upload\.wikimedia\.org\/[^\s'"\\<>]+$/;
const LANGS = ['fr', 'en'];

async function defaultFetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TravelPlanner-personal-app/1.0 (usage personnel)' }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Lit la réponse de l'API « query » : première page trouvée, avec une image, qui n'est pas une page d'homonymie.
export function pickImage(data) {
  const pages = Object.values(data?.query?.pages ?? {});
  for (const p of pages) {
    if (p.missing !== undefined || p.pageprops?.disambiguation !== undefined) continue;
    const url = p.thumbnail?.source;
    if (typeof url !== 'string' || !IMAGE_URL.test(url)) continue;
    const credit = typeof p.fullurl === 'string' && /^https:\/\/[a-z]{2,3}\.wikipedia\.org\//.test(p.fullurl) ? p.fullurl : null;
    return { url, credit };
  }
  return null;
}

const endpoint = (lang, title) =>
  `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages|info|pageprops&piprop=thumbnail&pithumbsize=1280&inprop=url&ppprop=disambiguation&titles=${encodeURIComponent(title)}`;

export function createImageFinder({ fetchJson = defaultFetchJson } = {}) {
  // Renvoie {url, credit} ou null si rien n'est trouvé ; une panne du service renvoie aussi null.
  const find = async (destination) => {
    const title = String(destination ?? '').trim().slice(0, 100);
    if (!title) return null;
    for (const lang of LANGS) {
      try {
        const found = pickImage(await fetchJson(endpoint(lang, title)));
        if (found) return found;
      } catch { /* on essaie la langue suivante */ }
    }
    return null;
  };
  return { find };
}
