// Aegis OS service worker (v3).
//   • Static same-origin assets: cache-first with background revalidate.
//   • HTML navigation: network-first; falls back to the cached app shell,
//     then /offline.html, so the installed PWA opens with no signal.
//   • /api/* and cross-origin requests: never intercepted (auth cookies and
//     redirects flow unmodified). Offline writes are queued client-side.
//   • On activate, caches from other versions are deleted.
const SW_VERSION = "v3.0.0";
const STATIC_CACHE = `ct-static-${SW_VERSION}`;

const SHELL = ["/", "/offline.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  // Activate immediately — don't make the user close/reopen the PWA.
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
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

  if (request.mode === "navigate") {
    if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      try {
        const res = await fetch(request);
        if (res && res.ok) cache.put("/", res.clone()).catch(() => {});
        return res;
      } catch {
        return (await cache.match("/")) || (await cache.match("/offline.html")) || Response.error();
      }
    })());
    return;
  }

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
