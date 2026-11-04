import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSuggest, parseSuggestions } from '../server/geo/suggest.js';

const data = { results: [
  { name: 'Lisbonne', admin1: 'Lisbonne', country: 'Portugal', feature_code: 'PPLC' },
  { name: 'Lisbonne', admin1: 'Lisbonne', country: 'Portugal', feature_code: 'PPLA' },
  { name: 'Portugal', country: 'Portugal', feature_code: 'PCLI' },
  { name: '<b>X</b>', country: 'Y', feature_code: 'PPL' },
] };

test('villes : sans doublon ni pays ; pays : seulement les pays', () => {
  const cities = parseSuggestions(data, 'city');
  assert.equal(cities.length, 2);
  assert.equal(cities[0].city, 'Lisbonne');
  assert.ok(!cities[1].city.includes('<'));
  assert.deepEqual(parseSuggestions(data, 'country'), [{ country: 'Portugal' }]);
});

test('requête trop courte ignorée, résultats mémorisés', async () => {
  let calls = 0; let t = 0;
  const s = createSuggest({ fetchJson: async (u) => { calls += 1; assert.match(u, /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=lis&/i); return data; }, now: () => t });
  assert.deepEqual(await s('l'), []);
  await s('Lis'); await s('lis');
  assert.equal(calls, 1);
  t = 11 * 60 * 1000; await s('lis');
  assert.equal(calls, 2);
});
