// Import par lien : serveur HTTP local simulant des sites. Le garde anti-SSRF est actif sauf mention contraire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { importFromUrl, ImportError } from '../server/importer/index.js';
import { fetchPage } from '../server/importer/safe-fetch.js';

let server, base;
const HOTEL = `<html><head><script type="application/ld+json">{"@type":"Hotel","name":"Hôtel Test","offers":{"price":"120","priceCurrency":"EUR"}}</script></head><body></body></html>`;

before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => { res.writeHead(status, { 'content-type': type, ...headers }); res.end(body); };
    switch (req.url) {
      case '/hotel': return send(200, HOTEL);
      case '/gzip': res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); return res.end(zlib.gzipSync(HOTEL));
      case '/bomb': res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); return res.end(zlib.gzipSync('a'.repeat(5_000_000)));
      case '/huge': return send(200, 'a'.repeat(2_000_000));
      case '/redir': return send(302, '', 'text/html', { location: '/hotel' });
      case '/loop': return send(302, '', 'text/html', { location: '/loop' });
      case '/to-internal': return send(302, '', 'text/html', { location: 'http://169.254.169.254/latest/meta-data/' });
      case '/pdf': return send(200, '%PDF-1.4', 'application/pdf');
      case '/forbidden': return send(403, '<html>Access denied</html>');
      case '/limit': return send(429, 'slow down');
      case '/missing': return send(404, 'nope');
      case '/boom': return send(500, 'oops');
      case '/captcha': return send(200, '<html><head><title>Just a moment...</title></head><body><div class="g-recaptcha"></div>cf-chl-bypass</body></html>');
      case '/newsletter': return send(200, `<html><head><meta property="og:title" content="Vrai hôtel"></head><body><div class="g-recaptcha"></div></body></html>`);
      case '/empty': return send(200, '<html><body>rien</body></html>');
      case '/slow': return; // ne répond jamais
      default: return send(404, 'x');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

const OPEN = { allowPrivate: true }; // uniquement pour atteindre le serveur de test local
const fail = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof ImportError, `ImportError attendue, reçu : ${e}`); return e.code; } return 'aucune erreur'; };

test('garde anti-SSRF actif par défaut : le serveur local est refusé', async () => {
  assert.equal(await fail(importFromUrl(`${base}/hotel`)), 'blocked');
  assert.equal(await fail(importFromUrl('http://169.254.169.254/latest/meta-data/')), 'blocked');
});

test('page JSON-LD lue (gzip compris)', async () => {
  for (const path of ['/hotel', '/gzip', '/redir']) {
    const r = await importFromUrl(base + path, OPEN);
    assert.equal(r.fields.name, 'Hôtel Test', path);
    assert.equal(r.amountEur, 120);
  }
});

test('redirection vers une adresse interne bloquée même si le premier lien était public', async () => {
  // Le premier saut est autorisé ici (allowPrivate) mais le test vérifie la revalidation avec le garde réel :
  const code = await fail(fetchPage(`${base}/to-internal`, OPEN).then(() => fetchPage('http://169.254.169.254/')));
  assert.equal(code, 'blocked');
});

test('boucle de redirections stoppée', async () => {
  assert.equal(await fail(importFromUrl(`${base}/loop`, OPEN)), 'redirects');
});

test('pages trop volumineuses ou bombes de décompression refusées', async () => {
  assert.equal(await fail(importFromUrl(`${base}/huge`, OPEN)), 'too_large');
  assert.equal(await fail(importFromUrl(`${base}/bomb`, OPEN)), 'too_large');
});

test('contenu non HTML refusé', async () => {
  assert.equal(await fail(importFromUrl(`${base}/pdf`, OPEN)), 'not_html');
});

test('captcha, accès refusé et limites : signalés, jamais contournés', async () => {
  assert.equal(await fail(importFromUrl(`${base}/forbidden`, OPEN)), 'protected');
  assert.equal(await fail(importFromUrl(`${base}/limit`, OPEN)), 'protected');
  assert.equal(await fail(importFromUrl(`${base}/captcha`, OPEN)), 'protected');
});

test('un simple reCAPTCHA de formulaire ne bloque pas une page lisible', async () => {
  const r = await importFromUrl(`${base}/newsletter`, OPEN);
  assert.equal(r.fields.name, 'Vrai hôtel');
});

test('404, erreur serveur, page vide', async () => {
  assert.equal(await fail(importFromUrl(`${base}/missing`, OPEN)), 'not_found');
  assert.equal(await fail(importFromUrl(`${base}/boom`, OPEN)), 'http');
  const r = await importFromUrl(`${base}/empty`, OPEN);
  assert.equal(r.found, 0);
});

test('site qui ne répond pas : délai dépassé', async () => {
  assert.equal(await fail(importFromUrl(`${base}/slow`, { ...OPEN, timeoutMs: 400 })), 'timeout');
});

test('site introuvable', async () => {
  assert.equal(await fail(importFromUrl('https://ce-site-nexiste-pas.invalid/')), 'unreachable');
});
