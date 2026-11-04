import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageFinder, pickImage } from '../server/images/wikipedia.js';

const src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Lisbonne_(vue).jpg/1280px-Lisbonne_(vue).jpg';
const api = (page) => ({ query: { pages: { 123: { title: 'Lisbonne', fullurl: 'https://fr.wikipedia.org/wiki/Lisbonne', ...page } } } });

test('lit la miniature et le lien de la page', () => {
  const r = pickImage(api({ thumbnail: { source: src } }));
  assert.equal(r.url, src);
  assert.equal(r.credit, 'https://fr.wikipedia.org/wiki/Lisbonne');
});

test('refuse une image hors de upload.wikimedia.org, les homonymies, les pages absentes et sans image', () => {
  assert.equal(pickImage(api({ thumbnail: { source: 'https://evil.example/a.jpg' } })), null);
  assert.equal(pickImage(api({ thumbnail: { source: "https://upload.wikimedia.org/a'b.jpg" } })), null);
  assert.equal(pickImage(api({ thumbnail: { source: src }, pageprops: { disambiguation: '' } })), null);
  assert.equal(pickImage(api({ thumbnail: { source: src }, missing: '' })), null);
  assert.equal(pickImage(api({})), null);
  assert.equal(pickImage(null), null);
});

test('essaie le français puis l\'anglais, et ne plante jamais si le service est en panne', async () => {
  const urls = [];
  const f = createImageFinder({ fetchJson: async (u) => { urls.push(u); return u.includes('//fr.') ? { query: { pages: { '-1': { missing: '' } } } } : api({ thumbnail: { source: src } }); } });
  assert.ok((await f.find('Le Cap')).url);
  assert.match(urls[0], /^https:\/\/fr\.wikipedia\.org\/w\/api\.php\?.*titles=Le%20Cap$/);
  assert.match(urls[1], /^https:\/\/en\.wikipedia\.org\//);
  const down = createImageFinder({ fetchJson: async () => { throw new Error('HTTP 500'); } });
  assert.equal(await down.find('Lisbonne'), null);
  assert.equal(await down.find('   '), null);
});
