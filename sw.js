/* Tótem — service worker.
   Todo se sirve desde caché para que la app abra sin cobertura y se revalida
   en segundo plano: los juegos nuevos y cualquier cambio entran al recargar. */

var VERSION = 'totem-v1';
var SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === VERSION ? null : caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function staleWhileRevalidate(request) {
  return caches.open(VERSION).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      }).catch(function () {
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('index.html');
        return new Response('', { status: 504, statusText: 'Sin conexión' });
      });
      return cached || network;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(staleWhileRevalidate(request));
});
