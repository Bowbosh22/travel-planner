import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnsplash, parseUnsplash } from '../server/images/unsplash.js';
import { createPhotoFinder } from '../server/images/photos.js';

const photo = (n, extra = {}) => ({ urls: { regular: `https://images.unsplash.com/photo-${n}?w=1080` }, user: { name: `Photographe ${n}`, links: { html: `https://unsplash.com/@p${n}` } }, links: { download_location: `https://api.unsplash.com/photos/${n}/download` }, ...extra });

test('garde nom du photographe, lien avec suivi et refuse les adresses douteuses', () => {
  const r = parseUnsplash({ results: [photo(1), photo(2, { urls: { regular: 'https://evil.example/a.jpg' } }), photo(3, { user: { name: 'X', links: { html: 'https://evil.example/' } } }), photo(4, { user: {} })] });
  assert.equal(r.length, 1);
  assert.equal(r[0].author, 'Photographe 1');
  assert.match(r[0].link, /^https:\/\/unsplash\.com\/@p1\?utm_source=travel_planner&utm_medium=referral$/);
  assert.equal(parseUnsplash(null).length, 0);
  assert.equal(parseUnsplash({ results: Array.from({ length: 10 }, (_, i) => photo(i)) }).length, 6);
});

test('recherche : ville + pays, signalement du téléchargement, aucune clé = aucune requête', async () => {
  const calls = [];
  const u = createUnsplash({ fetchJson: async (url) => { calls.push(url); return url.includes('/search/') ? { results: [photo(1)] } : {}; } });
  const out = await u.search('Lisbonne Portugal');
  assert.equal(out.length, 1);
  assert.equal(out[0].dl, undefined);
  assert.match(calls[0], /search\/photos\?query=Lisbonne%20Portugal/);
  assert.ok(calls.some((c) => c.endsWith('/photos/1/download')));
  const off = createUnsplash({ key: '' });
  assert.equal(off.enabled, false);
  assert.deepEqual(await off.search('Lisbonne'), []);
  const down = createUnsplash({ fetchJson: async () => { throw new Error('HTTP 403'); } });
  assert.deepEqual(await down.search('Lisbonne'), []);
});

test('secours Wikipédia quand Unsplash ne trouve rien', async () => {
  const f = createPhotoFinder({ unsplash: { search: async () => [] }, wiki: { find: async () => ({ url: 'https://upload.wikimedia.org/a.jpg', credit: 'https://fr.wikipedia.org/wiki/X' }) } });
  const r = await f.find('Brazzaville', 'Congo');
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'wikipedia');
  assert.deepEqual(await createPhotoFinder({ unsplash: { search: async () => [] }, wiki: { find: async () => null } }).find('Rien'), []);
});
