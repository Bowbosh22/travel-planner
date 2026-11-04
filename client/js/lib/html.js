// Gabarits HTML avec échappement automatique.
// Toute valeur interpolée est échappée, sauf celles produites par html() ou raw().
// Important dès maintenant : à partir de l'étape 4, les données importées depuis des sites
// externes sont non fiables et ne doivent jamais être injectées telles quelles.

class Safe {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const raw = (value) => new Safe(String(value));

const part = (v) => {
  if (v instanceof Safe) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
};

export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += part(values[i]);
  });
  return new Safe(out);
}
