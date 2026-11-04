import test from 'node:test';
import assert from 'node:assert/strict';
import { capture, readCapture, bookmarkletHref } from '../client/js/lib/capture.js';

// Faux document : juste ce que capture() consulte.
const page = ({ text = '', h1 = '', og = '', ld = null } = {}) => ({
  title: 'Airbnb',
  body: { innerText: text },
  querySelector: (sel) => {
    if (sel === 'h1') return h1 ? { textContent: h1 } : null;
    if (sel.includes('og:title')) return og ? { getAttribute: () => og } : null;
    return null;
  },
  querySelectorAll: () => (ld ? [{ textContent: JSON.stringify(ld) }] : []),
});
const loc = (u) => { const x = new URL(u); return { href: x.href, origin: x.origin, pathname: x.pathname, search: x.search, hostname: x.hostname }; };
const AIRBNB = 'https://www.airbnb.fr/rooms/123?check_in=2026-12-12&check_out=2026-12-19&adults=2';

test('favori : nom, lieu, total, dates et catégorie lus sur la page', () => {
  const c = capture(page({
    h1: 'Villa avec piscine',
    text: 'Villa avec piscine\n450 € par nuit\nOù vous serez\nCarte\nLisbonne, Portugal\nPrix total\nTotal\n3 150,50 €\n',
  }), loc(AIRBNB));
  assert.equal(c.name, 'Villa avec piscine');
  assert.equal(c.location, 'Lisbonne, Portugal');
  assert.deepEqual([c.price.amount, c.price.currency, c.price.kind], [3150.5, 'EUR', 'total']);
  assert.equal(c.startDate, '2026-12-12');
  assert.equal(c.endDate, '2026-12-19');
  assert.equal(c.category, 'logement');
});

test('favori : montants en formats variés, devise toujours explicite', () => {
  const t = (txt) => capture(page({ h1: 'X', text: txt }), loc('https://exemple.fr/')).price;
  assert.equal(t('Total 1 234,56 €').amount, 1234.56);
  assert.equal(t('Total €1,234.56').amount, 1234.56);
  assert.deepEqual([t('Total US$980').amount, t('Total US$980').currency], [980, 'USD']);
  assert.equal(t('Total 1.234 €').amount, 1234);
  assert.equal(t('Total 50 000 XAF').currency, 'XAF');
  assert.equal(t('Total $120').currency, null, '« $ » seul est ambigu');
  assert.equal(t('Total 120'), null, 'sans devise, rien n\'est deviné');
  assert.equal(t('Total des voyageurs : 3'), null);
  // la dernière ligne « Total » l'emporte (après taxes)
  assert.equal(t('Total avant taxes 1 000 €\nTotal 1 100 €').amount, 1100);
});

test('favori : prix par nuit signalé comme tel, jamais pris pour le total', () => {
  const c = capture(page({ h1: 'X', text: '120 € par nuit' }), loc('https://exemple.fr/'));
  assert.equal(c.price.kind, 'night');
});

test('favori : rien d\'inventé quand la page ne donne rien', () => {
  const c = capture(page({ text: 'bonjour' }), loc('https://exemple.fr/a?check_in=2026-12-20&check_out=2026-12-10'));
  assert.equal(c.price, null);
  assert.equal(c.location, '');
  assert.equal(c.category, '');
  assert.equal(c.startDate, '', 'dates incohérentes ignorées');
});

test('favori : JSON-LD prioritaire pour le nom et l\'adresse', () => {
  const c = capture(page({
    h1: 'Autre titre',
    ld: { '@type': 'Hotel', name: 'Hôtel du Port', address: { streetAddress: '1 quai', addressLocality: 'Brazzaville', addressCountry: { name: 'Congo' } } },
  }), loc('https://exemple.fr/'));
  assert.equal(c.name, 'Hôtel du Port');
  assert.equal(c.location, '1 quai, Brazzaville, Congo');
});

test('réception : toute donnée est revalidée (lien trafiqué, types faux, devise non gérée)', () => {
  assert.equal(readCapture(null), null);
  assert.equal(readCapture({ v: 2, name: 'x' }), null);
  assert.equal(readCapture({ v: 1, url: 'javascript:alert(1)', name: '' }), null);
  const r = readCapture({
    v: 1, url: 'https://a.fr/x', name: '<img src=x onerror=1>‮', location: 'L'.repeat(999), category: 'pirate',
    price: { amount: 1e12, currency: 'GBP' }, startDate: '2026-02-30x', endDate: '2026-12-19',
  });
  assert.equal(r.price, null, 'montant absurde refusé');
  assert.equal(r.category, '');
  assert.equal(r.location.length, 200);
  assert.equal(r.startDate, '');
  assert.ok(!r.name.includes('‮'));
  const ok = readCapture({ v: 1, url: 'https://a.fr/x', name: 'N', price: { amount: 10, currency: 'GBP', kind: 'total' } });
  assert.equal(ok.price.currency, null, 'devise non gérée : à choisir');
});

test('le favori généré est autonome et ne dépend que de l\'adresse de l\'application', () => {
  const href = bookmarkletHref('https://app.example');
  assert.ok(href.startsWith('javascript:'));
  const code = decodeURIComponent(href.slice('javascript:'.length));
  assert.ok(code.includes('"https://app.example"'));
  assert.doesNotMatch(code, /\bimport\b|readCapture|CATEGORIES/);
  new Function(code); // syntaxe valide
});
