import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, parsePrice, isoDate } from '../server/importer/extract.js';

const page = (head, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const URL_ = 'https://hotel.exemple.com/alfama';

test('JSON-LD Hotel : nom, adresse, prix en euros', () => {
  const r = extract(page(ld({
    '@context': 'https://schema.org', '@type': 'Hotel', name: 'Hôtel Alfama', description: 'Vue sur le Tage',
    address: { '@type': 'PostalAddress', streetAddress: 'Rua X 12', postalCode: '1100', addressLocality: 'Lisbonne', addressCountry: 'PT' },
    offers: { '@type': 'Offer', price: '650.50', priceCurrency: 'EUR' },
  })), URL_);
  assert.equal(r.fields.name, 'Hôtel Alfama');
  assert.equal(r.fields.category, 'logement');
  assert.equal(r.fields.location, 'Rua X 12, 1100 Lisbonne, PT');
  assert.equal(r.amountEur, 650.5);
  assert.equal(r.sources.name, 'json-ld');
  assert.equal(r.host, 'hotel.exemple.com');
});

test('prix dans une autre devise : jamais présenté comme des euros', () => {
  const r = extract(page(ld({ '@type': 'Hotel', name: 'Hotel NY', offers: { price: 300, priceCurrency: 'USD' } })), URL_);
  assert.equal(r.amountEur, null);
  assert.deepEqual(r.priceFound, { amount: 300, currency: 'USD' });
  assert.equal(r.priceFound.currency, 'USD');
});

test('prix sans devise : pas d\'euros supposés', () => {
  const r = extract(page(ld({ '@type': 'Restaurant', name: 'Chez Z', offers: { price: '40' } })), URL_);
  assert.equal(r.amountEur, null);
  assert.equal(r.priceFound.currency, null);
});

test('@graph, tableau de types et AggregateOffer', () => {
  const r = extract(page(ld({ '@graph': [
    { '@type': 'WebSite', name: 'Site' },
    { '@type': ['Product', 'Hotel'], name: 'Riad', offers: { '@type': 'AggregateOffer', lowPrice: '1 200,00', priceCurrency: 'EUR' } },
  ] })), URL_);
  assert.equal(r.fields.name, 'Riad');
  assert.equal(r.amountEur, 1200);
});

test('événement : dates ISO extraites', () => {
  const r = extract(page(ld({ '@type': 'Event', name: 'Concert', startDate: '2026-12-14T20:00:00+01:00', endDate: '2026-12-14' })), URL_);
  assert.equal(r.fields.category, 'activites');
  assert.equal(r.fields.startDate, '2026-12-14');
  assert.equal(r.fields.endDate, '2026-12-14');
});

test('réservation d\'hôtel : dates de séjour et entité réservée', () => {
  const r = extract(page(ld({ '@type': 'LodgingReservation', checkinTime: '2026-12-12T15:00', checkoutTime: '2026-12-19T11:00', totalPrice: 700, priceCurrency: 'EUR', reservationFor: { '@type': 'LodgingBusiness', name: 'Pousada' } })), URL_);
  assert.equal(r.fields.name, 'Pousada');
  assert.equal(r.fields.startDate, '2026-12-12');
  assert.equal(r.fields.endDate, '2026-12-19');
  assert.equal(r.amountEur, 700);
});

test('dates incohérentes ou invalides ignorées', () => {
  assert.equal(isoDate('2026-02-30'), null);
  assert.equal(isoDate('12/12/2026'), null);
  assert.equal(isoDate('demain'), null);
  const r = extract(page(ld({ '@type': 'Event', name: 'X', startDate: '2026-12-20', endDate: '2026-12-10' })), URL_);
  assert.equal(r.fields.endDate, undefined);
  assert.ok(r.warnings.length > 0);
});

test('Open Graph seul : titre, description, prix', () => {
  const r = extract(page(`<meta property="og:title" content="Visite de Sintra"><meta property="og:description" content="Palais et jardins">
    <meta property="product:price:amount" content="45,00"><meta property="product:price:currency" content="EUR">`), URL_);
  assert.equal(r.fields.name, 'Visite de Sintra');
  assert.equal(r.fields.description, 'Palais et jardins');
  assert.equal(r.amountEur, 45);
  assert.equal(r.fields.category, undefined, 'catégorie jamais devinée sans indice');
  assert.equal(r.sources.name, 'open-graph');
});

test('<title> en dernier recours', () => {
  const r = extract(page('<title>  Ma page  </title>'), URL_);
  assert.equal(r.fields.name, 'Ma page');
  assert.equal(r.sources.name, 'title');
});

test('page sans données : rien d\'inventé', () => {
  const r = extract(page('', '<p>Bonjour</p>'), URL_);
  assert.deepEqual(r.fields, {});
  assert.equal(r.amountEur, null);
  assert.equal(r.found, 0);
  assert.ok(r.warnings.length > 0);
});

test('JSON-LD cassé ignoré sans erreur, Open Graph prend le relais', () => {
  const r = extract(page('<script type="application/ld+json">{ pas du json </script><meta property="og:title" content="OK">'), URL_);
  assert.equal(r.fields.name, 'OK');
});

test('texte hostile : caractères de contrôle supprimés, longueurs limitées, aucun HTML interprété', () => {
  const r = extract(page(ld({ '@type': 'Hotel', name: `<img src=x onerror=alert(1)>\u0000‮${'a'.repeat(500)}`, description: 'd'.repeat(5000) })), URL_);
  assert.ok(r.fields.name.length <= 120);
  assert.ok(!/[\u0000‮]/.test(r.fields.name));
  assert.ok(r.fields.description.length <= 500);
  assert.ok(r.fields.name.startsWith('<img'), 'le texte est gardé tel quel (échappé à l\'affichage), pas exécuté ici');
});

test('parsePrice : formats usuels et valeurs absurdes', () => {
  assert.equal(parsePrice('1 234,56 €'), 1234.56);
  assert.equal(parsePrice('1,234.56'), 1234.56);
  assert.equal(parsePrice('1.234,56'), 1234.56);
  assert.equal(parsePrice('1,234'), 1234);
  assert.equal(parsePrice('12,5'), 12.5);
  assert.equal(parsePrice(99), 99);
  assert.equal(parsePrice('gratuit'), null);
  assert.equal(parsePrice(-5), null);
  assert.equal(parsePrice('999999999999'), null);
  assert.equal(parsePrice(null), null);
});
