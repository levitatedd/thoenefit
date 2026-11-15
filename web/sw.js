// Keeps the app's own files on the phone so it opens with no signal.
// Workout data is not cached here: the app keeps that itself and syncs it.
// Bump VERSION whenever the list of files changes.

const VERSION = 'thoenefit-v3';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'js/app.js',
  'js/store.js',
  'js/search.js',
  'js/ui.js',
  'manifest.webmanifest',
  'favicon.ico',
  'icons/favicon-32.png',
  'icons/logo-mark.png',
  'icons/logo-wide.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/api.php')) return;

  // Network first so a deploy shows up straight away; fall back to the saved
  // copy when the network is slow or gone.
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      if (!cached) return network;
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
      return (await Promise.race([network.catch(() => null), timeout])) || cached;
    })(),
  );
});
