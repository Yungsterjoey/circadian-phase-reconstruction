/**
 * KURO OS — Service Worker v1
 * Phase 7: PWA Foundation
 *
 * SECURITY RULES (hard):
 *   - /api/* paths are NEVER intercepted or cached (auth, data, tool results)
 *   - Only GET requests are ever cached
 *   - Only same-origin requests are handled
 *   - No credentials are stored in cache storage
 */

const CACHE_NAME = 'kuro-shell-v1';

// App shell — pre-cached on install so the UI loads offline
const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/kuro-logo.jpg',
];

// URL patterns that MUST bypass the SW entirely (network-only)
// Matches /api/*, /api (exact), any path starting with /api
const API_PATH_RE = /^\/api(\/|$)/;

// ── Install ────────────────────────────────────────────────────────────────
// Pre-cache the app shell. skipWaiting() activates the new SW immediately.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // Non-fatal: if an asset 404s (e.g. dev env), don't block install
        console.warn('[SW] Pre-cache partial failure:', err.message);
        return self.skipWaiting();
      })
  );
});

// ── Activate ───────────────────────────────────────────────────────────────
// Delete caches from previous SW versions. clients.claim() takes control
// of all open pages immediately so they benefit from the new cache.

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => {
              console.log('[SW] Deleting old cache:', k);
              return caches.delete(k);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── Hard bypass rules ────────────────────────────────────────────────────

  // 1. Non-GET requests (POST, PUT, DELETE…) — always network, never cache
  if (request.method !== 'GET') return;

  // 2. Cross-origin requests — do not intercept (CDN, analytics, etc.)
  if (url.origin !== self.location.origin) return;

  // 3. API routes — NEVER cache; pass straight through to network.
  //    This covers auth tokens, session data, VFS, tool calls, etc.
  if (API_PATH_RE.test(url.pathname)) return;

  // ── Hashed static assets (/assets/…) → cache-first ──────────────────────
  // Vite emits content-hashed filenames; once cached they never change.

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── App shell (HTML, manifest, icons) → network-first ───────────────────
  // Always try network so the user gets fresh HTML/state.
  // On network failure, fall back to cache → offline page.

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) => cached || caches.match('/offline.html')
        )
      )
  );
});
