// Téléchargement d'une page web fournie par l'utilisateur, protégé contre le SSRF
// (faire appeler par le serveur des adresses internes : réseau privé, métadonnées cloud, localhost...).
// Garanties : http/https uniquement, ports 80/443, aucune adresse privée ou réservée (vérifiée À CHAQUE
// redirection et au moment de la connexion réelle, donc sans faille de « DNS rebinding »),
// taille, durée et nombre de redirections limités.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

export class ImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = code === 'invalid' ? 400 : 422;
  }
}

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blocked.addSubnet(address, prefix, 'ipv6');

// IPv6 -> 16 octets (null si illisible).
function v6Bytes(addr) {
  let a = addr.toLowerCase();
  const m = a.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const o = m.slice(1).map(Number);
    a = `${a.slice(0, -m[0].length)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, rest] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = rest ? rest.split(':') : [];
  const groups = rest === undefined ? h : [...h, ...Array(Math.max(8 - h.length - t.length, 0)).fill('0'), ...t];
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    if (!/^[0-9a-f]{1,4}$/.test(g) || Number.isNaN(n)) return null;
    bytes.push(n >> 8, n & 255);
  }
  return bytes;
}

export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (!family) return true; // tout ce qui n'est pas une adresse IP valide est refusé
  if (family === 4) return blocked.check(address, 'ipv4');
  const b = v6Bytes(address);
  if (!b) return true;
  if (b.slice(0, 12).every((x) => x === 0)) return true; // ::, ::1 et ::a.b.c.d (IPv4-compatible)
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 255 && b[11] === 255;
  if (mapped) return blocked.check(b.slice(12).join('.'), 'ipv4'); // ::ffff:a.b.c.d : on juge l'IPv4 contenue
  return blocked.check(address, 'ipv6');
}

const BLOCKED_MSG = 'Ce lien pointe vers une adresse non autorisée.';

// Valide et normalise une adresse saisie. Lance ImportError si elle est refusée.
export function parseTarget(input, { allowPrivate = false } = {}) {
  if (typeof input !== 'string' || input.trim() === '' || input.length > 2000) throw new ImportError('invalid', 'Collez une adresse de page valide (https://...).');
  let u;
  try {
    u = new URL(input.trim());
  } catch {
    throw new ImportError('invalid', 'Collez une adresse de page valide (https://...).');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ImportError('invalid', 'Seuls les liens http et https sont acceptés.');
  if (u.username || u.password) throw new ImportError('invalid', 'Les liens contenant un identifiant ou un mot de passe ne sont pas acceptés.');
  if (allowPrivate) return u; // réservé aux tests automatisés

  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (port !== 80 && port !== 443) throw new ImportError('blocked', BLOCKED_MSG);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) throw new ImportError('blocked', BLOCKED_MSG);
  if (net.isIP(host) && isBlockedAddress(host)) throw new ImportError('blocked', BLOCKED_MSG);
  return u;
}

// Résolution DNS contrôlée : on connecte la socket sur l'adresse déjà validée (pas de seconde résolution).
const safeLookup = (allowPrivate) => (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!allowPrivate && (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address)))) {
      return callback(new ImportError('blocked', BLOCKED_MSG));
    }
    if (options && options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

function decode(buffer, encoding, maxBytes) {
  try {
    const opts = { maxOutputLength: maxBytes };
    if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.gunzipSync(buffer, opts);
    if (encoding === 'br') return zlib.brotliDecompressSync(buffer, opts);
    if (encoding === 'deflate') return zlib.inflateSync(buffer, opts);
    if (!encoding || encoding === 'identity') return buffer;
  } catch (err) {
    if (err.code === 'ERR_BUFFER_TOO_LARGE') throw new ImportError('too_large', 'La page est trop volumineuse.');
    throw new ImportError('unreadable', 'Impossible de lire la réponse du site.');
  }
  throw new ImportError('unreadable', 'Impossible de lire la réponse du site.');
}

function requestOnce(u, { allowPrivate, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method: 'GET',
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        lookup: safeLookup(allowPrivate),
        signal: AbortSignal.timeout(Math.max(timeoutMs, 1)),
        headers: {
          'User-Agent': 'TravelPlannerBot/1.0 (lecture d\'une page choisie par l\'utilisateur)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'fr,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          return reject(new ImportError('too_large', 'La page est trop volumineuse.'));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new ImportError('too_large', 'La page est trop volumineuse.'));
          } else chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            const body = decode(Buffer.concat(chunks), String(res.headers['content-encoding'] ?? '').toLowerCase(), maxBytes);
            resolve({ status: res.statusCode, headers: res.headers, body: body.toString('utf8') });
          } catch (err) {
            reject(err);
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', (err) => {
      if (err instanceof ImportError) return reject(err);
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.name === 'TimeoutError') return reject(new ImportError('timeout', 'Le site met trop de temps à répondre.'));
      if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return reject(new ImportError('unreachable', 'Ce site est introuvable. Vérifiez l\'adresse.'));
      reject(new ImportError('unreachable', 'Impossible de joindre ce site.'));
    });
    req.end();
  });
}

export async function fetchPage(input, { allowPrivate = false, timeoutMs = 8000, maxBytes = 1_500_000, maxRedirects = 4 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const u = parseTarget(current, { allowPrivate }); // chaque redirection est revalidée
    const res = await requestOnce(u, { allowPrivate, timeoutMs: deadline - Date.now(), maxBytes });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      try {
        current = new URL(res.headers.location, u).href;
      } catch {
        throw new ImportError('unreachable', 'Redirection invalide.');
      }
      continue;
    }
    return { ...res, url: u.href };
  }
  throw new ImportError('redirects', 'Trop de redirections.');
}
