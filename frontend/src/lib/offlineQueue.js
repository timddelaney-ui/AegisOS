// Thin offline queue for /api/liveops/feed POSTs. Phase 2.
// Keeps up to N failed samples in localStorage and drains on interval when online.
import axios from "axios";
import { API } from "../context/AuthContext";

const KEY = "ctp_liveops_offline_queue_v1";
const MAX = 500;

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};
const write = (arr) => {
  try { localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX))); } catch {}
};

export function enqueueSample(sample) {
  const q = read();
  q.push({ ...sample, _queued_at: new Date().toISOString() });
  write(q);
}

export async function postSampleResilient(sample) {
  try {
    await axios.post(`${API}/liveops/feed`, sample, { withCredentials: true, timeout: 3000 });
    return "sent";
  } catch (e) {
    enqueueSample(sample);
    return "queued";
  }
}

let draining = false;
export async function drainOfflineQueue() {
  if (draining) return;
  const q = read();
  if (q.length === 0) return;
  draining = true;
  try {
    for (let i = 0; i < q.length; i++) {
      const sample = q[i];
      try {
        await axios.post(`${API}/liveops/feed`, sample, { withCredentials: true, timeout: 3000 });
      } catch {
        // network still down → leave remaining in queue
        const remaining = q.slice(i);
        write(remaining);
        return;
      }
    }
    write([]);
  } finally {
    draining = false;
  }
}

export function offlineQueueLength() {
  return read().length;
}

// Start a periodic drain loop
let started = false;
export function startOfflineDrain() {
  if (started) return;
  started = true;
  setInterval(drainOfflineQueue, 15000);
  window.addEventListener("online", drainOfflineQueue);
}
