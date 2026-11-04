// Champ « montant + devise » avec aperçu du taux. Le taux est FIGÉ à l'enregistrement : modifier le montant
// d'une réservation existante garde son taux ; il ne change que si on change de devise, saisit un taux ou l'actualise.
import { api } from '../api.js';
import { html, raw } from '../lib/html.js';
import { formatEURCents, formatLongDate, formatRate } from '../lib/format.js';

export async function loadCurrencies() {
  try {
    return await api.currencies();
  } catch {
    return [{ code: 'EUR', label: 'Euro' }];
  }
}

// b : réservation existante (facultatif) ; defaults : valeurs initiales pour un import.
export function amountFieldHtml(currencies, { amount = '', currency = 'EUR', editing = null } = {}) {
  const frozen = editing && currency !== 'EUR';
  return html`
    <div class="field"><label for="a-amount">Montant total</label>
      <input class="input" id="a-amount" name="amount" inputmode="decimal" value="${amount ?? ''}" placeholder="Laissez vide si inconnu"></div>
    <div class="field"><label for="a-cur">Devise</label>
      <select class="select full" id="a-cur" name="currency">
        ${currencies.map((c) => html`<option value="${c.code}" ${c.code === currency ? raw('selected') : ''}>${c.code} · ${c.label}</option>`)}
      </select></div>
    <div class="field span-2 fx-box" id="fx-box" ${currency === 'EUR' ? raw('hidden') : ''}>
      <p class="fx-preview" id="fx-preview" aria-live="polite"></p>
      <label for="a-rate">Taux manuel <span class="opt">(facultatif) · 1 € = … <span id="fx-cur">${currency}</span></span></label>
      <input class="input" id="a-rate" name="rate" inputmode="decimal" placeholder="Laissez vide pour le taux du jour">
      ${frozen ? html`<label class="check"><input type="checkbox" name="refreshRate"> Actualiser le taux au jour d'aujourd'hui</label>` : ''}
    </div>`;
}

export function wireAmountField(root, { editing = null } = {}) {
  const amountEl = root.querySelector('#a-amount');
  const curEl = root.querySelector('#a-cur');
  const rateEl = root.querySelector('#a-rate');
  const box = root.querySelector('#fx-box');
  const preview = root.querySelector('#fx-preview');
  const curLabel = root.querySelector('#fx-cur');
  const refreshEl = root.querySelector('[name="refreshRate"]');
  const cache = new Map();
  let seq = 0;
  const num = (v) => Number(String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'));

  async function rateFor(code) {
    const manual = num(rateEl.value);
    if (rateEl.value.trim() !== '' && Number.isFinite(manual) && manual > 0) return { rate: manual, label: 'taux saisi' };
    if (editing && code === editing.currency && !refreshEl?.checked) {
      return { rate: editing.fxRate, label: `taux figé le ${formatLongDate(editing.fxDate)}` };
    }
    if (!cache.has(code)) cache.set(code, api.fxRate(code));
    try {
      const r = await cache.get(code);
      return { rate: r.rate, label: `${r.source}, ${formatLongDate(r.date)}` };
    } catch (err) {
      cache.delete(code);
      return { error: `${err.message}` };
    }
  }

  async function update() {
    const mine = ++seq;
    const code = curEl.value;
    box.hidden = code === 'EUR';
    curLabel.textContent = code;
    if (code === 'EUR') return;
    preview.textContent = 'Calcul du taux...';
    const r = await rateFor(code);
    if (mine !== seq) return; // une saisie plus récente a pris le relais
    if (r.error) {
      preview.textContent = r.error;
      return;
    }
    const amount = num(amountEl.value);
    const eur = amountEl.value.trim() !== '' && Number.isFinite(amount) ? `≈ ${formatEURCents(amount / r.rate)} · ` : '';
    preview.textContent = `${eur}1 € = ${formatRate(r.rate)} ${code} (${r.label})`;
  }

  for (const el of [amountEl, curEl, rateEl, refreshEl]) el?.addEventListener('input', update);
  curEl.addEventListener('change', update);
  update();
}

// Valeurs du formulaire → corps de requête.
export function amountPayload(v) {
  return {
    amount: v.amount?.trim() === '' ? null : v.amount,
    currency: v.currency || 'EUR',
    rate: v.rate?.trim() ? v.rate : undefined,
    refreshRate: v.refreshRate === 'on',
  };
}
