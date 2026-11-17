import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { api } from "../../api/client";
import UnifiedAegisPlatform from "../UnifiedAegisPlatform";

jest.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }));
jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../api/client", () => ({ api: { get: jest.fn(), put: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API: "/api", useAuth: () => ({ user: { user_id: "u1", role: mockRole } }) }));
jest.mock("../../context/ActiveJobContext", () => ({ useActiveJob: () => ({ rig: "RIG1", well: { name: "" }, mode: "LIVE" }) }));
jest.mock("../../context/RigContext", () => ({
  RIGS: [{ id: "RIG1", label: "Rig 1" }],
  useRig: () => ({ labels: {}, statuses: {} }),
}));
jest.mock("../../context/TierContext", () => ({ useTier: () => ({ canAccess: () => true }) }));
jest.mock("../JobGauges", () => () => <div>Feed readings</div>);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockRole = "ops_manager";

beforeEach(() => {
  localStorage.clear();
  mockRole = "ops_manager";
  api.get.mockReset();
  api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/rbac/members")
    ? { members: [{ user_id: "u1", name: "Engineer" }] }
    : url.endsWith("/org/rigs")
      ? [{ rig_id: "CT-UNIT-01" }]
      : { assignments: [] } }));
  api.put.mockReset();
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith("/treatments/active")
      ? { treatment: { treatment_id: "trt_1", name: "Well 12" } }
      : { entries: [{ entry_id: "e1", text: "Tagged plug", kind: "event", operation_code: 13, event_at: "2026-11-16T12:00:00Z", telemetry_snapshot: { depth_ft: 12000 } }] },
  }));
});

test("restores the selected environment for this user", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<UnifiedAegisPlatform />));
  const supervisor = [...host.querySelectorAll("nav button")].find((button) => button.textContent.includes("Supervisor"));
  await act(async () => supervisor.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(localStorage.getItem("aegis_environment:u1")).toBe("supervisor");
  await act(async () => root.unmount());

  const secondRoot = createRoot(host);
  await act(async () => secondRoot.render(<UnifiedAegisPlatform />));
  const restoredSupervisor = [...host.querySelectorAll("nav button")].find((button) => button.textContent.includes("Supervisor"));
  expect(restoredSupervisor.getAttribute("aria-pressed")).toBe("true");
  await act(async () => secondRoot.unmount());
  host.remove();
});

test("saves a team member assignment through the server and surfaces errors", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<UnifiedAegisPlatform />));
  const select = host.querySelector('[aria-label="Lead engineer for CT-UNIT-01"]');
  api.put.mockResolvedValueOnce({ data: { rig_id: "CT-UNIT-01", user_id: "u1" } });
  await act(async () => { select.value = "u1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(api.put).toHaveBeenCalledWith("/api/rigs/CT-UNIT-01/lead-assignment", { user_id: "u1" });
  expect(select.value).toBe("u1");

  api.put.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector('[role="alert"]').textContent).toContain("Unable to save");
  expect(select.value).toBe("u1");
  await act(async () => root.unmount());
  host.remove();
});

test("operator cannot select management or supervisor environment", async () => {
  mockRole = "crew";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<UnifiedAegisPlatform />));
  expect(host.textContent).toContain("Rig floor");
  expect(host.textContent).not.toContain("Fleet dispatch");
  const tools = host.querySelector('[aria-labelledby="operator-tools-heading"]');
  expect(tools.textContent).toContain("Open separate tools");
  expect(tools.textContent).toContain("They are not features built into this panel.");
  expect([...tools.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Go to operator cockpit", "/live"],
    ["Go to treatment log", "/log"],
    ["Go to active job", "/job"],
  ]);
  expect(api.get).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  host.remove();
});

test("supervisor timeline shows actual treatment events", async () => {
  mockRole = "field_manager";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<UnifiedAegisPlatform />));
  expect(host.querySelector("#job-timeline-heading")).not.toBeNull();
  expect(host.textContent).toContain("Tag Fill / Top of Fish");
  expect(host.textContent).toContain("Tagged plug");
  expect(host.textContent).toContain("12,000 ft");
  await act(async () => root.unmount());
  host.remove();
});
