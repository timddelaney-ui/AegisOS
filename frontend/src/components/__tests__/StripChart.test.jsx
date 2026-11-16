import React, { act } from "react";
import { createRoot } from "react-dom/client";
import StripChart from "../cockpit/StripChart";
import UnitSystemSwitcher from "../cockpit/UnitSystemSwitcher";
import { UnitProvider } from "../../context/UnitContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("chart draws labeled axes and switches readouts to metric without mutating telemetry", async () => {
  localStorage.clear();
  const ctx = Object.fromEntries([
    "setTransform", "fillRect", "beginPath", "moveTo", "lineTo", "stroke", "fillText",
    "save", "rect", "clip", "translate", "setLineDash", "arc", "fill", "restore",
  ].map((key) => [key, jest.fn()]));
  const getContext = jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const now = Date.now();
  const current = Object.freeze({ pInt: 5000, pWh: 6000, dp: -1000, weight: -300, depth: 1000 });
  const samples = Object.freeze([
    Object.freeze({ ...current, ts: now - 1000 }),
    Object.freeze({ ...current, ts: now }),
  ]);
  try {
    await act(async () => root.render(<UnitProvider><UnitSystemSwitcher /><StripChart samples={samples} version={1} current={current} /></UnitProvider>));
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.find((b) => b.textContent === "10m").getAttribute("aria-pressed")).toBe("true");
    expect(buttons.some((b) => b.textContent === "15m")).toBe(false);
    expect(host.querySelector('[data-testid="pen-toggle-pInt"]').textContent).toContain("5,000 psi");
    expect(ctx.fillText.mock.calls.some(([label]) => label === "Pressure (psi)")).toBe(true);
    expect(ctx.fillText.mock.calls.some(([label]) => label === "Weight (lbs)")).toBe(true);
    const select = host.querySelector("select");
    await act(async () => { select.value = "metric"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelector('[data-testid="pen-toggle-pInt"]').textContent).toContain("34.5 MPa");
    expect(host.querySelector('[data-testid="pen-toggle-dp"]').textContent).toContain("-6.9 MPa");
    expect(host.querySelector('[data-testid="pen-toggle-weight"]').textContent).toContain("-133.4 daN");
    expect(ctx.fillText.mock.calls.some(([label]) => label === "Pressure (MPa)")).toBe(true);
    expect(host.querySelector("canvas").getAttribute("aria-label")).toContain("10m window");
    await act(async () => { select.value = "imperial"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelector('[data-testid="pen-toggle-weight"]').textContent).toContain("-300 lbs");
    const toggle = host.querySelector('[data-testid="pen-toggle-weight"]');
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    getContext.mockRestore();
    localStorage.clear();
  }
});
