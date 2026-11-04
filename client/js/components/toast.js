// Notification discrète (disparaît seule). kind : 'warn' pour un avertissement (reste plus longtemps).
export function toast(message, duration = 3200, kind = '', href = '') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = kind ? `toast toast-${kind}` : 'toast';
  if (kind === 'warn') el.setAttribute('role', 'alert');
  el.textContent = message; // textContent : jamais de HTML
  if (href) { // toast cliquable : mène à l'onglet où agir
    el.classList.add('toast-link'); el.setAttribute('role', 'link'); el.tabIndex = 0; el.title = 'Cliquer pour corriger';
    const go = () => { location.hash = href; el.remove(); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  host.append(el);
  setTimeout(() => el.remove(), duration);
}
