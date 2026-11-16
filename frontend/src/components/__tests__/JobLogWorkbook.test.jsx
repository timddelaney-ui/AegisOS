import React, { act } from "react";
import { createRoot } from "react-dom/client";
import JobLogWorkbook from "../JobLogWorkbook";

jest.mock("axios", () => ({ post: jest.fn(() => Promise.reject({ response: { status: 404 } })), get: jest.fn(() => Promise.resolve({ data: {} })) }));
jest.mock("sonner", () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API: "/api", useAuth: () => ({ user: { name: "Op" } }) }));
jest.mock("../../utils/offlineQueue", () => ({ enqueue: jest.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const signals = { depth: 1000, pInt: 500, pWh: 900, weight: -250, pump: 2, direction: "RIH", telemetry: {} };

let root; let host;
beforeEach(async () => {
  localStorage.clear();
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<JobLogWorkbook signals={signals} />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const click = async (text) => { const b = [...host.querySelectorAll("button")].find((x) => x.textContent === text); await act(async () => { b.click(); }); };
const cell = (label) => host.querySelector(`[aria-label="${label}"]`);
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const key = async (el, k) => { await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); }); };

test("stamp inserts prefilled row with negative diff and weight", async () => {
  await click("Stamp Live Telemetry");
  expect(cell("Diff Press row 1").value).toBe("-400");
  expect(cell("Weight row 1").value).toBe("-250");
});

test("numeric cells reject letters, accept negatives; Enter/Arrow navigate", async () => {
  await click("+ Add Row");
  await click("+ Add Row");
  const w = cell("Weight row 1");
  await setValue(w, "-12.5");
  expect(w.value).toBe("-12.5");
  await setValue(w, "abc");
  expect(w.value).toBe("-12.5");
  w.focus();
  await key(w, "Enter");
  expect(document.activeElement).toBe(cell("Weight row 2"));
  await key(document.activeElement, "ArrowUp");
  expect(document.activeElement).toBe(w);
});
