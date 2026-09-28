const CACHE_NAME = 'studio-leticia-v23';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './agendar.html',
  './css/style.css',
  './style.css',
  './js/db.js',
  './db.js',
  './js/app.js',
  './app.js',
  './js/supabase-client.js',
  './supabase-client.js',
  './manifest.json',
  './img/logo.png',
  './img/logo-badge.png',
  './img/logo-oficial.png',
  './img/logo-symbol.png',
  './img/logo-transparent.png',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Ignora requisições de esquemas não-http (ex: chrome-extension, file)
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // Retorna do cache, mas busca atualização em segundo plano (stale-while-revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Se falhar a rede e for navegação, retorna a index
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
