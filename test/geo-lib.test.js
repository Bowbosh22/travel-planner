import test from 'node:test';
import assert from 'node:assert/strict';
import { bearing, distanceKm, flightMinutes, formatDuration, greatCircle } from '../client/js/lib/geo.js';

const paris = { lat: 48.8566, lng: 2.3522 };
const lisbonne = { lat: 38.7223, lng: -9.1393 };
const tokyo = { lat: 35.6762, lng: 139.6503 };
const sf = { lat: 37.7749, lng: -122.4194 };

test('distance et durée de vol Paris–Lisbonne', () => {
  const km = distanceKm(paris, lisbonne);
  assert.ok(km > 1400 && km < 1500, `km=${km}`);
  assert.equal(flightMinutes(1000), 105);
  assert.equal(formatDuration(105), '1 h 45');
  assert.equal(distanceKm(paris, paris), 0);
});

test('arc de grand cercle : mêmes extrémités, continu, sans saut de longitude', () => {
  const arc = greatCircle(tokyo, sf, 40);
  assert.equal(arc.length, 41);
  assert.ok(Math.abs(arc[0][0] - tokyo.lat) < 1e-6 && Math.abs(arc[0][1] - tokyo.lng) < 1e-6);
  for (let i = 1; i < arc.length; i++) assert.ok(Math.abs(arc[i][1] - arc[i - 1][1]) < 20, 'saut de longitude');
  assert.ok(arc[40][1] > 180 && Math.abs(arc[40][1] - 360 - sf.lng) < 1e-6, 'longitude continue au-delà de 180°');
  assert.equal(greatCircle(paris, paris).length, 2);
});

test('cap vers l\'ouest et vers le nord', () => {
  assert.ok(Math.abs(bearing([0, 0], [1, 0])) < 1e-6);
  assert.ok(Math.abs(bearing([0, 0], [0, -1]) - 270) < 1e-6);
});

import { travelEstimate, formatMinutes } from '../client/js/lib/geo.js';

test('trajet estimé : distance allongée, voiture et marche cohérentes', () => {
  const a = { lat: 38.7139, lng: -9.1334 };
  const near = travelEstimate(a, { lat: 38.7110, lng: -9.1290 }); // quelques centaines de mètres
  assert.ok(near.km > 0.3 && near.km < 0.8);
  assert.ok(near.walkable && near.walk >= near.car);
  const far = travelEstimate(a, { lat: 38.6970, lng: -9.4220 }); // Cascais, ~25 km
  assert.ok(far.km > 20 && far.km < 30 && !far.walkable);
  assert.ok(far.car > 20 && far.car < 70);
  assert.equal(travelEstimate(a, a).car, 1);
  assert.equal(formatMinutes(12), '12 min');
  assert.equal(formatMinutes(65), '1 h 05');
});
