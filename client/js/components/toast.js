// Notification discrète (disparaît seule). kind : 'warn' pour un avertissement (reste plus longtemps).
export function toast(message, duration = 3200, kind = '') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = kind ? `toast toast-${kind}` : 'toast';
  if (kind === 'warn') el.setAttribute('role', 'alert');
  el.textContent = message; // textContent : jamais de HTML
  host.append(el);
  setTimeout(() => el.remove(), duration);
}
