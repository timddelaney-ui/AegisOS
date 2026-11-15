import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { useCachedApi } from "../useCachedApi";
jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../context/AuthContext", () => ({ API: "/api", useAuth: () => ({ user: { user_id: "test-user" } }) }));
jest.mock("../../lib/fieldStore", () => ({ getStateSync: () => null, setState: jest.fn() }));
global.IS_REACT_ACT_ENVIRONMENT = true;
test("late requests cannot replace a newly selected rig's current result", async () => {
  const pending = [];
  axios.get.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  let result;
  function Capture({ path }) { result = useCachedApi(path); return null; }
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<Capture path="/rig-a" />));
  await act(async () => root.render(<Capture path="/rig-b" />));
  await act(async () => pending[1]({ data: { rig: "b" } }));
  await act(async () => pending[0]({ data: { rig: "a" } }));
  expect(result.data).toEqual({ rig: "b" });
  await act(async () => root.unmount());
});
