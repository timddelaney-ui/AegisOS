// Compatibility wrapper — the queue now lives in fieldStore.js (IndexedDB outbox
// with client UUID idempotency keys and background sync).
import { postResilient, drainOutbox, pendingCount, startFieldSync } from "./fieldStore";

export async function postSampleResilient(sample) {
  const r = await postResilient("/liveops/feed", sample, { kind: "liveops" });
  return r.status === "sent" ? "sent" : r.status;
}
export const enqueueSample = (sample) => postResilient("/liveops/feed", sample, { kind: "liveops" });
export const drainOfflineQueue = drainOutbox;
export const offlineQueueLength = pendingCount;
export const startOfflineDrain = startFieldSync;
