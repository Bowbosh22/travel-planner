import { fetchPage, ImportError } from './safe-fetch.js';
import { extract } from './extract.js';

// Signes d'une page de vérification anti-robot ou de connexion obligatoire. On ne les contourne JAMAIS.
const CHALLENGE = /cf-browser-verification|cf-chl-|challenge-platform|Just a moment\.\.\.|g-recaptcha|h-captcha|px-captcha|captcha-delivery|datadome|Attention Required! \| Cloudflare|verify you are (a )?human|are you a robot/i;
const PROTECTED_MSG = 'Ce site demande une vérification (captcha, connexion ou limite d\'accès) : il n\'est pas lisible automatiquement. Saisissez les informations à la main.';

export async function importFromUrl(url, options = {}) {
  const page = await fetchPage(url, options);
  if ([401, 403, 407, 429, 451, 503].includes(page.status)) throw new ImportError('protected', PROTECTED_MSG);
  if (page.status === 404 || page.status === 410) throw new ImportError('not_found', 'Cette page est introuvable (erreur 404).');
  if (page.status >= 400) throw new ImportError('http', `Le site a répondu avec une erreur (${page.status}).`);
  if (page.status < 200 || page.status >= 300) throw new ImportError('http', 'Réponse inattendue du site.');
  if (!/^(text\/html|application\/xhtml\+xml)/i.test(String(page.headers['content-type'] ?? ''))) {
    throw new ImportError('not_html', 'Ce lien ne mène pas à une page web lisible (PDF, image, fichier...).');
  }
  const result = extract(page.body, page.url);
  // Page de vérification : rien d'exploitable à part le <title> (souvent « Just a moment... »).
  const onlyTitle = Object.keys(result.fields).every((k) => result.sources[k] === 'title') && result.amountEur === null;
  if (onlyTitle && CHALLENGE.test(page.body.slice(0, 60_000))) throw new ImportError('protected', PROTECTED_MSG);
  return result;
}

export { ImportError };
