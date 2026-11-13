import React, { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@react-three/fiber", () => ({ Canvas: () => null }));
jest.mock("@react-three/drei", () => ({ OrbitControls: () => null, Line: () => null }));
jest.mock("../StressStateDiagram", () => ({ StressElement: () => null }));
jest.mock("../../lib/stressState", () => ({ getStressArrowData: jest.fn(() => []) }));

import { getStressArrowData } from "../../lib/stressState";
import CTSegmentStressWorkbench from "../CTSegmentStressWorkbench";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CTSegmentStressWorkbench", () => {
  test("shows the CT90 benchmark readouts by default and reacts to sliders", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<CTSegmentStressWorkbench />));

    expect(host.textContent).toContain("Coiled Tubing Segment Model");
    expect(host.textContent).toContain("Multiaxial Stress State (3D Projection)");
    const kpis = host.querySelector("[data-testid=ct-segment-kpis]").textContent;
    ["428.0 MPa", "414.2 MPa", "421.3 MPa", "67.9 %"].forEach((v) => expect(kpis).toContain(v));
    expect(host.querySelector("[data-testid=ct-segment-breakdown]").textContent).toContain("± 211.7 MPa");
    expect(getStressArrowData.mock.calls.at(-1)[0].sigma_r).toBe(0);

    const slider = host.querySelector("[data-testid=slider-pressure_mpa]");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    act(() => {
      setter.call(slider, "0");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid=ct-segment-kpis]").textContent).toContain("Hoop Stress0.0 MPa");
    act(() => root.unmount());
    host.remove();
  });
});
