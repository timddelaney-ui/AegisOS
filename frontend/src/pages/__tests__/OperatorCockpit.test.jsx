import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OperatorCockpit from "../OperatorCockpit";
import { UnitProvider } from "../../context/UnitContext";

jest.mock("react-router-dom", () => ({
  NavLink: ({ to, children, className, ...props }) => (
    <a href={to} className={typeof className === "function" ? className({ isActive: to === "/cockpit" }) : className} {...props}>{children}</a>
  ),
}));
jest.mock("axios", () => ({ post: jest.fn(() => Promise.reject({ response: { status: 500 } })), get: jest.fn(() => Promise.resolve({ data: {} })) }));
jest.mock("sonner", () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API: "/api", useAuth: () => ({ user: { name: "Op", role: "crew", team_id: "org1" } }) }));
jest.mock("../../context/ActiveReelContext", () => ({ useActiveReel: () => ({ activeReel: null }) }));
jest.mock("../../utils/offlineQueue", () => ({ enqueue: jest.fn() }));
jest.mock("../../context/OperatorTelemetryContext", () => {
  const value = {
    feedMode: "SIM", live: false, liveStale: false,
    telemetry: { depth: 9000, internalPress: 5000, whp: 6000, weight: -800, slurryRate: 2, speedFtPerMin: 30, inclination: 85, encoder_1_depth_ft: 9000, encoder_2_depth_ft: 9001, encoder_3_depth_ft: 9004 },
  };
  return { useOperatorTelemetry: () => { value.telemetry.inclination = mockInclination; return value; } };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockInclination = 85;

test.each([0, 85])("cockpit renders finite charts at %s degrees and flags encoder mismatch + compression", async (inclination) => {
  mockInclination = inclination;
  const err = jest.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<UnitProvider><OperatorCockpit /></UnitProvider>); });
  expect(host.querySelector('[data-testid="encoder-warning"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="cockpit-title"]').textContent).toContain("WIDE-DECK LAYOUT");
  expect(host.querySelector('[data-testid="cockpit-rail"] a[aria-label="Treatment Log / Notes"]').getAttribute("href")).toBe("/log");
  expect(host.querySelector('[data-testid="strip-chart"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="envelope-panel"] svg').outerHTML).not.toMatch(/NaN|Infinity/);
  expect(host.querySelector('[data-testid="buckling-status"]').textContent).toContain("COMPRESSION");
  expect(host.querySelectorAll('[data-testid^="fatigue-"]').length).toBeGreaterThanOrEqual(3);
  expect(host.querySelector('[data-testid="role-badge"]').textContent).toBe("Crew");
  await act(async () => root.unmount());
  host.remove();
  const errors = err.mock.calls.filter((c) => !String(c[0]).includes("getContext"));
  err.mockRestore();
  expect(errors).toEqual([]);
});
