// Aegis OS service worker (v4).
//   • Static same-origin assets: cache-first with background revalidate.
//   • HTML navigation: network-first; falls back to the cached app shell,
//     then /offline.html, so the installed PWA opens with no signal.
//   • /api/* and cross-origin requests: never intercepted (auth cookies and
//     redirects flow unmodified). Offline writes are queued client-side.
//   • On activate, caches from other versions are deleted.
//   • Install precaches every hashed JS/CSS bundle listed in /asset-manifest.json
//     so the whole app loads offline after the very first visit.
//   • Background Sync ("aegis-drain"): replays the IndexedDB outbox written by
//     src/lib/fieldStore.js even if no tab is open. Each item carries a client_id
//     so the server de-duplicates replays.
const SW_VERSION = "v4.0.0";
const STATIC_CACHE = `ct-static-${SW_VERSION}`;

const SHELL = ["/", "/offline.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  // Activate immediately — don't make the user close/reopen the PWA.
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})));
    try {
      const res = await fetch("/asset-manifest.json", { cache: "no-store" });
      const m = await res.json();
      const files = Object.values(m.files || {}).filter((f) => typeof f === "string" && !f.endsWith(".map"));
      await Promise.all(files.map((f) => cache.add(f).catch(() => {})));
    } catch { /* manifest unavailable: runtime caching still applies */ }
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

// ───────── Background Sync: drain the outbox ─────────
const DB_NAME = "aegis_field_v1";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const idbReq = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

async function drainOutboxFromSW() {
  let db;
  try { db = await openDb(); } catch { return; }
  if (!db.objectStoreNames.contains("outbox")) return;
  const all = await idbReq(db.transaction("outbox").objectStore("outbox").getAll());
  const pending = all.filter((x) => x.status === "pending").sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const PERMANENT = [400, 404, 409, 413, 422];
  for (const item of pending) {
    let res;
    try {
      res = await fetch(item.url, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.body),
      });
    } catch { throw new Error("offline"); } // keeps the sync tag registered for retry
    let patch = null;
    if (res.ok) patch = { status: "sent", sent_at: new Date().toISOString() };
    else if (PERMANENT.includes(res.status)) patch = { status: "rejected", last_error: `HTTP ${res.status}` };
    else throw new Error(`retry ${res.status}`);
    const t = db.transaction("outbox", "readwrite");
    t.objectStore("outbox").put({ ...item, ...patch, attempts: (item.attempts || 0) + 1 });
    await new Promise((r) => { t.oncomplete = r; t.onerror = r; });
  }
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((c) => c.postMessage({ type: "AEGIS_OUTBOX_CHANGED" }));
}

self.addEventListener("sync", (event) => {
  if (event.tag === "aegis-drain") event.waitUntil(drainOutboxFromSW());
});
