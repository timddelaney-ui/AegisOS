import React from "react";
import { renderToString } from "react-dom/server";
import Hub from "./Hub";
import { useAuth } from "../context/AuthContext";

jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }));
jest.mock("../context/AuthContext", () => ({
  API: "https://api.example.com/api",
  useAuth: jest.fn(),
  isProUser: (user) => user?.subscription_tier === "enterprise",
}));
jest.mock("../context/TierContext", () => ({
  useTier: () => ({ canAccess: () => true, hidesCompletely: () => false }),
}));
jest.mock("../components/ExcelHeader", () => () => null);
jest.mock("../components/RigSelector", () => () => null);
jest.mock("../components/AIPanel", () => () => null);
jest.mock("../components/HubCustomize", () => ({ HubCustomizeButton: () => null }));
jest.mock("../hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({ ref: null, progress: 0, refreshing: false }),
  PullIndicator: () => null,
}));

test.each(["personal", "enterprise"])("renders Hub for the %s tier without crashing", (tier) => {
  useAuth.mockReturnValue({
    user: { name: "Test user", role: "crew", subscription_tier: tier },
  });

  const html = renderToString(<Hub />);
  expect(html).toContain('data-testid="hub-tiles-grid"');
  expect(html).toContain('data-testid="hub-schedule-tile"');
  if (tier === "personal") {
    expect(html).toContain("Cheaper than a coffee");
  } else {
    expect(html).not.toContain("Cheaper than a coffee");
  }
});
