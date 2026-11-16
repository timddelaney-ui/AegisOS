import { injectorDirection, diffPressure, encoderConsensus, statusFor, signedFixed, estimateFatigueSections } from "../cockpitTelemetry";

test("injector direction", () => {
  expect(injectorDirection(30, 0)).toBe("RIH");
  expect(injectorDirection(-30, null)).toBe("POOH");
  expect(injectorDirection(0, -1)).toBe("POOH");
  expect(injectorDirection(0, 0)).toBe("STOPPED");
});

test("diff pressure supports negatives and missing data", () => {
  expect(diffPressure(1000, 1500)).toBe(-500);
  expect(diffPressure(null, 1500)).toBeNull();
});

test("encoder consensus warns only above 2.0 ft", () => {
  expect(encoderConsensus([100, 101, 101.5]).mismatch).toBe(false);
  expect(encoderConsensus([100, 101, 102.5]).mismatch).toBe(true);
  expect(encoderConsensus([100, null, null]).mismatch).toBe(false);
});

test("status thresholds", () => {
  expect(statusFor(50, { warn: 100, crit: 200 })).toBe("normal");
  expect(statusFor(-150, { warn: 100, crit: 200 })).toBe("warning");
  expect(statusFor(250, { warn: 100, crit: 200 })).toBe("alarm");
  expect(statusFor(-250, { warn: 100, crit: 200, signed: true })).toBe("normal");
});

test("signedFixed keeps negative sign", () => {
  expect(signedFixed(-1234.4)).toBe("-1234");
  expect(signedFixed(null)).toBe("—");
});

test("fatigue estimate yields three sections", () => {
  const s = estimateFatigueSections({ lengthFt: 10000, cyclesBySection: { top: 10 } });
  expect(s).toHaveLength(3);
  expect(s[0].cumulative_damage_pct).toBeGreaterThan(0);
  expect(s[2].governing_depth_ft).toBeGreaterThan(s[0].governing_depth_ft);
});
