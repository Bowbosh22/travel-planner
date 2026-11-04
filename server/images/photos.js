// Photos d'une destination : Unsplash d'abord (plus belles, plusieurs), Wikipédia en secours (une seule).
import { createUnsplash } from './unsplash.js';
import { createImageFinder } from './wikipedia.js';

export function createPhotoFinder({ unsplash = createUnsplash(), wiki = createImageFinder() } = {}) {
  // Renvoie une liste [{url, author, link, source}] ; vide si rien n'est trouvé.
  const find = async (destination, country) => {
    const withCountry = await unsplash.search([destination, country].filter(Boolean).join(' '));
    if (withCountry.length) return withCountry;
    const plain = country ? await unsplash.search(destination) : [];
    if (plain.length) return plain;
    const w = await wiki.find(destination);
    return w ? [{ url: w.url, author: 'Wikipédia', link: w.credit, source: 'wikipedia' }] : [];
  };
  return { find };
}
