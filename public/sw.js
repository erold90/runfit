// RunFit Service Worker — offline-first cache shell
const CACHE = 'runfit-v48';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './program.js',
  './storage.js',
  './coach.js',
  './strength.js',
  './assessment.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Non cachare richieste al Worker coach / cloud sync
  if (url.pathname.includes('/backup')) return;

  // CODICE DELL'APP (HTML/JS/CSS same-origin) → NETWORK-FIRST:
  // l'ultima versione vince appena sei online; la cache è solo fallback offline.
  // Evita il problema "ho corretto ma sul telefono resta la versione vecchia".
  const isAppCode = url.origin === self.location.origin &&
    (req.mode === 'navigate' || url.pathname.endsWith('/') || /\.(?:js|css|html)$/.test(url.pathname));

  if (isAppCode) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() =>
        caches.match(req).then(c => c || caches.match('./index.html') || caches.match('./'))
      )
    );
    return;
  }

  // RESTO (icone, immagini, CDN) → CACHE-FIRST con refresh in sottofondo
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
