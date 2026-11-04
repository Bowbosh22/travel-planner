// Chargé en premier et de façon synchrone : applique le thème avant le premier affichage
// pour éviter un flash de la mauvaise couleur.
(function () {
  var t = { color: 'bleu', mode: 'clair' };
  try {
    var saved = JSON.parse(localStorage.getItem('tp.theme') || '{}');
    if (saved.color) t.color = saved.color;
    if (saved.mode) t.mode = saved.mode;
  } catch (e) {}
  var mode = t.mode;
  if (mode === 'auto') {
    mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    mode = mode === 'sombre' ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t.color);
  document.documentElement.setAttribute('data-mode', mode);
})();
