// Graphiques Chart.js du dashboard. Les couleurs viennent des variables CSS du thème actif :
// on reconstruit les graphiques à chaque changement de thème.
import { formatEUR, formatShortDate } from '../lib/format.js';

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function palette() {
  return {
    text: cssVar('--text'),
    muted: cssVar('--muted'),
    border: cssVar('--border'),
    card: cssVar('--card'),
    accent: cssVar('--accent'),
    danger: cssVar('--danger'),
    series: [cssVar('--s1'), cssVar('--s2'), cssVar('--s3'), cssVar('--s4')],
  };
}

export const seriesColor = (i) => `var(--s${(i % 4) + 1})`;

/**
 * @param {{donut, bars, line, gauge}} canvases
 * @param {object} summary résultat de summarize()
 * @param {object} trip
 * @returns {{destroy(): void}}
 */
export function createCharts(canvases, summary, trip) {
  const Chart = window.Chart;
  const c = palette();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = c.muted;

  const charts = [];
  const common = { maintainAspectRatio: false, animation: { duration: 400 } };
  const euroTick = (v) => formatEUR(v);

  // 1. Répartition par catégorie
  if (canvases.donut) {
    charts.push(new Chart(canvases.donut, {
      type: 'doughnut',
      data: {
        labels: summary.byCategory.map((x) => x.label),
        datasets: [{
          data: summary.byCategory.map((x) => x.forecast),
          backgroundColor: summary.byCategory.map((_, i) => c.series[i % 4]),
          borderColor: c.card,
          borderWidth: 2,
        }],
      },
      options: { ...common, cutout: '72%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label} : ${formatEUR(ctx.parsed)}` } } } },
    }));
  }

  // 2. Prévu / payé par catégorie
  if (canvases.bars) {
    charts.push(new Chart(canvases.bars, {
      type: 'bar',
      data: {
        labels: summary.byCategory.map((x) => x.label),
        datasets: [
          { label: 'Prévu', data: summary.byCategory.map((x) => x.forecast), backgroundColor: c.series[3], borderRadius: 4, categoryPercentage: 0.7, barPercentage: 0.9 },
          { label: 'Payé', data: summary.byCategory.map((x) => x.paid), backgroundColor: c.series[0], borderRadius: 4, categoryPercentage: 0.7, barPercentage: 0.9 },
        ],
      },
      options: {
        ...common,
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label} : ${formatEUR(ctx.parsed.x)}` } } },
        scales: {
          x: { beginAtZero: true, grid: { color: c.border }, border: { display: false }, ticks: { callback: euroTick, maxTicksLimit: 5 } },
          y: { grid: { display: false }, border: { display: false }, ticks: { color: c.text, font: { size: 13 } } },
        },
      },
    }));
  }

  // 3. Évolution des paiements, avec projection jusqu'au total prévu
  if (canvases.line && summary.timeline.length) {
    const labels = [...summary.timeline.map((p) => formatShortDate(p.date)), `Départ (${formatShortDate(trip.startDate)})`];
    const paid = [...summary.timeline.map((p) => p.cumulative), null];
    const projection = labels.map((_, i) => (i === labels.length - 2 ? paid[i] : i === labels.length - 1 ? summary.forecast : null));
    charts.push(new Chart(canvases.line, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Payé (cumul)', data: paid, borderColor: c.accent, backgroundColor: c.accent, borderWidth: 2.5, tension: 0, pointRadius: (ctx) => (ctx.dataIndex === labels.length - 2 ? 5 : 3), pointBackgroundColor: c.card, pointBorderColor: c.accent, pointBorderWidth: 2 },
          { label: 'Projection', data: projection, borderColor: c.accent, borderWidth: 2, borderDash: [5, 6], tension: 0, pointRadius: (ctx) => (ctx.dataIndex === labels.length - 1 ? 4 : 0), pointBackgroundColor: c.card, pointBorderColor: c.accent, pointBorderWidth: 2 },
        ],
      },
      options: {
        ...common,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => (ctx.parsed.y == null ? undefined : ` ${ctx.dataset.label} : ${formatEUR(ctx.parsed.y)}`) } } },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, suggestedMax: Math.max(summary.forecast, 1) * 1.05, grid: { color: c.border }, border: { display: false }, ticks: { callback: euroTick, maxTicksLimit: 5 } },
        },
      },
    }));
  }

  // 4. Jauge du budget restant (demi-cercle)
  if (canvases.gauge) {
    const left = Math.max(summary.available, 0);
    const used = Math.max(summary.budget - left, 0);
    charts.push(new Chart(canvases.gauge, {
      type: 'doughnut',
      data: { labels: ['Disponible', 'Engagé'], datasets: [{ data: [left, used], backgroundColor: [c.accent, c.border], borderWidth: 0, borderRadius: 6 }] },
      options: { ...common, rotation: -90, circumference: 180, cutout: '78%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label} : ${formatEUR(ctx.parsed)}` } } } },
    }));
  }

  return { destroy: () => charts.forEach((ch) => ch.destroy()) };
}
