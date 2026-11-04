import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageFinder, pickImage } from '../server/images/wikipedia.js';

const page = (src, extra = {}) => ({ type: 'standard', thumbnail: { source: src }, content_urls: { desktop: { page: 'https://fr.wikipedia.org/wiki/Lisbonne' } }, ...extra });
const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Lisbonne.jpg/320px-Lisbonne.jpg';

test('agrandit la miniature Wikimedia et garde le lien de la page', () => {
  const r = pickImage(page(thumb));
  assert.equal(r.url, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Lisbonne.jpg/1280px-Lisbonne.jpg');
  assert.equal(r.credit, 'https://fr.wikipedia.org/wiki/Lisbonne');
});

test('refuse une image hors de upload.wikimedia.org, les pages d\'homonymie et l\'absence d\'image', () => {
  assert.equal(pickImage(page('https://evil.example/a.jpg')), null);
  assert.equal(pickImage(page("https://upload.wikimedia.org/a'b.jpg")), null);
  assert.equal(pickImage(page(thumb, { type: 'disambiguation' })), null);
  assert.equal(pickImage({ type: 'standard' }), null);
  assert.equal(pickImage(null), null);
});

test('essaie le français puis l\'anglais, et ne plante jamais si le service est en panne', async () => {
  const urls = [];
  const f = createImageFinder({ fetchJson: async (u) => { urls.push(u); return u.includes('//fr.') ? null : page(thumb); } });
  assert.ok((await f.find('Le Cap')).url);
  assert.match(urls[0], /fr\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Le_Cap/);
  assert.match(urls[1], /en\.wikipedia\.org/);
  const down = createImageFinder({ fetchJson: async () => { throw new Error('HTTP 500'); } });
  assert.equal(await down.find('Lisbonne'), null);
  assert.equal(await down.find('   '), null);
});
