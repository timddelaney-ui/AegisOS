import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import AuthCallback from "./AuthCallback";

const mockNavigate = jest.fn();
const mockLocation = { hash: "#auth_code=one-time-code" };

jest.mock("axios", () => ({ post: jest.fn() }));
jest.mock("react-router-dom", () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));
jest.mock("../context/AuthContext", () => ({
  API: "https://api.example.test/api",
  setSessionToken: jest.fn(),
  useAuth: () => ({ setUser: jest.fn() }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

test("keeps a failed sign-in exchange visible instead of immediately redirecting", async () => {
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.post.mockRejectedValueOnce({ response: { status: 401 } });
  const host = document.createElement("div");
  const root = createRoot(host);

  await act(async () => root.render(<AuthCallback />));

  expect(host.querySelector('[role="alert"]').textContent).toContain("Sign-in failed");
  expect(host.textContent).toContain("Check the backend deployment and Google sign-in configuration");
  expect(mockNavigate).not.toHaveBeenCalled();

  await act(async () => root.unmount());
  errorSpy.mockRestore();
});
