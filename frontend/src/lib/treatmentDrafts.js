import { getState, getStateSync, setState, uuid, verifyStorage } from "./fieldStore";

export const draftKey = (userId, jobId) => `treatment_drafts:${userId}:${jobId}`;
export const readDrafts = (key) => getStateSync(key, []);
const pending = new Map();
export async function writeDrafts(key, drafts) {
  const storage = await verifyStorage();
  if (!storage.ok) throw new Error("Device storage is unavailable. This log entry cannot be saved offline.");
  await setState(key, drafts);
  const saved = await getState(key, null);
  if (JSON.stringify(saved) !== JSON.stringify(drafts)) throw new Error("Could not verify the saved log draft.");
  return drafts;
}
export function updateDrafts(key, update) {
  const previous = pending.get(key) || Promise.resolve();
  const operation = previous.then(async () => writeDrafts(key, update(await getState(key, []))));
  // Keep the serialization chain usable after an explicitly surfaced storage error.
  pending.set(key, operation.catch(() => {}));
  return operation;
}
export async function addDraft(key, body, metadata) {
  if (!body.text?.trim() || !Number.isFinite(Date.parse(body.event_at))) throw new Error("Text and a valid event timestamp are required.");
  const entry = { ...body, sync_status: "local", ...metadata, entry_id: uuid() };
  await updateDrafts(key, (drafts) => [...drafts, entry]);
  return entry;
}
