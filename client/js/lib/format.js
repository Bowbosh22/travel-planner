// Devise d'affichage : les montants restent enregistrés en euros ; seul l'affichage est converti (taux du jour, ou parité fixe pour le franc CFA).
const NAMES = { EUR: 'euros', USD: 'dollars US', XAF: 'francs CFA', XOF: 'francs CFA' };
let shown = { code: 'EUR', rate: 1 };
const makeFmt = (code, cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code, minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
let fmtWhole = makeFmt('EUR', false);
let fmtCents = makeFmt('EUR', true);

export function setDisplayCurrency(code = 'EUR', rate = 1) {
  const ok = NAMES[code] && Number.isFinite(rate) && rate > 0;
  shown = ok ? { code, rate } : { code: 'EUR', rate: 1 };
  const noCents = shown.code === 'XAF' || shown.code === 'XOF'; // pas de centimes en franc CFA
  fmtWhole = makeFmt(shown.code, false);
  fmtCents = noCents ? fmtWhole : makeFmt(shown.code, true);
}
export const displayCurrency = () => shown.code;
export const displayCurrencyName = () => NAMES[shown.code];

export const formatEUR = (n) => fmtWhole.format(n * shown.rate);
export const formatEURCents = (n) => fmtCents.format(n * shown.rate);
export const formatPercent = (n) => `${Math.round(n)} %`;

const toDate = (iso) => new Date(`${iso}T00:00:00`);
const fmt = (opts, iso) => new Intl.DateTimeFormat('fr-FR', opts).format(toDate(iso));

export const formatShortDate = (iso) => fmt({ day: 'numeric', month: 'short' }, iso);
export const formatLongDate = (iso) => fmt({ day: 'numeric', month: 'short', year: 'numeric' }, iso);
export const formatRange = (start, end) => `${formatShortDate(start)} – ${formatLongDate(end)}`;

export function daysBetween(fromIso, toIso) {
  return Math.round((toDate(toIso) - toDate(fromIso)) / 86400000);
}

export const plural = (n, one, many) => (n > 1 ? many : one);

// Montants entiers sans décimales, sinon avec centimes (650,50 €).
export const formatMoney = (n) => (shown.code === 'EUR' ? (Number.isInteger(n) ? formatEUR(n) : formatEURCents(n)) : formatEUR(n));

// Montant dans une devise quelconque (« 100 000 FCFA », « 85,00 $US »...).
export function formatCurrency(amount, code) {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${amount} ${code}`;
  }
}
export const formatRate = (rate) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(rate);

export function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} Mo`;
}
