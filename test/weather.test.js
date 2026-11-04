import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeather, describeWeather, parseWeather } from '../server/weather/openmeteo.js';

const geo = { results: [{ latitude: 38.72, longitude: -9.14, timezone: 'Europe/Lisbon' }] };
const fc = (extra = {}) => ({ timezone: 'Europe/Lisbon', current: { temperature_2m: 17.4, weather_code: 2 }, ...extra });

test('traduit les codes météo en français', () => {
  assert.equal(describeWeather(0).label, 'Ciel dégagé');
  assert.equal(describeWeather(63).kind, 'rain');
  assert.equal(describeWeather(95).kind, 'storm');
});

test('lit température, libellé et fuseau ; refuse les données douteuses', () => {
  assert.deepEqual(parseWeather(geo, fc()), { tempC: 17, timezone: 'Europe/Lisbon', label: 'Peu nuageux', kind: 'partly' });
  assert.equal(parseWeather(geo, fc({ timezone: 'x; DROP' })), null);
  assert.equal(parseWeather(geo, { current: {} }), null);
  assert.equal(parseWeather({}, fc()), null);
});

test('interroge deux adresses fixes avec le nom de la ville, met en cache, et ne plante jamais', async () => {
  const urls = [];
  let t = 0;
  const w = createWeather({ now: () => t, fetchJson: async (u) => { urls.push(u); return u.includes('geocoding') ? geo : fc(); } });
  assert.equal((await w.get('Lisbonne, Portugal')).tempC, 17);
  assert.match(urls[0], /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=Lisbonne&/);
  assert.match(urls[1], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=38\.72&longitude=-9\.14/);
  await w.get('lisbonne');
  assert.equal(urls.length, 2);
  t = 21 * 60 * 1000;
  await w.get('Lisbonne');
  assert.equal(urls.length, 4);
  assert.equal(await createWeather({ fetchJson: async () => { throw new Error('HTTP 500'); } }).get('Lisbonne'), null);
  assert.equal(await createWeather({ fetchJson: async () => ({}) }).get('Nullepart'), null);
  assert.equal(await w.get('  '), null);
});
