import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { toast } from "sonner";
import NotificationCenter from "../NotificationCenter";

jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("sonner", () => ({ toast: jest.fn() }));
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/job" }),
}));
jest.mock("../../context/AuthContext", () => ({
  API: "/api",
  useAuth: () => ({ user: mockUser }),
}));
jest.mock("../../context/RigContext", () => ({
  useRig: () => ({ rigId: "RIG1" }),
  rigLabel: () => "Rig 1",
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockNavigate = jest.fn();
const mockUser = { user_id: "crew-1" };
const validDigest = () => ({
  chat: { count: 0, latest: [] },
  tasks: { count: 0, latest: [] },
  treatment: { count: 0, latest: [], treatment_name: null },
});
let host;
let root;
let warning;

beforeEach(() => {
  jest.useFakeTimers();
  axios.get.mockReset();
  toast.mockClear();
  localStorage.clear();
  warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  warning.mockRestore();
  jest.useRealTimers();
});

test.each([
  null,
  "<!doctype html><html></html>",
  {},
  { ...validDigest(), tasks: { count: 1, latest: null } },
  { ...validDigest(), chat: { count: "1", latest: [] } },
  { ...validDigest(), treatment: { count: 1, latest: [null] } },
])("rejects malformed notification responses without crashing the workspace: %p", async (data) => {
  axios.get.mockResolvedValue({ data });
  await act(async () => root.render(<><p>Job workspace</p><NotificationCenter /></>));

  expect(host.textContent).toContain("Job workspace");
  expect(host.querySelector('[role="status"]').textContent).toContain("Crew alerts are unavailable");
  expect(warning).toHaveBeenCalledWith("[Notifications] digest unavailable", "Invalid notification digest response");
  expect(toast).not.toHaveBeenCalled();
});

test("retries a failed request and resumes crew notifications after recovery", async () => {
  const data = validDigest();
  data.chat = { count: 1, latest: [{ message_id: "message-1", sender_name: "Crew", text: "Shift update" }] };
  axios.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data });
  await act(async () => root.render(<NotificationCenter />));
  expect(host.querySelector('[role="status"]')).not.toBeNull();

  await act(async () => jest.advanceTimersByTime(15000));
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(toast).toHaveBeenCalledWith("Crew · Rig 1", expect.objectContaining({ description: "Shift update" }));

  await act(async () => jest.advanceTimersByTime(15000));
  expect(toast).toHaveBeenCalledTimes(1);
});
