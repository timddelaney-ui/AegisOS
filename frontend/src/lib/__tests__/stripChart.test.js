import { chartDomains, nearestSample, traceSegments, windowSamples } from "../stripChart";
import { WINDOWS } from "../cockpitTelemetry";

test("the short history window is exactly ten minutes", () => {
  expect(WINDOWS["10m"]).toBe(600000);
  expect(WINDOWS["15m"]).toBeUndefined();
});

test("pressure pens share a stable engineering range rather than exaggerating noise", () => {
  const baseline = [{ pInt: 5000, pWh: 3000, dp: 2000, weight: 48000 }];
  const noisy = [...baseline, { pInt: 5001, pWh: 2999, dp: 2002, weight: 48001 }];
  expect(chartDomains(baseline)).toEqual(chartDomains(noisy));
  expect(chartDomains(noisy)).toEqual({ pressure: [0, 10000], weight: [0, 100000] });
  const coil = traceSegments([{ ts: 0, pInt: 5000 }], "pInt", 0, 1000, [0, 10000], 100, 100);
  const wh = traceSegments([{ ts: 0, pWh: 3000 }], "pWh", 0, 1000, [0, 10000], 100, 100);
  expect(coil[0][0].y).toBe(50);
  expect(wh[0][0].y).toBe(70);
});

test("ranges include negative differential pressure, compression, and overrange readings", () => {
  expect(chartDomains([{ pInt: 11800, dp: -600, weight: -25000 }])).toEqual({
    pressure: [-2000, 12000], weight: [-40000, 100000],
  });
});

test("windowed samples are chronological, deduplicated and exclude stale/future timestamps", () => {
  expect(windowSamples([
    { ts: 200, pInt: 2 }, { ts: 50 }, { ts: 100 }, { ts: 200, pInt: 3 },
    { ts: 400 }, { ts: NaN },
  ], 100, 300)).toEqual([{ ts: 100 }, { ts: 200, pInt: 3 }]);
});

test("missing channels and satellite gaps break traces instead of drawing false ramps", () => {
  const samples = [
    { ts: 0, weight: 0 }, { ts: 1000, weight: 10 }, { ts: 2000, weight: null },
    { ts: 3000, weight: -10 }, { ts: 50000, weight: 5 },
  ];
  const segments = traceSegments(samples, "weight", 0, 100000, [-10, 10], 100, 100);
  expect(segments.map((s) => s.length)).toEqual([2, 1, 1]);
  expect(segments[1][0]).toEqual({ x: 3, y: 100 });
  expect(nearestSample(samples, 99000)).toBeNull();
  expect(nearestSample(samples, 50500)).toBe(samples[4]);
});
