// Service worker minimal : rend le site installable (et donc visible dans le menu « Partager » d'Android).
// Il ne met rien en cache : les pages et les données viennent toujours du serveur.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
