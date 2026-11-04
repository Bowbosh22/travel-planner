import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress, parseTarget, ImportError } from '../server/importer/safe-fetch.js';

test('adresses privées, locales et réservées bloquées', () => {
  for (const ip of [
    '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1',
  ]) assert.equal(isBlockedAddress(ip), true, `${ip} doit être bloquée`);
});

test('adresses publiques autorisées', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4007:80f::200e']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} doit être autorisée`);
  }
});

test('texte qui n\'est pas une adresse IP : refusé par prudence', () => {
  assert.equal(isBlockedAddress('example.com'), true);
  assert.equal(isBlockedAddress(''), true);
});

const code = (input) => {
  try {
    parseTarget(input);
    return 'ok';
  } catch (e) {
    assert.ok(e instanceof ImportError);
    return e.code;
  }
};

test('adresses saisies : schémas, identifiants, ports et hôtes internes', () => {
  assert.equal(code('https://www.exemple.com/hotel?id=1'), 'ok');
  assert.equal(code('http://www.exemple.com'), 'ok');
  assert.equal(code('file:///etc/passwd'), 'invalid');
  assert.equal(code('ftp://exemple.com/x'), 'invalid');
  assert.equal(code('javascript:alert(1)'), 'invalid');
  assert.equal(code('gopher://exemple.com'), 'invalid');
  assert.equal(code('pas une adresse'), 'invalid');
  assert.equal(code(''), 'invalid');
  assert.equal(code(undefined), 'invalid');
  assert.equal(code('https://user:pass@exemple.com'), 'invalid');
  assert.equal(code('https://exemple.com:22/'), 'blocked');
  assert.equal(code('http://exemple.com:6379/'), 'blocked');
  assert.equal(code('http://localhost/'), 'blocked');
  assert.equal(code('http://app.localhost/'), 'blocked');
  assert.equal(code('http://serveur.internal/'), 'blocked');
  assert.equal(code('http://127.0.0.1/'), 'blocked');
  assert.equal(code('http://[::1]/'), 'blocked');
  assert.equal(code('http://169.254.169.254/latest/meta-data/'), 'blocked');
  assert.equal(code('http://10.1.2.3/'), 'blocked');
  assert.equal(code('http://[::ffff:127.0.0.1]/'), 'blocked');
});

test('écritures déguisées de 127.0.0.1 bloquées', () => {
  assert.equal(code('http://2130706433/'), 'blocked'); // décimal
  assert.equal(code('http://0x7f000001/'), 'blocked'); // hexadécimal
  assert.equal(code('http://0177.0.0.1/'), 'blocked'); // octal
  assert.equal(code('http://127.1/'), 'blocked'); // forme courte
  assert.equal(code('http://[0:0:0:0:0:ffff:7f00:1]/'), 'blocked');
});
