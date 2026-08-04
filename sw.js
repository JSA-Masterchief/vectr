/**
 * sw.js
 * ------------------------------------------------------------
 * Deliberately minimal. Caches only Vectr's own static app shell
 * (HTML/CSS/JS/offline datasets/icons) so the app opens instantly
 * and works offline for anything that doesn't need live data.
 *
 * It never touches OpenSky, AeroDataBox, map tiles, fonts, or the
 * Leaflet CDN — those are cross-origin, always-live requests and
 * are intentionally left alone (no event.respondWith for them),
 * so live flight data is never served stale from a cache.
 * ------------------------------------------------------------
 */
const CACHE_NAME = 'vectr-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './css/styles.css',
  './js/views.js',
  './js/airports.js',
  './js/airlines.js',
  './js/opensky.js',
  './js/aerodatabox.js',
  './js/app.js',
  './js/airportview.js',
  './js/livemap.js',
  './js/favorites.js',
  './js/permalink.js',
  './data/airports.json',
  './data/airlines.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch((err) => {
      // Don't let one missing/renamed file block install entirely.
      console.warn('Vectr service worker: shell cache partially failed', err);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests for the app shell.
  // Everything cross-origin (OpenSky, AeroDataBox, map tiles, fonts,
  // Leaflet CDN) is left completely untouched.
  if (url.origin !== self.location.origin || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      // Stale-while-revalidate: serve cache immediately if present,
      // update it in the background from the network.
      return cached || network;
    })
  );
});
