import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { useOperatorFeed } from "../useOperatorFeed";
import { simTick } from "../../lib/operatorConfig";

jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../context/AuthContext", () => ({ API: "https://api.example.com/api" }));
jest.mock("../../lib/operatorConfig", () => ({
  SEED_TELEMETRY: { depth: 10 },
  simTick: jest.fn((previous) => ({ ...previous, depth: previous.depth + 1 })),
  fromDaqSample: (previous, sample) => ({ ...previous, depth: sample.depth_ft }),
}));

let feed, root, container;
function Harness({ mode }) {
  feed = useOperatorFeed({ rigId: "RIG2", feedMode: mode, minFt: 0, maxFt: 100 });
  return <span>{feed.telemetry.depth}</span>;
}
beforeEach(() => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.WebSocket = jest.fn(() => ({ close: jest.fn() }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  simTick.mockImplementation((previous) => ({ ...previous, depth: previous.depth + 1 }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
test("the existing simulator ticks at 500ms and standby holds the feed", () => {
  act(() => root.render(<Harness mode="SIM" />));
  act(() => jest.advanceTimersByTime(500));
  expect(feed.telemetry.depth).toBe(11);
  expect(simTick).toHaveBeenCalledWith({ depth: 10 }, 1, 0, 100);
  act(() => root.render(<Harness mode="STANDBY" />));
  act(() => jest.advanceTimersByTime(2000));
  expect(feed.telemetry.depth).toBe(11);
  expect(feed.historyRef.current).toHaveLength(1);
});
test("live mode accepts fresh rig-scoped samples and retains the stale fallback", async () => {
  axios.get.mockResolvedValue({ data: { samples: [{ depth_ft: 42, created_at: new Date().toISOString() }] } });
  await act(async () => root.render(<Harness mode="LIVE" />));
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("/liveops/stream"), expect.objectContaining({ params: { limit: 1, rig_id: "RIG2" } }));
  expect(feed.telemetry.depth).toBe(42);
  act(() => jest.advanceTimersByTime(500));
  expect(simTick).not.toHaveBeenCalled();
  axios.get.mockResolvedValue({ data: { samples: [] } });
  await act(async () => jest.advanceTimersByTime(2000));
  expect(feed.liveStale).toBe(true);
  act(() => jest.advanceTimersByTime(500));
  expect(simTick).toHaveBeenCalled();
  expect(feed.lastLiveSample).toBeNull();
});
