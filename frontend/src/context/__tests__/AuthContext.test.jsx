import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { AuthProvider, useAuth } from "../AuthContext";
jest.mock("axios", () => ({ defaults: {}, get: jest.fn(), post: jest.fn() }));
global.IS_REACT_ACT_ENVIRONMENT = true;
let root, auth;
function Capture() { auth = useAuth(); return null; }
async function mount() {
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<AuthProvider><Capture /></AuthProvider>));
}
beforeEach(() => { localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); });
test("an offline restart uses only a previously verified workspace, never credentials", async () => {
  axios.get.mockResolvedValueOnce({ data: { user_id: "crew-test", name: "Test", role: "crew", email: "test@example.invalid", session_token: "not-cacheable" } });
  await mount();
  expect(localStorage.getItem("aegis_offline_workspace_v1")).not.toMatch(/email|session_token/);
  await act(async () => root.unmount());
  axios.get.mockRejectedValueOnce(new Error("Network unavailable"));
  await mount();
  expect(auth.user.user_id).toBe("crew-test");
  expect(auth.offlineWorkspace).toBe(true);
});
test("a confirmed authorization failure removes cached access instead of granting offline fallback", async () => {
  localStorage.setItem("aegis_offline_workspace_v1", JSON.stringify({ user_id: "old-user", role: "crew" }));
  axios.get.mockRejectedValueOnce({ response: { status: 401 } });
  await mount();
  expect(auth.user).toBeNull();
  expect(auth.offlineWorkspace).toBe(false);
  expect(localStorage.getItem("aegis_offline_workspace_v1")).toBeNull();
});
