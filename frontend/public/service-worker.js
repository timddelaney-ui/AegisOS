// CT Field Workbook — service worker.
// Strategy:
//   • Static assets (JS/CSS/images, same-origin): cache-first with stale-while-revalidate
//   • API calls (/api/*): network-first, falling back to cache if offline (last-known-good)
//   • Navigation (HTML): network-first, falling back to the app shell cache
const SW_VERSION = "v1.0.0";
const STATIC_CACHE = `ct-static-${SW_VERSION}`;
const API_CACHE    = `ct-api-${SW_VERSION}`;
const APP_SHELL = ["/", "/manifest.json", "/favicon.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    try { await cache.addAll(APP_SHELL); } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !n.endsWith(SW_VERSION)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isApiRequest = (url) => url.pathname.startsWith("/api/");
const isSameOrigin = (url) => url.origin === self.location.origin;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigation: HTML pages → network-first, fall back to cached shell
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const net = await fetch(request);
        const cache = await caches.open(STATIC_CACHE);
        cache.put("/", net.clone()).catch(() => {});
        return net;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match("/")) || Response.error();
      }
    })());
    return;
  }

  // API: network-first, offline fallback to last-known-good GET
  if (isSameOrigin(url) && isApiRequest(url)) {
    event.respondWith((async () => {
      try {
        const net = await fetch(request);
        if (net.ok) {
          const cache = await caches.open(API_CACHE);
          cache.put(request, net.clone()).catch(() => {});
        }
        return net;
      } catch {
        const cache = await caches.open(API_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        return new Response(JSON.stringify({ offline: true, detail: "You're offline — showing last-known data." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
    })());
    return;
  }

  // Static assets: cache-first + background revalidate (SWR)
  if (isSameOrigin(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(request);
      const network = fetch(request).then((res) => {
        if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      return hit || (await network) || Response.error();
    })());
  }
});

// Allow the page to trigger an immediate update
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
