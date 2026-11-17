import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Login from "./Login";

jest.mock("../context/AuthContext", () => ({ API: "https://api.example.com/api" }));

describe("Google sign-in", () => {
  let container;
  let root;
  const originalLocation = window.location;
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    delete window.location;
    window.location = { href: "https://app.example.com/login", search: "" };
    global.fetch = jest.fn();
    jest.spyOn(console, "error").mockImplementation(() => {});
    act(() => root.render(<Login />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.location = originalLocation;
    global.fetch = originalFetch;
    delete global.IS_REACT_ACT_ENVIRONMENT;
    jest.restoreAllMocks();
  });

  const signIn = async () => {
    await act(async () => {
      container.querySelector("[data-testid='google-signin-btn']").click();
    });
  };

  test("starts Google OAuth using the shared API URL", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ provider: "google" }) });
    await signIn();
    expect(fetch).toHaveBeenCalledWith("https://api.example.com/api/auth/config");
    expect(window.location.href).toBe("https://api.example.com/api/auth/google/login");
  });

  test.each([
    ["network failure", () => Promise.reject(new TypeError("Failed to fetch")), "Cannot reach"],
    ["server failure", () => Promise.resolve({ ok: false, status: 503 }), "HTTP 503"],
    ["missing Google configuration", () => Promise.resolve({
      ok: true, json: async () => ({ provider: "emergent" }),
    }), "Google sign-in is not configured"],
  ])("keeps the user on login after %s instead of switching providers", async (_, response, message) => {
    fetch.mockImplementation(response);
    await signIn();
    expect(container.querySelector("[role='alert']").textContent).toContain(message);
    expect(window.location.href).toBe("https://app.example.com/login");
    expect(container.querySelector("[data-testid='google-signin-btn']").disabled).toBe(false);
  });

  test.each([
    ["state", "OAuth security state"],
    ["token", "token exchange"],
    ["email", "verified email"],
  ])("explains the Google callback %s failure", async (code, message) => {
    window.location.search = `?auth_error=${code}`;
    await act(async () => root.render(<Login />));
    expect(container.querySelector("[role='alert']").textContent).toContain(message);
  });
});
