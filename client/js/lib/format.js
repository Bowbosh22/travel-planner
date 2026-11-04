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
