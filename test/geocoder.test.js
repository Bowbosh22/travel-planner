import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeocoder } from '../server/geo/nominatim.js';

const mk = (fetchJson) => createGeocoder({ fetchJson, minIntervalMs: 0, wait: async () => {} });

test('géocodage : Nominatim d\'abord', async () => {
  const g = mk(async (u) => { assert.ok(u.includes('nominatim')); return [{ lat: '38.7', lon: '-9.1' }]; });
  assert.deepEqual(await g.geocode('Lisbonne, Portugal'), { lat: 38.7, lng: -9.1 });
});

test('géocodage : secours Open-Meteo si Nominatim refuse ou ne trouve rien', async () => {
  const urls = [];
  const down = mk(async (u) => { urls.push(u); if (u.includes('nominatim')) throw new Error('HTTP 403'); return { results: [{ latitude: 38.72, longitude: -9.14 }] }; });
  assert.deepEqual(await down.geocode('Lisbonne, Portugal'), { lat: 38.72, lng: -9.14 });
  assert.ok(urls[1].includes('name=Lisbonne') && !urls[1].includes('Portugal'));
  const empty = mk(async (u) => (u.includes('nominatim') ? [] : { results: [{ latitude: 1, longitude: 2 }] }));
  assert.deepEqual(await empty.geocode('Lisbonne'), { lat: 1, lng: 2 });
});

test('géocodage : introuvable → null ; tout en panne → erreur', async () => {
  assert.equal(await mk(async (u) => (u.includes('nominatim') ? [] : { results: [] })).geocode('Nulle part'), null);
  await assert.rejects(mk(async () => { throw new Error('hors ligne'); }).geocode('Lisbonne'));
});
