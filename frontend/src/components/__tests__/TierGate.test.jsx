import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TierProtectedRoute, UpgradeModal } from "../TierGate";

let mockTier;
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }));
jest.mock("../../context/TierContext", () => ({ useTier: () => mockTier }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("Pro users get a Fleet sales callout when opening live rig routes", async () => {
  mockTier = {
    canAccess: () => false,
    loaded: true,
    featureLabel: () => "Mission Control cockpit",
    promptUpgrade: jest.fn(),
    upgradeFor: "live_ops",
    dismissUpgrade: jest.fn(),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => root.render(
    <>
      <TierProtectedRoute feature="live_ops"><div>Live rig controls</div></TierProtectedRoute>
      <UpgradeModal />
    </>,
  ));

  expect(mockNavigate).toHaveBeenCalledWith("/hub", { replace: true });
  expect(mockTier.promptUpgrade).toHaveBeenCalledWith("live_ops");
  expect(host.textContent).toContain("Enterprise Fleet Feature — Contact Sales");
  expect(host.textContent).toContain("Live rig telemetry is not included in Pro.");
  expect(host.textContent).not.toContain("Live rig controls");

  await act(async () => root.unmount());
  host.remove();
});
