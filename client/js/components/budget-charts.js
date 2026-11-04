// Bloc de quatre graphiques (dashboard et page Budget). Reconstruits quand le thème change.
import { createCharts, seriesColor } from './charts.js';
import { html, raw } from '../lib/html.js';
import { formatEUR, formatPercent } from '../lib/format.js';

export function chartsMarkup(s) {
  const timelineOk = s.timeline.length > 0;
  return html`
    <div class="grid-2">
      <section class="card" aria-label="Dépenses par catégorie">
        <h3 class="card-head">Dépenses par catégorie</h3>
        <div class="donut-row">
          <div class="chart-box h-donut">
            <canvas id="chart-donut" role="img" aria-label="Répartition des dépenses prévues par catégorie"></canvas>
            <div class="chart-center"><strong>${formatEUR(s.forecast)}</strong><span>prévu</span></div>
          </div>
          <ul class="legend-list">
            ${s.byCategory.map((c, i) => html`<li><span class="dot" style="background:${raw(seriesColor(i))}"></span><span class="label">${c.label}</span><span class="value">${formatEUR(c.forecast)}</span></li>`)}
          </ul>
        </div>
      </section>
      <section class="card" aria-label="Prévu et payé">
        <div class="card-head"><h3>Prévu et payé</h3>
          <div class="legend"><span><i class="dot" style="background:var(--s4)"></i>Prévu</span><span><i class="dot" style="background:var(--s1)"></i>Payé</span></div>
        </div>
        <div class="chart-box h-bars"><canvas id="chart-bars" role="img" aria-label="Comparaison du prévu et du payé par catégorie"></canvas></div>
      </section>
    </div>
    <div class="grid-2 flip">
      <section class="card" aria-label="Évolution des dépenses">
        <h3 class="card-head">Évolution des dépenses</h3>
        ${timelineOk
          ? html`<div class="chart-box h-line"><canvas id="chart-line" role="img" aria-label="Cumul des paiements dans le temps, avec projection jusqu'au total prévu"></canvas></div>`
          : html`<p class="muted">Aucun paiement enregistré pour le moment.</p>`}
      </section>
      <section class="card" aria-label="Budget restant">
        <h3 class="card-head">Budget restant</h3>
        <div class="chart-box h-gauge">
          <canvas id="chart-gauge" role="img" aria-label="Budget disponible : ${formatEUR(s.available)}"></canvas>
          <div class="chart-center gauge-center"><strong>${formatEUR(s.available)}</strong><span>${formatPercent(Math.max(100 - s.engagedPct, 0))} du budget initial</span></div>
        </div>
      </section>
    </div>`;
}

// Branche les graphiques ; renvoie la fonction de nettoyage.
export function mountCharts(el, summary, trip, enabled = true) {
  let charts = null;
  const build = () => {
    charts?.destroy();
    if (!enabled) return;
    if (!window.Chart) {
      el.querySelectorAll('.chart-box').forEach((b) => { b.textContent = 'Graphique indisponible.'; });
      return;
    }
    charts = createCharts({
      donut: el.querySelector('#chart-donut'),
      bars: el.querySelector('#chart-bars'),
      line: el.querySelector('#chart-line'),
      gauge: el.querySelector('#chart-gauge'),
    }, summary, trip);
  };
  build();
  window.addEventListener('themechange', build);
  return () => { window.removeEventListener('themechange', build); charts?.destroy(); };
}
