// Service worker: saves the app's files on the device so it opens with no signal (showing the last copy of your reminders).
//
// IMPORTANT: whenever any file below changes, bump VERSION (tools/bump.sh).
// That is how phones learn there's an update to download.
const VERSION = 'v13';
const CACHE = `launchcontrol-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './move.js',
  './suite.js',
  './share.js',
  './styles.css',
  './app.js',
  './vendor/three.min.js',
  './vendor/three-extras.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // Each file is fetched with ?sw=<version> on the end. GitHub's servers keep old copies for up to
    // 10 minutes after an update; a new address has no old copy, so the device never saves a stale file.
    caches.open(CACHE).then((cache) => Promise.all(ASSETS.map(async (url) => {
      const res = await fetch(new Request(`${url}${url.includes('?') ? '&' : '?'}sw=${VERSION}`, { cache: 'reload' }));
      if (!res.ok) throw new Error(`Couldn't download ${url}`);
      await cache.put(url, res);
    })))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('launchcontrol-') && key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// The page sends this when you tap "Update".
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Serve from the saved copy first; only go to the network for things we don't have.
// (The reminders themselves come from api.github.com, which this never touches.)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (request.mode === 'navigate' && /\/(index\.html)?$/.test(url.pathname)) {
    event.respondWith(caches.match('./index.html').then((cached) => cached || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)));
});
