const CACHE_NAME = 'studio-leticia-v31';
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
  './img/logo-oficial-transparente.png',
  './img/foto-atendimento-1.jpg',
  './img/foto-atendimento-2.jpg',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
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
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);
  const isCode = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.html') || event.request.mode === 'navigate';

  if (isCode) {
    // Rede primeiro para assets de código, com fallback para cache se estiver offline
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  // Cache primeiro para mídias estáticas
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      });
    })
  );
});
