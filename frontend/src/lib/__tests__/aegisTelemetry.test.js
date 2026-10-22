import {
  computeFluidTotals,
  computeMultiEncoderConsensus,
  computeVonMisesStress,
  evaluateHistoricalPayload,
} from "../aegisTelemetry";

describe("Aegis OS telemetry and engineering model", () => {
  test("sums the five totalizer channels into combined fluid totals", () => {
    const totals = computeFluidTotals({
      acid: 12.5,
      frSlug: 8.25,
      mmfrSlugs: 6.75,
      gelPills: 4.3,
      waterFlush: 10.2,
    });

    expect(totals.qTotal).toBeCloseTo(42.0, 5);
    expect(totals.vTotal).toBeCloseTo(42.0, 5);
  });

  test("computes encoder drift consensus and raises slippage warnings when a delta exceeds 2.0 ft", () => {
    const result = computeMultiEncoderConsensus([
      { name: "Encoder 1", depthFt: 1200.6 },
      { name: "Encoder 2", depthFt: 1202.8 },
      { name: "Encoder 3", depthFt: 1200.3 },
    ], 2.0);

    expect(result.warning).toBe(true);
    expect(result.maxDeltaFt).toBeGreaterThan(2.0);
    expect(result.status).toBe("slippage-warning");
  });

  test("calculates Von Mises stress ratio against the API RP 5C7 80% SMYS envelope", () => {
    const result = computeVonMisesStress({
      sigmaA: 55000,
      sigmaR: 18000,
      sigmaH: 27000,
      smys: 60000,
    });

    expect(result.vonMises).toBeGreaterThan(0);
    expect(result.yieldRatio).toBeLessThan(1);
    expect(result.withinSafeEnvelope).toBe(true);
  });

  test("evaluates historical-sync latency and timestamp staleness correctly", () => {
    const now = 1_700_000_000_000;
    const fresh = evaluateHistoricalPayload({ timestamp: now - 1000 }, now);
    const historical = evaluateHistoricalPayload({ timestamp: now - 25000, is_historical_sync: true }, now);

    expect(fresh.stale).toBe(false);
    expect(fresh.latencyMs).toBe(1000);
    expect(historical.stale).toBe(true);
    expect(historical.isHistoricalSync).toBe(true);
  });
});
