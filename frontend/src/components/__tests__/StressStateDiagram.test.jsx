import { getStressArrowData } from "../../lib/stressState";

describe("StressStateDiagram", () => {
  test("maps component signs and relative magnitudes for the 3D arrows", () => {
    const arrows = getStressArrowData({
      sigma_h: 1200,
      sigma_r: -600,
      sigma_a: 0,
    });

    expect(arrows.map(({ key, sign, magnitudeRatio }) => ({ key, sign, magnitudeRatio }))).toEqual([
      { key: "sigma_h", sign: 1, magnitudeRatio: 1 },
      { key: "sigma_r", sign: -1, magnitudeRatio: 0.5 },
      { key: "sigma_a", sign: 0, magnitudeRatio: 0 },
    ]);
  });

  test("does not invent arrows for missing or non-finite stress components", () => {
    expect(getStressArrowData({ sigma_h: NaN, sigma_r: -10 })).toMatchObject([
      { key: "sigma_r", sign: -1, magnitudeRatio: 1 },
    ]);
    expect(getStressArrowData(null)).toEqual([]);
  });
});
