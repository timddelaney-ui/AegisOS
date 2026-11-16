import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ClassicMode from "../ClassicMode";
import { UnitProvider } from "../../context/UnitContext";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../context/AuthContext", () => ({ API: "/api" }));
jest.mock("../../utils/offlineQueue", () => ({ enqueue: jest.fn() }));
jest.mock("../../hooks/useCockpitSignals", () => ({
  useCockpitSignals: () => ({
    pInt: 5000, pWh: 6000, dp: -1000, weight: -300, depth: 9000, pump: 1.5, direction: "POOH", connection: "SIMULATED",
    encoders: [9000, 9001, 9004], consensus: { mismatch: true, maxDeltaFt: 4 },
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("renders six digital tiles, no dials, compression sign and quick actions", async () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  localStorage.clear();
  await act(async () => { root.render(<UnitProvider><ClassicMode /></UnitProvider>); });
  expect(host.querySelector('[data-testid="tile-grid"]').children).toHaveLength(6);
  expect(host.querySelector("svg, canvas, [class*='dial'], [class*='radial']")).toBeNull();
  expect(host.querySelector('[data-testid="tile-weight"]').textContent).toContain("-300");
  expect(host.querySelector('[data-testid="tile-diff"]').textContent).toContain("-1000");
  expect(host.querySelector('[data-testid="encoder-warning"]')).not.toBeNull();
  const text = host.textContent;
  ["LOG EVENT", "MARK DEPTH", "COMPLETE TASK", "PARTS / CONSUMABLES REQUEST"].forEach((t) => expect(text).toContain(t));
  const logBtn = [...host.querySelectorAll("button")].find((b) => b.textContent === "LOG EVENT");
  await act(async () => { logBtn.click(); });
  expect(host.querySelector('form[role="dialog"] input')).not.toBeNull();
  const units = host.querySelector('select[aria-label="Display units"]');
  await act(async () => { units.value = "metric"; units.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector('[data-testid="tile-coil"]').textContent).toContain("34.5");
  expect(host.querySelector('[data-testid="tile-coil"]').textContent).toContain("MPa");
  expect(host.querySelector('[data-testid="tile-weight"]').textContent).toContain("-133.4");
  expect(host.querySelector('[data-testid="tile-weight"]').getAttribute("data-status")).toBe("warning");
  expect(host.querySelector('[data-testid="tile-depth"]').textContent).toContain("2743.2");
  expect(host.querySelector('[data-testid="encoder-warning"]').textContent).toContain("0.61 m");
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});
