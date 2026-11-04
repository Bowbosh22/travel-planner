// Photo d'une ville via l'API gratuite de Wikipédia (sans compte ni clé).
// Le serveur n'interroge que wikipedia.org (adresse fixe) ; seul le titre de la page varie.
// L'image doit venir de upload.wikimedia.org : toute autre adresse est refusée.

const IMAGE_URL = /^https:\/\/upload\.wikimedia\.org\/[A-Za-z0-9%_.\-/()~,]+$/;
const LANGS = ['fr', 'en'];

async function defaultFetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TravelPlanner-personal-app/1.0' }, signal: AbortSignal.timeout(6000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Agrandit la miniature Wikimedia (…/320px-Nom.jpg → …/1280px-Nom.jpg) ; sinon garde l'adresse telle quelle.
export function pickImage(data) {
  if (!data || data.type === 'disambiguation') return null;
  const thumb = data.thumbnail?.source;
  if (typeof thumb !== 'string') return null;
  const big = thumb.replace(/\/\d{2,4}px-([^/]+)$/, '/1280px-$1');
  const url = IMAGE_URL.test(big) ? big : IMAGE_URL.test(thumb) ? thumb : null;
  if (!url) return null;
  const page = data.content_urls?.desktop?.page;
  const credit = typeof page === 'string' && /^https:\/\/[a-z]{2,3}\.wikipedia\.org\//.test(page) ? page : null;
  return { url, credit };
}

export function createImageFinder({ fetchJson = defaultFetchJson } = {}) {
  // Renvoie {url, credit} ou null si rien n'est trouvé ; une panne du service renvoie aussi null.
  const find = async (destination) => {
    const title = String(destination ?? '').trim().slice(0, 100);
    if (!title) return null;
    for (const lang of LANGS) {
      try {
        const found = pickImage(await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`));
        if (found) return found;
      } catch { /* on essaie la langue suivante */ }
    }
    return null;
  };
  return { find };
}
