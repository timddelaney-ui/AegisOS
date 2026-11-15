import * as store from "../fieldStore";
import { addDraft, draftKey, updateDrafts } from "../treatmentDrafts";
global.structuredClone = global.structuredClone || ((value) => JSON.parse(JSON.stringify(value)));
require("fake-indexeddb/auto");
jest.mock("../../context/AuthContext", () => ({ API: "/api" }));
afterEach(() => jest.restoreAllMocks());
const body = (text) => ({ text, kind: "note", event_at: "2026-01-01T12:00:00Z" });

test("concurrent local entries are durable, ordered and scoped to the job", async () => {
  const key = draftKey("draft-test", store.uuid());
  await Promise.all([addDraft(key, body("First"), { rig_id: "rig-1" }), addDraft(key, body("Second"), { rig_id: "rig-1" })]);
  expect((await store.getState(key)).map((entry) => entry.text)).toEqual(["First", "Second"]);
  expect(await store.getState(draftKey("draft-test", "another-job"), [])).toEqual([]);
});
test("delivery uncertainty persists without scheduling an automatic retry", async () => {
  const key = draftKey("draft-test", store.uuid());
  const entry = await addDraft(key, body("Review delivery"), { sync_status: "uncertain" });
  await updateDrafts(key, (entries) => entries.map((item) => ({ ...item, treatment_id: "original-treatment" })));
  expect(await store.getState(key)).toEqual([expect.objectContaining({ entry_id: entry.entry_id, sync_status: "uncertain", treatment_id: "original-treatment" })]);
});
test("storage failures and invalid timestamps are explicit, not false success", async () => {
  const key = draftKey("draft-test", store.uuid());
  jest.spyOn(store, "verifyStorage").mockResolvedValueOnce({ ok: false });
  await expect(addDraft(key, body("Cannot save"), {})).rejects.toThrow("storage is unavailable");
  await expect(addDraft(key, { ...body("Bad timestamp"), event_at: "invalid" }, {})).rejects.toThrow("valid event timestamp");
  expect(await store.getState(key, [])).toEqual([]);
  await expect(addDraft(key, body("Recovered"), {})).resolves.toMatchObject({ text: "Recovered" });
});
