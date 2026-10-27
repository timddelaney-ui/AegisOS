// Offline-first durable store for field data (IndexedDB, with localStorage fallback).
//
//   outbox — every write destined for the server. Persisted BEFORE the network
//            attempt (write-ahead), keyed by a client UUID so replays are idempotent.
//   wal    — append-only log of operator inputs (depth, reel, cycles, parameters).
//   kv     — latest-state snapshots; mirrored to localStorage for instant sync restore.
//
// The service worker (public/service-worker.js) reads the same "outbox" store to
// drain in the background, so keep DB_NAME / store names / item shape in sync.
import axios from "axios";
import { API } from "../context/AuthContext";

export const DB_NAME = "aegis_field_v1";
const DB_VERSION = 1;
const STORES = { outbox: "client_id", wal: null, kv: "key" };
const LS_PREFIX = "aegis_kv_";
const LS_FALLBACK = "aegis_fb_";
const WAL_MAX = 20000;
const SENT_KEEP = 5000;
const SEND_TIMEOUT_MS = 8000;

export const uuid = () => {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  const b = new Uint8Array(16);
  (crypto?.getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; }));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

// ───────────── storage adapter ─────────────
let dbPromise = null;
const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        Object.entries(STORES).forEach(([name, keyPath]) => {
          if (db.objectStoreNames.contains(name)) return;
          db.createObjectStore(name, keyPath ? { keyPath } : { autoIncrement: true });
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
};

const tx = (db, store, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(store, mode);
  const s = t.objectStore(store);
  let result;
  const r = fn(s);
  if (r) r.onsuccess = () => { result = r.result; };
  t.oncomplete = () => resolve(result);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
});

const fbRead = (store) => { try { return JSON.parse(localStorage.getItem(LS_FALLBACK + store) || "[]"); } catch { return []; } };
const fbWrite = (store, arr) => { try { localStorage.setItem(LS_FALLBACK + store, JSON.stringify(arr)); } catch { /* quota */ } };
const keyOf = (store, o) => o[STORES[store]];

const adapter = {
  async put(store, obj) {
    const db = await openDb();
    if (db) return tx(db, store, "readwrite", (s) => s.put(obj));
    const arr = fbRead(store).filter((x) => keyOf(store, x) !== keyOf(store, obj));
    arr.push(obj); fbWrite(store, arr);
  },
  async add(store, obj) {
    const db = await openDb();
    if (db) return tx(db, store, "readwrite", (s) => s.add(obj));
    const arr = fbRead(store); arr.push(obj); fbWrite(store, arr.slice(-WAL_MAX));
  },
  async get(store, key) {
    const db = await openDb();
    if (db) return tx(db, store, "readonly", (s) => s.get(key));
    return fbRead(store).find((x) => keyOf(store, x) === key);
  },
  async getAll(store) {
    const db = await openDb();
    if (db) return tx(db, store, "readonly", (s) => s.getAll());
    return fbRead(store);
  },
  async del(store, key) {
    const db = await openDb();
    if (db) return tx(db, store, "readwrite", (s) => s.delete(key));
    fbWrite(store, fbRead(store).filter((x) => keyOf(store, x) !== key));
  },
  async count(store) {
    const db = await openDb();
    if (db) return tx(db, store, "readonly", (s) => s.count());
    return fbRead(store).length;
  },
  async trimOldest(store, keep) {
    const db = await openDb();
    if (!db) return;
    let n = (await adapter.count(store)) - keep;
    if (n <= 0) return;
    await tx(db, store, "readwrite", (s) => {
      const cur = s.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c && n > 0) { c.delete(); n -= 1; c.continue(); }
      };
      return null;
    });
  },
};

// ───────────── key/value snapshots (instant restore) ─────────────
export function getStateSync(key, fallback = null) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function setState(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch { /* quota: IDB below is the durable copy */ }
  return adapter.put("kv", { key, value, saved_at: new Date().toISOString() }).catch(() => {});
}

export async function getState(key, fallback = null) {
  try {
    const row = await adapter.get("kv", key);
    return row ? row.value : getStateSync(key, fallback);
  } catch { return getStateSync(key, fallback); }
}

/** Copy IDB snapshots back into localStorage (it can be cleared independently). Call once before first render. */
export async function hydrateKv() {
  try {
    const rows = await adapter.getAll("kv");
    rows.forEach((r) => {
      if (localStorage.getItem(LS_PREFIX + r.key) == null) {
        try { localStorage.setItem(LS_PREFIX + r.key, JSON.stringify(r.value)); } catch { /* ignore */ }
      }
    });
  } catch { /* ignore */ }
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
}

// ───────────── write-ahead input log ─────────────
let walWrites = 0;
export function walAppend(type, payload) {
  const row = { ts: new Date().toISOString(), type, payload };
  walWrites += 1;
  const p = adapter.add("wal", row).catch(() => {});
  if (walWrites % 500 === 0) adapter.trimOldest("wal", WAL_MAX).catch(() => {});
  return p;
}

// ───────────── outbox ─────────────
const listeners = new Set();
let pending = 0;
const notify = async () => {
  try {
    const all = await adapter.getAll("outbox");
    pending = all.filter((x) => x.status === "pending").length;
  } catch { /* ignore */ }
  listeners.forEach((fn) => { try { fn(pending); } catch { /* ignore */ } });
  try { window.dispatchEvent(new CustomEvent("aegis:outbox-change", { detail: { pending } })); } catch { /* ignore */ }
};
export const subscribeOutbox = (fn) => { listeners.add(fn); fn(pending); return () => listeners.delete(fn); };
export const pendingCount = () => pending;

const PERMANENT = new Set([400, 404, 409, 413, 422]);
const AUTH = new Set([401, 403]);

async function trySend(item) {
  const res = await axios.post(item.url, item.body, { withCredentials: true, timeout: SEND_TIMEOUT_MS });
  return res.data;
}

async function settle(item, patch) {
  await adapter.put("outbox", { ...item, ...patch });
}

let draining = false;
export async function drainOutbox() {
  if (draining) return { sent: 0, left: pending };
  draining = true;
  let sent = 0;
  try {
    const all = (await adapter.getAll("outbox")).filter((x) => x.status === "pending");
    all.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    for (const item of all) {
      try {
        await trySend(item);
        await settle(item, { status: "sent", sent_at: new Date().toISOString(), attempts: (item.attempts || 0) + 1 });
        sent += 1;
      } catch (e) {
        const code = e?.response?.status;
        if (code && PERMANENT.has(code)) {
          const detail = e.response?.data?.detail;
          await settle(item, { status: "rejected", attempts: (item.attempts || 0) + 1,
            last_error: typeof detail === "string" ? detail : `HTTP ${code}` });
          continue;
        }
        await settle(item, { attempts: (item.attempts || 0) + 1, last_error: code ? `HTTP ${code}` : "offline" });
        break; // offline / auth / 5xx — keep order, retry later
      }
    }
    const done = (await adapter.getAll("outbox")).filter((x) => x.status === "sent");
    if (done.length > SENT_KEEP) {
      done.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      await Promise.all(done.slice(0, done.length - SENT_KEEP).map((x) => adapter.del("outbox", x.client_id)));
    }
  } finally {
    draining = false;
    await notify();
  }
  return { sent, left: pending };
}

/**
 * Persist first, then attempt delivery. Resolves { status: "sent"|"queued"|"rejected", client_id, data?, error? }.
 * The body is stamped with client_id (server dedupe key) and event_at (true event time).
 */
export async function postResilient(path, body, { kind = "feed" } = {}) {
  const client_id = body.client_id || uuid();
  const event_at = body.event_at || new Date().toISOString();
  const stamped = { ...body, client_id, event_at };
  const item = {
    client_id, kind, path, url: `${API}${path}`, body: stamped,
    status: "pending", attempts: 0, created_at: event_at, last_error: null,
  };
  try { await adapter.put("outbox", item); } catch { /* storage failure: still try the network */ }
  await notify();
  requestBackgroundSync();
  try {
    const data = await trySend(item);
    await settle(item, { status: "sent", sent_at: new Date().toISOString(), attempts: 1 }).catch(() => {});
    await notify();
    return { status: "sent", client_id, data };
  } catch (e) {
    const code = e?.response?.status;
    if (code && PERMANENT.has(code)) {
      const detail = e.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : `HTTP ${code}`;
      await settle(item, { status: "rejected", attempts: 1, last_error: msg }).catch(() => {});
      await notify();
      return { status: "rejected", client_id, error: msg };
    }
    await settle(item, { attempts: 1, last_error: code ? `HTTP ${code}` : "offline" }).catch(() => {});
    await notify();
    return { status: "queued", client_id };
  }
}

function requestBackgroundSync() {
  try {
    navigator.serviceWorker?.ready?.then((reg) => reg.sync?.register("aegis-drain")).catch(() => {});
  } catch { /* unsupported */ }
}

let started = false;
export function startFieldSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  migrateLegacyQueue().finally(() => { notify(); drainOutbox(); });
  setInterval(drainOutbox, 15000);
  window.addEventListener("online", drainOutbox);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") drainOutbox(); });
  navigator.serviceWorker?.addEventListener?.("message", (e) => {
    if (e.data?.type === "AEGIS_DRAIN" || e.data?.type === "AEGIS_OUTBOX_CHANGED") drainOutbox();
  });
}

// Pre-IndexedDB builds stored failed liveops samples in localStorage.
async function migrateLegacyQueue() {
  const KEY = "ctp_liveops_offline_queue_v1";
  try {
    const legacy = JSON.parse(localStorage.getItem(KEY) || "[]");
    for (const s of legacy) {
      const { _queued_at, ...rest } = s;
      const client_id = uuid();
      const event_at = _queued_at || new Date().toISOString();
      await adapter.put("outbox", {
        client_id, kind: "liveops", path: "/liveops/feed", url: `${API}/liveops/feed`,
        body: { ...rest, client_id, event_at }, status: "pending", attempts: 0, created_at: event_at, last_error: null,
      });
    }
    if (legacy.length) localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

// ───────────── export ─────────────
export async function collectJobData() {
  const [outbox, wal, kvRows] = await Promise.all([
    adapter.getAll("outbox"), adapter.getAll("wal"), adapter.getAll("kv"),
  ]);
  outbox.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return {
    exported_at: new Date().toISOString(),
    app: "Aegis OS",
    note: "Raw local job data. Units are IMPERIAL (ft, psi, lbf) as stored.",
    pending_unsynced: outbox.filter((x) => x.status === "pending").length,
    snapshots: Object.fromEntries(kvRows.map((r) => [r.key, r.value])),
    outbox,
    input_log: wal,
  };
}

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+@]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function jobDataToCSV(data) {
  const bodyKeys = [...new Set(data.outbox.flatMap((o) => Object.keys(o.body || {})))]
    .filter((k) => !["client_id", "event_at"].includes(k)).sort();
  const head = ["event_at", "sync_status", "kind", "client_id", ...bodyKeys, "last_error"];
  const lines = [head.join(",")];
  data.outbox.forEach((o) => {
    lines.push([o.body?.event_at || o.created_at, o.status, o.kind, o.client_id,
      ...bodyKeys.map((k) => o.body?.[k]), o.last_error].map(csvCell).join(","));
  });
  lines.push("", "# INPUT LOG", "ts,type,payload");
  data.input_log.forEach((w) => lines.push([w.ts, w.type, w.payload].map(csvCell).join(",")));
  return lines.join("\n");
}

export function downloadBlob(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportJob(format = "json") {
  const data = await collectJobData();
  const stamp = data.exported_at.replace(/[:.]/g, "-");
  if (format === "csv") downloadBlob(`aegis-job-${stamp}.csv`, jobDataToCSV(data), "text/csv;charset=utf-8");
  else downloadBlob(`aegis-job-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
  return data;
}
