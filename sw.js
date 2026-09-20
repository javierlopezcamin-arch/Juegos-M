/* Tótem — service worker.
   La app se pide primero a la red, con un límite de espera corto: así una versión
   nueva entra en la primera recarga. Si la red falla o tarda, se sirve lo guardado,
   de modo que sigue abriendo sin cobertura. */

var VERSION = 'totem-v3';
var NETWORK_TIMEOUT = 3500;
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

function keep(request, response) {
  if (response && response.ok) {
    var copy = response.clone();
    caches.open(VERSION).then(function (cache) { cache.put(request, copy); });
  }
  return response;
}

function fromCache(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('index.html');
    return new Response('', { status: 504, statusText: 'Sin conexión' });
  });
}

function networkFirst(request) {
  return new Promise(function (resolve) {
    var done = false;
    var finish = function (response) {
      if (done) return;
      done = true;
      resolve(response);
    };
    var timer = setTimeout(function () { finish(fromCache(request)); }, NETWORK_TIMEOUT);

    fetch(request).then(function (response) {
      clearTimeout(timer);
      keep(request, response);
      finish(response);
    }).catch(function () {
      clearTimeout(timer);
      finish(fromCache(request));
    });
  });
}

/* Las locuciones no cambian nunca y pesan: esas sí desde la caché. */
function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      return keep(request, response);
    }).catch(function () { return fromCache(request); });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.indexOf('/data/audio/') !== -1) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
