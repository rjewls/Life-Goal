/**
 * sw.js — Service Worker for Life Advisor PWA
 * Cache-first for app shell assets; network-first for API calls.
 * Update CACHE_VERSION whenever you deploy significant changes.
 */

const CACHE_VERSION = 'life-advisor-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/static/css/style.css',
  '/static/js/local-api.js',
  '/static/js/app.js',
  '/manifest.json',
  '/icon.svg'
];

/* ── Install: cache the app shell ───────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: delete old caches ────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: serve from cache, fall back to network ──────── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for API calls — never serve stale data
  if (url.pathname.startsWith('/api/')) return;

  // For GET requests to same origin: cache-first
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
