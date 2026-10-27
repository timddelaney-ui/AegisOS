import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import ErrorBoundary from "../../components/ErrorBoundary";

global.IS_REACT_ACT_ENVIRONMENT = true;
global.structuredClone = global.structuredClone || ((v) => JSON.parse(JSON.stringify(v)));
jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn(() => Promise.reject(new Error("offline"))) } }));
jest.mock("../../context/AuthContext", () => ({ API: "/api" }));
jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }));
// The UI Switch imports through a webpack-only "@/" alias.
jest.mock("../../components/ui/switch", () => ({ Switch: ({ checked, onCheckedChange, ...p }) => <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} {...p} /> }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const mount = async (el) => {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  return host;
};

test("Shadow page renders, logs a comparison with correct colour", async () => {
  const Page = require("../../pages/ShadowVerificationPage").default;
  const host = await mount(<Page />);
  expect(host.querySelector('[data-testid="shadow-page"]')).toBeTruthy();
  const set = (id, v) => { const el = host.querySelector(`[data-testid="${id}"]`); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
  await act(async () => { set("pressure-reference", "4500"); });
  const badge = host.querySelector('[data-testid="shadow-card-pressure"] [data-testid="delta-badge"]');
  expect(badge.dataset.status).toBe("green"); // 4472 vs 4500 = -0.62%
  await act(async () => { set("pressure-reference", "4000"); });
  expect(host.querySelector('[data-testid="shadow-card-pressure"] [data-testid="delta-badge"]').dataset.status).toBe("red");
  await act(async () => { host.querySelector('[data-testid="pressure-record"]').click(); });
  expect(host.querySelectorAll('[data-testid="variance-log"] tbody tr').length).toBe(1);
  expect(host.querySelector('[data-testid="variance-log"] [data-status="red"]')).toBeTruthy();
});

test("Executive dashboard renders offline", async () => {
  jest.mock("../../context/ActiveReelContext", () => ({ useActiveReel: () => ({ activeReel: null, currentDepth: 0 }) }));
  const Page = require("../../pages/ExecutiveDashboard").default;
  const host = await mount(<Page />);
  expect(host.textContent).toContain("Executive Dashboard");
});

test("ErrorBoundary isolates a throwing child", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  const Bomb = () => { throw new Error("bad input"); };
  const host = await mount(<ErrorBoundary name="t"><Bomb /></ErrorBoundary>);
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  expect(host.querySelector('[data-testid="error-boundary-fallback"]')).toBeTruthy();
});
