// Ordered offline queue for job-log rows, task completions and parts/consumables
// requests. IndexedDB (auto-increment key = monotonic sequence) with an in-memory
// fallback. Flushes strictly in sequence order; the first transient failure stops
// the flush so ordering is preserved. Legacy exports from lib/offlineQueue stay available.
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API } from "../context/AuthContext";

export * from "../lib/offlineQueue";

// Real server routes: job-log rows are treatment entries, task completion is PATCH /tasks/{id}.
export const QUEUE_TYPES = {
  job_log: (p) => ({ method: "post", url: `/treatments/${p.treatment_id}/entries`, data: { ...p, treatment_id: undefined } }),
  task_completion: (p) => ({ method: "patch", url: `/tasks/${p.task_id}`, data: { status: "done" } }),
  parts_request: (p) => ({ method: "post", url: "/approvals/requests", data: p }),
};

const DB_NAME = "aegis_job_queue_v1";
const STORE = "queue";
let dbPromise = null;
let mem = [];
let memSeq = 0;
let sender = (item) => {
  const { method, url, data } = QUEUE_TYPES[item.type](item.payload);
  return axios.request({ method, url: `${API}${url}`, data, withCredentials: true });
};
let flushing = null;
const listeners = new Set();

export const setQueueSender = (fn) => { sender = fn; };

const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
};

const run = async (mode, fn) => {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
  });
};

async function readAll() {
  const db = await openDb();
  if (!db) return [...mem].sort((a, b) => a.seq - b.seq);
  const rows = await run("readonly", (s) => s.getAll());
  return (rows || []).sort((a, b) => a.seq - b.seq);
}

async function remove(seq) {
  if (!(await openDb())) { mem = mem.filter((r) => r.seq !== seq); return; }
  await run("readwrite", (s) => s.delete(seq));
}

async function notify() {
  const n = (await readAll()).filter((r) => !r.failed).length;
  listeners.forEach((fn) => fn(n));
  return n;
}

export const pendingQueueCount = async () => (await readAll()).filter((r) => !r.failed).length;
export const peekQueue = readAll;

export async function enqueue(type, payload) {
  if (!QUEUE_TYPES[type]) throw new Error(`Unknown offline queue type: ${type}`);
  const item = { type, payload, created_at: new Date().toISOString(), client_id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` };
  if (await openDb()) {
    item.seq = await run("readwrite", (s) => s.add(item));
  } else {
    item.seq = ++memSeq;
    mem.push(item);
  }
  await notify();
  if (typeof navigator === "undefined" || navigator.onLine !== false) flush().catch(() => {});
  return item;
}

const PERMANENT = (status) => status >= 400 && status < 500 && ![401, 403, 408, 425, 429].includes(status);

export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const item of await readAll()) {
      if (item.failed) continue;
      try {
        await sender(item);
        await remove(item.seq);
        sent += 1;
      } catch (error) {
        const status = error?.response?.status;
        if (PERMANENT(status)) {
          // A rejected payload must not block later rows; keep it visible for review.
          if (await openDb()) await run("readwrite", (s) => s.put({ ...item, failed: true, error: status }));
          else item.failed = true;
          continue;
        }
        break; // network / auth / server trouble: retry later, keep order
      }
    }
    await notify();
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

export const subscribeQueue = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const resetQueueForTests = async () => {
  mem = []; memSeq = 0; flushing = null;
  if (await openDb()) await run("readwrite", (s) => s.clear());
};

let wired = false;
export function startQueueSync() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("online", () => { flush().catch(() => {}); });
}

export function useOfflineQueue() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    startQueueSync();
    let alive = true;
    pendingQueueCount().then((n) => alive && setPending(n));
    const off = subscribeQueue((n) => alive && setPending(n));
    return () => { alive = false; off(); };
  }, []);
  const add = useCallback((type, payload) => enqueue(type, payload), []);
  return { pending, enqueue: add, flush };
}
