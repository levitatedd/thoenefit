// Keeps the app's own files on the phone so it opens with no signal.
// Workout data is not cached here: the app keeps that itself and syncs it.
//
// BUILD is replaced with the commit id on every deploy (see the workflow), so
// each deploy installs a fresh service worker and clears the old saved copies.
// Nothing needs bumping by hand.

const BUILD = 'dev';
const VERSION = `thoenefit-${BUILD}`;
const SHELL = [
  './',
  'index.html',
  'app.css',
  'js/app.js',
  'js/store.js',
  'js/search.js',
  'js/ui.js',
  'js/install.js',
  'js/version.js',
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
      // 'reload' skips the browser's own cache, so the saved copies are the files just deployed.
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' }))))
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
  // The API and the build stamp always go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/api.php') || url.pathname.endsWith('/version.json')) return;

  // Network first so a deploy shows up straight away; fall back to the saved
  // copy when the network is slow or gone.
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req, { ignoreSearch: true });
      // 'no-cache' makes the browser ask the server whether a file changed (a quick
      // "not modified" when it has not) instead of reusing an old copy for hours.
      const network = fetch(req.mode === 'navigate' ? req : new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      if (!cached) return network;
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
      return (await Promise.race([network.catch(() => null), timeout])) || cached;
    })(),
  );
});
