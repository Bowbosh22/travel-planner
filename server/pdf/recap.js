// Récapitulatif PDF d'un voyage : infos, budget, dépenses par catégorie, réservations et planning jour par jour.
// Polices PDF standard (Helvetica) : aucun fichier de police à installer.
import PDFDocument from 'pdfkit';
import { summarize, CATEGORIES } from '../../client/js/services/budget.js';
import { buildPlanning } from '../../client/js/services/planning.js';

const PLANNED = new Set(['billets', 'transport', 'activites', 'restaurants', 'shopping']);
const STATUS = { reserve: 'Réservé', a_reserver: 'À réserver', annule: 'Annulé' };
const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

// Format français sans espaces insécables spéciaux (absents de la police PDF standard).
const num = (n, d = 2) => {
  const [i, f] = Math.abs(n).toFixed(d).split('.');
  return `${n < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f ? `,${f}` : ''}`;
};
const eur = (n) => `${num(n)} €`;
const dateFr = (iso) => (iso ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '');
const dayFr = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060\\ufeff]', 'g');
// Ne garde que les caractères de la police PDF standard (latin + € ’ – — « » …) : le reste est remplacé ou retiré.
const OUTSIDE = new RegExp('[^\\u0020-\\u007e\\u00a1-\\u00ff\\u20ac\\u2018\\u2019\\u201c\\u201d\\u2013\\u2014\\u2026\\u2022]', 'g');
const clean = (s) => String(s ?? '').replace(/[\u2192\u27f6]/g, '->').replace(/[\u202f\u00a0]/g, ' ').replace(CONTROL, ' ').replace(OUTSIDE, '').replace(/ {2,}/g, ' ').trim();

const INK = '#17302D';
const MUTED = '#6B7B79';
const ACCENT = '#E8893A';
const LINE = '#D9E0DE';

export function buildRecapPdf({ trip, members, bookings }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 56, left: 48, right: 48 }, bufferPages: true, info: { Title: `Récapitulatif - ${clean(trip.name)}`, Author: 'Travel Planner' } });
  const W = doc.page.width - 96;
  const left = 48;
  const s = summarize(trip, bookings);
  const need = (h) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
  const h2 = (t) => { need(60); doc.moveDown(0.9).font('Helvetica-Bold').fontSize(13).fillColor(INK).text(t, left, doc.y); doc.moveTo(left, doc.y + 3).lineTo(left + W, doc.y + 3).lineWidth(1.2).strokeColor(ACCENT).stroke(); doc.moveDown(0.6); };
  const row = (cols, { bold = false, color = INK, size = 9.5 } = {}) => {
    // cols : [{ t, w, align }]
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const y = doc.y;
    const heights = cols.map((c) => doc.heightOfString(c.t, { width: c.w - 6, align: c.align }));
    const h = Math.max(...heights, 12);
    need(h + 6);
    let x = left;
    const y0 = doc.y;
    for (const c of cols) { doc.fillColor(color).text(c.t, x, y0, { width: c.w - 6, align: c.align ?? 'left' }); x += c.w; }
    doc.y = y0 + h + 4;
    doc.moveTo(left, doc.y - 2).lineTo(left + W, doc.y - 2).lineWidth(0.4).strokeColor(LINE).stroke();
    return y;
  };

  // En-tête
  doc.rect(0, 0, doc.page.width, 92).fill(INK);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(24).text(clean(trip.name), left, 28, { width: W });
  doc.font('Helvetica').fontSize(11).fillColor('#BFD6D1').text(`${clean([trip.destination, trip.country].filter(Boolean).join(', '))}  ·  ${dateFr(trip.startDate)} au ${dateFr(trip.endDate)}`, left, 60, { width: W });
  doc.y = 112;

  // Infos
  const names = [...members.map((m) => clean(m.firstName)), ...(trip.companions ?? []).map(clean)];
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  const infos = [
    trip.origin ? `Départ : ${clean(trip.origin)}` : null,
    `${trip.travelers} ${trip.travelers > 1 ? 'voyageurs' : 'voyageur'}${names.length ? ` (${names.join(', ')})` : ''}`,
  ].filter(Boolean);
  doc.text(infos.join('   ·   '), left, doc.y, { width: W });

  // Budget
  h2('Budget (en euros)');
  const kv = [['Budget initial', eur(trip.budgetEur)], ['Prévisionnel (réservations non annulées)', eur(s.forecast)], ['Déjà payé', eur(s.paid)], ['Reste à payer', eur(s.toPay)], ['Disponible', eur(s.available)]];
  for (const [k, v] of kv) row([{ t: k, w: W - 140 }, { t: v, w: 140, align: 'right' }], { bold: k === 'Disponible', color: k === 'Disponible' && s.available < 0 ? '#C0392B' : INK, size: 10.5 });
  if (s.available < 0) { doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).fillColor('#C0392B').text(`Attention : le budget est dépassé de ${eur(-s.available)}.`, left, doc.y); }

  // Par catégorie
  if (s.byCategory.length) {
    h2('Dépenses par catégorie');
    row([{ t: 'Catégorie', w: W - 270 }, { t: 'Prévu', w: 90, align: 'right' }, { t: 'Payé', w: 90, align: 'right' }, { t: 'Part', w: 90, align: 'right' }], { bold: true, color: MUTED, size: 9 });
    for (const c of s.byCategory) row([{ t: c.label, w: W - 270 }, { t: eur(c.forecast), w: 90, align: 'right' }, { t: eur(c.paid), w: 90, align: 'right' }, { t: s.forecast ? `${num((c.forecast / s.forecast) * 100, 0)} %` : '', w: 90, align: 'right' }]);
  }

  // Réservations
  const sorted = [...bookings].sort((a, b) => (a.startsOn ?? '9999').localeCompare(b.startsOn ?? '9999') || a.name.localeCompare(b.name));
  h2('Réservations');
  if (!sorted.length) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Aucune réservation.', left, doc.y);
  else {
    row([{ t: 'Réservation', w: W - 330 }, { t: 'Catégorie', w: 90 }, { t: 'Dates', w: 100 }, { t: 'Statut', w: 60 }, { t: 'Montant', w: 80, align: 'right' }], { bold: true, color: MUTED, size: 9 });
    for (const b of sorted) {
      const when = b.startsOn ? (b.endsOn && b.endsOn !== b.startsOn ? `${b.startsOn.slice(8)}/${b.startsOn.slice(5, 7)} - ${b.endsOn.slice(8)}/${b.endsOn.slice(5, 7)}` : `${b.startsOn.slice(8)}/${b.startsOn.slice(5, 7)}/${b.startsOn.slice(0, 4)}`) : '';
      const label = clean(b.name) + (b.location ? `\n${clean(b.location)}` : '');
      const amount = typeof b.amountEur === 'number' ? eur(b.amountEur) : '';
      row([{ t: label, w: W - 330 }, { t: catLabel(b.category), w: 90 }, { t: when, w: 100 }, { t: STATUS[b.status] ?? '', w: 60 }, { t: amount, w: 80, align: 'right' }], { color: b.status === 'annule' ? MUTED : INK });
    }
  }

  // Planning jour par jour (billets, transports, activités, restaurants, shopping)
  const planned = bookings.filter((b) => PLANNED.has(b.category));
  const plan = buildPlanning(trip, planned);
  const busy = plan.days.filter((d) => d.items.some((i) => i.kind === 'booking'));
  if (busy.length) {
    h2('Planning jour par jour');
    for (const d of busy) {
      need(40);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(dayFr(d.date).replace(/^./, (c) => c.toUpperCase()), left, doc.y);
      for (const it of d.items.filter((i) => i.kind === 'booking')) {
        doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`•  ${catLabel(it.booking.category)} : ${clean(it.booking.name)}${it.booking.location ? ` (${clean(it.booking.location)})` : ''}`, left + 10, doc.y, { width: W - 10 });
      }
      doc.moveDown(0.5);
    }
  }

  // Pied de page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // sinon le pied de page déclenche une page blanche
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Travel Planner  ·  Récapitulatif du ${dateFr(new Date().toISOString().slice(0, 10))}  ·  Page ${i + 1}/${range.count}`, left, doc.page.height - 36, { width: W, align: 'center', lineBreak: false });
  }
  doc.end();
  return doc;
}
