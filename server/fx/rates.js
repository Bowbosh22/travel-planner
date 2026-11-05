// Taux de change vers l'euro.
// Convention : rate = nombre d'unités de la devise pour 1 €  →  euros = montant / rate.
// Sources, par ordre : parités FIXES officielles (franc CFA) → BCE via Frankfurter → API communautaire (jsDelivr, puis pages.dev).
// Un taux obtenu est mémorisé par jour (table fx_rates), puis FIGÉ sur chaque réservation au moment de l'enregistrement.

export const FIXED_RATES = { XAF: 655.957, XOF: 655.957 }; // parité officielle : 1 € = 655,957 F CFA

// Devises gérées volontairement limitées : euro, dollar américain, franc CFA (les deux zones) et ringgit malaisien.
export const CURRENCIES = [
  ['EUR', 'Euro'], ['USD', 'Dollar américain'],
  ['XAF', 'Franc CFA (Afrique centrale)'], ['XOF', 'Franc CFA (Afrique de l\'Ouest)'], ['MYR', 'Ringgit malaisien'],
].map(([code, label]) => ({ code, label }));
const CODES = new Set(CURRENCIES.map((c) => c.code));
export const isSupportedCurrency = (code) => typeof code === 'string' && CODES.has(code);

export class FxError extends Error {
  constructor(message) {
    super(message);
    this.code = 'fx_unavailable';
    this.status = 503;
  }
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const toEur = (amount, rate) => round2(amount / rate);

const validRate = (n) => typeof n === 'number' && Number.isFinite(n) && n > 1e-6 && n < 1e8;
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Lecteurs défensifs : une réponse inattendue donne null (on passe à la source suivante), jamais une valeur inventée.
export function parseFrankfurter(json, code) {
  const rate = json?.rates?.[code];
  return validRate(rate) ? { rate, date: validDate(json?.date) ? json.date : null } : null;
}
export function parseCurrencyApi(json, code) {
  const rate = json?.eur?.[code.toLowerCase()];
  return validRate(rate) ? { rate, date: validDate(json?.date) ? json.date : null } : null;
}

const PROVIDERS = [
  { name: 'BCE (Frankfurter)', url: (c) => `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${c}`, parse: parseFrankfurter },
  { name: 'currency-api (jsDelivr)', url: () => 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json', parse: parseCurrencyApi },
  { name: 'currency-api (pages.dev)', url: () => 'https://latest.currency-api.pages.dev/v1/currencies/eur.json', parse: parseCurrencyApi },
];

async function defaultFetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const isoDay = (d) => d.toISOString().slice(0, 10);

export function createFxService(pool, { fetchJson = defaultFetchJson, now = () => new Date() } = {}) {
  async function getRate(code) {
    if (!isSupportedCurrency(code)) throw new FxError(`Devise non prise en charge : ${code}.`);
    const today = isoDay(now());
    if (code === 'EUR') return { currency: code, rate: 1, date: today, source: 'EUR' };
    if (FIXED_RATES[code]) return { currency: code, rate: FIXED_RATES[code], date: today, source: 'Parité fixe officielle' };

    const cached = await pool.query('SELECT rate, rate_date, source FROM fx_rates WHERE currency=$1 AND day=$2', [code, today]);
    if (cached.rows[0]) return { currency: code, rate: cached.rows[0].rate, date: cached.rows[0].rate_date, source: cached.rows[0].source };

    for (const p of PROVIDERS) {
      try {
        const got = p.parse(await fetchJson(p.url(code)), code);
        if (!got) continue;
        const date = got.date ?? today;
        await pool.query(
          'INSERT INTO fx_rates (currency, day, rate, rate_date, source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [code, today, got.rate, date, p.name]
        );
        return { currency: code, rate: got.rate, date, source: p.name };
      } catch {
        /* source indisponible : on essaie la suivante */
      }
    }

    // Aucune source : dernier taux connu des 10 derniers jours, clairement daté.
    const old = await pool.query(
      `SELECT rate, rate_date, source FROM fx_rates WHERE currency=$1 AND day >= ($2::date - 10) ORDER BY day DESC LIMIT 1`,
      [code, today]
    );
    if (old.rows[0]) return { currency: code, rate: old.rows[0].rate, date: old.rows[0].rate_date, source: `${old.rows[0].source} (dernier taux connu)` };
    throw new FxError(`Taux de change indisponible pour ${code}. Réessayez, ou saisissez le taux à la main.`);
  }
  return { getRate };
}
