import {
  computeFluidTotals,
  computeMultiEncoderConsensus,
  calculateDepthMotion,
  computeVonMisesStress,
  evaluateHistoricalPayload,
} from "../aegisTelemetry";
import { fromDaqSample, SEED_TELEMETRY } from "../operatorConfig";

describe("Aegis OS telemetry and engineering model", () => {
  test("sums independently supplied rates and volumes across five fluid channels", () => {
    const totals = computeFluidTotals({
      acid: { rate: 12.5, volume: 125 },
      frSlug: { rate: 8.25, volume: 82.5 },
      mmfrSlugs: { rate: 6.75, volume: 67.5 },
      gelPills: { rate: 4.3, volume: 43 },
      waterFlush: { rate: 10.2, volume: 102 },
    });

    expect(totals.qTotal).toBeCloseTo(42.0, 5);
    expect(totals.vTotal).toBeCloseTo(420, 5);
    expect(totals.fluidTotalizers.acid).toBe(125);
  });

  test("normalizes the documented fluid labels and rate/volume field names", () => {
    const totals = computeFluidTotals({
      Acid: { rate: "1.5", volume: "10" },
      FR_Slug: { rate: 2, volume: 20 },
      "MMFR Slugs": { rate: 3, volume: 30 },
      "Gel Pills": { rate: 4, volume: 40 },
      "Water / Flush": { rate: 5, volume: 50 },
    });
    expect(totals.qTotal).toBe(15.5);
    expect(totals.vTotal).toBe(150);
  });

  test("rejects negative and non-finite fluid readings", () => {
    expect(() => computeFluidTotals({ acid: { rate: -1 } })).toThrow(/non-negative/);
    expect(() => computeFluidTotals({ acid: { volume: Infinity } })).toThrow(/finite/);
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

  test("does not claim encoder consensus when a counter is missing", () => {
    const result = computeMultiEncoderConsensus([
      { name: "traction wheel", depthFt: 100 },
      { name: "gooseneck", depthFt: null },
      { name: "levelwind", depthFt: 100.2 },
    ]);
    expect(result.warning).toBe(true);
    expect(result.status).toBe("insufficient-data");
    expect(result.depthFt).toBe(100.1);
  });

  test("calculates RIH and POOH depth speeds and binds DAQ pressure sources", () => {
    expect(calculateDepthMotion(100, 110, 30)).toMatchObject({ speedFtPerMin: 20, direction: "RIH" });
    expect(calculateDepthMotion(110, 100, 30)).toMatchObject({ speedFtPerMin: 20, direction: "POOH" });

    const mapped = fromDaqSample({ ...SEED_TELEMETRY, depth: 100, sampleTimestampMs: 1000 }, {
      encoder_1_depth_ft: 110,
      encoder_2_depth_ft: 110.2,
      encoder_3_depth_ft: 109.9,
      event_at: "1970-01-01T00:00:31.000Z",
      p_internal_psi: 5000,
      p_external_psi: 900,
      traction_pressure_psi: 1200,
    });
    expect(mapped.depth).toBe(110);
    expect(mapped.speedFtPerMin).toBeCloseTo(20);
    expect(mapped.direction).toBe("RIH");
    expect(mapped.encoderStatus).toBe("consensus-ok");
    expect(mapped.internalPress).toBe(5000);
    expect(mapped.annulusPress).toBe(900);
    expect(mapped.skatePressure).toBe(1200);
    expect(mapped.whp).toBe(SEED_TELEMETRY.whp);
    expect(mapped.netDeltaP).toBe(4100);
  });

  test("does not promote a single encoder over the independent DAQ depth", () => {
    const mapped = fromDaqSample(SEED_TELEMETRY, {
      depth_ft: 120,
      encoder_1_depth_ft: 999,
    });
    expect(mapped.depth).toBe(120);
    expect(mapped.encoderStatus).toBe("insufficient-data");
    expect(mapped.encoderWarning).toBe(true);
  });

  test("maps flattened EMQX snapshots into existing live pressure, depth and weight channels", () => {
    const mapped = fromDaqSample(SEED_TELEMETRY, {
      rig_id: "RIG1",
      ts: "2026-11-15T00:00:00Z",
      channels: {
        encoder_1_depth_ft: 1200,
        encoder_2_depth_ft: 1201,
        wellhead_pressure_psi: 3500,
        pipe_weight_lbs: 4200,
      },
      encoder_1_depth_ft: 1200,
      encoder_2_depth_ft: 1201,
      wellhead_pressure_psi: 3500,
      pipe_weight_lbs: 4200,
    });
    expect(mapped.depth).toBe(1200.5);
    expect(mapped.whp).toBe(3500);
    expect(mapped.weight).toBe(4200);
  });

  test("retains explicitly missing configured encoders for consensus warnings", () => {
    const mapped = fromDaqSample(SEED_TELEMETRY, {
      depth_ft: 100,
      encoder_1_depth_ft: 100,
      encoder_2_depth_ft: null,
      encoder_3_depth_ft: 100.2,
    });
    expect(mapped.encoderStatus).toBe("insufficient-data");
    expect(mapped.encoderWarning).toBe(true);
    expect(mapped.depth).toBeCloseTo(100.1);
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
