// Service worker: la app abre al instante (incluso sin conexión).
// Al publicar una versión nueva, cambia el número de CACHE.
const CACHE = 'finanzas-v1';
const SHELL = ['./', './index.html', './css/styles.css', './js/app.js', './js/store.js', './js/utils.js', './js/config.js',
  './js/vendor/chart.umd.min.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];
const CDN = ['www.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/__/')) return; // rutas de login de Firebase Hosting
    // Muestra lo guardado al instante y actualiza en segundo plano.
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const key = req.mode === 'navigate' ? './index.html' : req;
      const hit = await c.match(key, { ignoreSearch: true });
      const net = fetch(req).then((r) => { if (r.ok) c.put(key, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  } else if (CDN.includes(url.hostname)) {
    // Librerías versionadas (Firebase SDK): caché primero.
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
  }
});
