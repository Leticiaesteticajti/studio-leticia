const CACHE_NAME = 'studio-leticia-v38';
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
            console.log('🧹 Removendo cache antigo do Service Worker:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  // 1. NUNCA interceptar requisições não-GET (POST, PUT, PATCH, DELETE)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 2. NUNCA interceptar chamadas de API externas ou do Supabase
  if (url.origin !== self.location.origin || url.pathname.includes('/rest/v1/') || url.hostname.includes('supabase')) {
    return; // Deixa o navegador fazer fetch direto na rede sem tocar no cache
  }

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

  // Cache primeiro para mídias estáticas do próprio app
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

// Suporte a clique de notificações push no iOS e Android
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'OPEN_ALERTS_PANEL' });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./#alertas');
      }
    })
  );
});
