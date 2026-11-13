import {
  calculateBucklingThresholds,
  calculateFatemiSocieFatigue,
  cyclesToFailure,
  triaxialVonMises,
  vmEnvelope,
  updateChabocheBackstress,
} from "../ctPhysics";

describe("engineering model guardrails", () => {
  test("Dawson-Paslay thresholds are finite for deviated wells and reject invalid geometry", () => {
    const result = calculateBucklingThresholds({ E: 30e6, I: 0.1, w: 0.5, r: 10, thetaDeg: 30 });
    expect(result.fCritSin).toBeCloseTo(547.7226, 3);
    expect(result.fCritHel).toBeCloseTo(774.5967, 3);
    expect(calculateBucklingThresholds({ E: 30e6, I: 0.1, w: 0.5, r: 10, thetaDeg: 0 }).fCritSin).toBe(Infinity);
    expect(() => calculateBucklingThresholds({ E: 30e6, I: -1, w: 0.5, r: 10, thetaDeg: 30 })).toThrow(/BUCKLING_ERROR/);
  });

  test("Fatemi-Socie solve satisfies its strain-life equation and rejects missing material coefficients", () => {
    const input = {
      deltaGammaHalf: 0.004,
      sigmaNMax: 10,
      sigmaY: 100,
      k: 0.3,
      tauFPrime: 100,
      G: 10000,
      b: -0.1,
      gammaFPrime: 0.5,
      c: -0.5,
    };
    const result = calculateFatemiSocieFatigue(input);
    const reversals = 2 * result.cyclesToFailure;
    const strainLife = (input.tauFPrime / input.G) * reversals ** input.b +
      input.gammaFPrime * reversals ** input.c;
    expect(result.status).toBe("NOMINAL");
    expect(strainLife).toBeCloseTo(result.effectiveStrain, 8);
    expect(() => calculateFatemiSocieFatigue({ deltaGammaHalf: 0.01, sigmaY: 100 })).toThrow(/FATEMI_SOCIE_ERROR/);
  });

  test("Chaboche backstress update handles loading reversal and validates coefficients", () => {
    const result = updateChabocheBackstress({
      plasticStrainIncrement: 0.01,
      backstresses: [0, 20],
      C: [1000, 500],
      gamma: [10, 100],
    });
    expect(result.components[0]).toBeCloseTo(6.060606, 5);
    expect(result.components[1]).toBeCloseTo(11.666667, 5);
    const reversed = updateChabocheBackstress({
      plasticStrainIncrement: -0.01,
      backstresses: result.components,
      C: [1000, 500],
      gamma: [10, 100],
    });
    expect(reversed.backstress).toBeLessThan(result.backstress);
    expect(() => updateChabocheBackstress({ plasticStrainIncrement: 1, backstresses: [0], C: [1], gamma: [-1] })).toThrow(/CHABOCHE_ERROR/);
  });

  test("thick-wall stress calculation matches the Lamé inner-wall reference", () => {
    const result = triaxialVonMises({ OD: 2, WT: 0.2, p_i: 1000, p_o: 0, F_axial: 0, smys: 90000 });
    expect(result.sigma_h).toBeCloseTo(4555.5556, 3);
    expect(result.sigma_r).toBe(-1000);
    expect(result.safe_limit).toBe(72000);
    expect(result.utilization).toBeCloseTo(result.von_mises / 72000, 10);
  });
});

describe("numerical stability sweep", () => {
  const bad = [0, -1, NaN, Infinity, undefined, null, "x", 1e12];
  const allFinite = (o) => {
    if (o == null) return true;
    if (typeof o === "number") return Number.isFinite(o);
    if (Array.isArray(o)) return o.every(allFinite);
    if (typeof o === "object") return Object.values(o).every(allFinite);
    return true;
  };
  test("von Mises, envelope, cycles-to-failure never emit NaN/Infinity", () => {
    for (const a of bad) for (const b of bad) {
      expect(allFinite(triaxialVonMises({ OD: 2, WT: 0.175, p_i: a, F_axial: b, smys: 90000 }))).toBe(true);
      expect(allFinite(triaxialVonMises({ OD: a, WT: b, p_i: 1000, smys: 90000 }))).toBe(true);
      expect(allFinite(vmEnvelope({ OD: a, WT: b, smys: 90000 }))).toBe(true);
      expect(Number.isFinite(cyclesToFailure(a, b, 90000))).toBe(true);
    }
  });
});
