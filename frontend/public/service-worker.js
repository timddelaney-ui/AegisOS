// CT Field Workbook — service worker (iter 20, conservative rewrite).
//
// The previous version intercepted HTML navigation and API calls. On flaky
// mobile networks it occasionally served stale shells or trapped auth
// redirects, which looked like "nothing works" to the user.
//
// This version is intentionally minimal:
//   • Static same-origin assets (hashed JS/CSS, PNG, SVG, fonts): cache-first.
//   • HTML navigation + any /api/* request: NEVER intercepted — always goes
//     straight to the network. If the user is offline we let the browser show
//     its native offline UI; the app isn't offline-capable yet.
//   • On activate, every prior cache (any version) is deleted so stuck users
//     get a clean slate the next time they open the installed PWA.
const SW_VERSION = "v2.0.0";
const STATIC_CACHE = `ct-static-${SW_VERSION}`;

self.addEventListener("install", (event) => {
  // Activate immediately — don't make the user close/reopen the PWA.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== STATIC_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const STATIC_EXTS = /\.(?:js|css|png|jpg|jpeg|webp|avif|gif|svg|ico|woff2?|ttf|otf)$/i;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigation (HTML pages): untouched — browser handles it directly.
  if (request.mode === "navigate") return;

  // API: untouched. Auth cookies + redirects must flow unmodified.
  if (url.pathname.startsWith("/api/")) return;

  // Cross-origin: untouched.
  if (url.origin !== self.location.origin) return;

  // Static same-origin assets: cache-first with background revalidate.
  if (STATIC_EXTS.test(url.pathname) || url.pathname === "/manifest.json") {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(request);
      const net = fetch(request).then((res) => {
        if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
