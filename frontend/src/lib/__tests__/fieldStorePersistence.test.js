// jsdom lacks structuredClone, which fake-indexeddb needs.
global.structuredClone = global.structuredClone || ((v) => JSON.parse(JSON.stringify(v)));
require("fake-indexeddb/auto");

jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API: "/api" }));

describe("offline persistence (IndexedDB)", () => {
  test("storage round-trips and snapshots survive a simulated reboot", async () => {
    let store = require("../fieldStore");
    expect(await store.verifyStorage()).toMatchObject({ ok: true, backend: "indexeddb" });

    await store.setState("shadow_log", [{ id: "a" }]);
    await store.walAppend("depth", { depth_ft: 1234 });

    // "Reboot": drop module + localStorage, keep IndexedDB.
    localStorage.clear();
    jest.resetModules();
    store = require("../fieldStore");
    expect(store.getStateSync("shadow_log")).toBeNull();
    await store.hydrateKv();
    expect(store.getStateSync("shadow_log")).toEqual([{ id: "a" }]);
    const data = await store.collectJobData();
    expect(data.input_log.some((w) => w.type === "depth" && w.payload.depth_ft === 1234)).toBe(true);
  });
});
