const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eurCents = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

export const formatEUR = (n) => eur.format(n);
export const formatEURCents = (n) => eurCents.format(n);
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
export const formatMoney = (n) => (Number.isInteger(n) ? formatEUR(n) : formatEURCents(n));

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
