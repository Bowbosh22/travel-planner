// Notification discrète (disparaît seule).
export function toast(message, duration = 3200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message; // textContent : jamais de HTML
  host.append(el);
  setTimeout(() => el.remove(), duration);
}
