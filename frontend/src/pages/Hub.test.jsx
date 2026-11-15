import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server.node";
import Hub, { HubModules } from "./Hub";
import { useAuth } from "../context/AuthContext";
import { useTier } from "../context/TierContext";

jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }));
jest.mock("../context/AuthContext", () => ({
  API: "https://api.example.com/api",
  useAuth: jest.fn(),
  isProUser: (user) => user?.subscription_tier === "enterprise",
}));
jest.mock("../context/TierContext", () => ({
  useTier: jest.fn(),
}));
jest.mock("../components/ExcelHeader", () => () => null);
jest.mock("../components/RigSelector", () => () => null);
jest.mock("../components/AIPanel", () => () => null);
jest.mock("../components/HubCustomize", () => ({ HubCustomizeButton: () => null }));
jest.mock("../hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({ ref: null, progress: 0, refreshing: false }),
  PullIndicator: () => null,
}));

beforeEach(() => {
  useTier.mockReturnValue({ canAccess: () => true, hidesCompletely: () => false });
});

test.each([
  ["personal", "crew"],
  ["enterprise", "crew"],
  ["enterprise", "ops_manager"],
])("renders Hub for the %s tier and %s role without losing tools", (tier, role) => {
  useAuth.mockReturnValue({
    user: { name: "Test user", role, subscription_tier: tier, effective_plan: tier === "personal" ? "workbook_pro" : "aegis_fleet" },
  });

  const html = renderToString(<Hub />);
  expect(html).toContain('data-testid="hub-tiles-grid"');
  expect(html).toContain('data-testid="hub-schedule-tile"');
  const tiles = [...html.matchAll(/data-tile-id="([^"]+)"/g)].map((match) => match[1]);
  const expected = [
    "live-ops", "daq", "security", "ctd-calculator", "reels", "stress", "fatigue", "wellbore",
    "certs", "tasks", "parts-orders", "timecards", "documents", "erp-template", "crew-contacts",
    "equipment", "schedule", "treatment", "emergency", "training", "redeem", "feedback",
  ];
  if (role === "ops_manager") expected.push("crew-admin");
  // Reel Track, Manager Mode and Rig Telemetry tiles require Aegis Fleet.
  const fleetOnly = ["live-ops", "daq", "reels", "fatigue", "crew-admin"];
  const visible = tier === "personal" ? expected.filter((id) => !fleetOnly.includes(id)) : expected;
  expect(tiles.sort()).toEqual(visible.sort());
  if (tier === "personal") {
    expect(html).toContain("Cheaper than a coffee");
  } else {
    expect(html).not.toContain("Cheaper than a coffee");
  }
});

describe("Hub tool navigation", () => {
  let container;
  let root;

  const Tile = ({ tileId, title }) => <button data-tile-id={tileId}>{title}</button>;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(
      <HubModules>
        <Tile tileId="live-ops" title="Live Ops" />
        <Tile tileId="stress" title="Triaxial stress" />
        <Tile tileId="schedule" title="Crew Schedule" />
        <Tile tileId="feedback" title="Send Feedback" tilePrefs={{ hidden: new Set(["feedback"]) }} />
      </HubModules>
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  const search = (value) => {
    const input = container.querySelector("input[type='search']");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  test("opens operations initially and expands engineering without losing tools", () => {
    expect(container.querySelector("#hub-group-operations").hidden).toBe(false);
    expect(container.querySelector("#hub-group-engineering").hidden).toBe(true);
    act(() => container.querySelector("[aria-controls='hub-group-engineering']").click());
    expect(container.querySelector("#hub-group-engineering").hidden).toBe(false);
    expect(container.querySelectorAll("[data-tile-id]")).toHaveLength(3);
  });

  test("search finds collapsed tools, handles no matches, and clearing restores the groups", () => {
    search("  STRESS  ");
    expect(container.querySelectorAll("[data-tile-id]")).toHaveLength(1);
    expect(container.querySelector("[data-tile-id]").textContent).toBe("Triaxial stress");
    search("unknown tool");
    expect(container.querySelector("[role='status']").textContent).toContain("No tools match");
    search("");
    expect(container.querySelector("#hub-group-operations")).not.toBeNull();
    expect(container.querySelectorAll("[data-tile-id]")).toHaveLength(3);
  });

  test("all tools shows the full set and still respects customized visibility", () => {
    act(() => container.querySelector("[aria-pressed]").click());
    expect(container.querySelector("[data-testid='hub-tool-results']")).not.toBeNull();
    expect(container.querySelectorAll("[data-tile-id]")).toHaveLength(3);
    expect(container.querySelector("[data-tile-id='feedback']")).toBeNull();
  });

  test("search does not expose guest-blocked or completely tier-hidden tools", () => {
    useTier.mockReturnValue({ canAccess: () => false, hidesCompletely: () => true });
    act(() => root.render(
      <HubModules>
        <Tile tileId="live-ops" title="Live Ops" />
        <Tile tileId="schedule" title="Crew Schedule" guestBlocked />
        <Tile tileId="feedback" title="Send Feedback" />
      </HubModules>
    ));
    search("crew");
    expect(container.querySelectorAll("[data-tile-id]")).toHaveLength(0);
    search("live");
    expect(container.querySelectorAll("[data-tile-id]")).toHaveLength(0);
    search("feedback");
    expect(container.querySelectorAll("[data-tile-id]")).toHaveLength(1);
  });
});
