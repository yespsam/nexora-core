const CACHE_NAME = 'soulmate-shell-v2';
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css?v=0.2.0',
  './app.js?v=0.2.0',
  './manifest.webmanifest',
  './assets/starters/cute-seed-v1.webp',
  './assets/starters/cute-young-v1.webp',
  './assets/starters/cute-resonance-v1.webp',
  './assets/starters/cool-seed-v1.webp',
  './assets/starters/cool-young-v1.webp',
  './assets/starters/cool-resonance-v1.webp',
  './assets/starters/beautiful-seed-v1.webp',
  './assets/starters/beautiful-young-v1.webp',
  './assets/starters/beautiful-resonance-v1.webp',
  '../shared/soulmate-profile.mjs'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('soulmate-shell-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (!response.ok) return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  })));
});
