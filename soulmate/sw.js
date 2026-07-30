const CACHE_NAME = 'nexora-core-shell-v22';
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css?v=0.6.1',
  './app.js?v=0.9.2',
  './manifest.webmanifest',
  './assets/soulmate-icon-192.png',
  './assets/soulmate-icon-512.png',
  '../shared/soulmate-profile.mjs?v=2',
  '../shared/soulmate-memory.mjs',
  '../shared/soulmate-sync.mjs?v=1',
  '../shared/soulmate-cloud-sync.mjs?v=1',
  '../shared/pendant-ble.mjs',
  '../shared/pendant-simulator.mjs',
  '../shared/pendant-poses.mjs',
  '../shared/creature-3d-data.mjs',
  '../shared/creature-3d-viewer.mjs',
  '../shared/voice-turn.mjs'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => (key.startsWith('soulmate-shell-') || key.startsWith('nexora-core-shell-')) && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', response.clone()));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (!response.ok) return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  })));
});
