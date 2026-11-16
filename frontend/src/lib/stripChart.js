export const PENS = [
  { key: "pInt", label: "Coil Pressure", dim: "pressure", color: "#FB923C" },
  { key: "pWh", label: "Wellhead Pressure", dim: "pressure", color: "#FACC15" },
  { key: "dp", label: "Differential Pressure", dim: "pressure", color: "#38BDF8" },
  { key: "weight", label: "Weight / Hookload", dim: "weight", color: "#4ADE80" },
];

export function windowSamples(samples, start, end) {
  const unique = new Map();
  for (const sample of samples) {
    if (Number.isFinite(sample.ts) && sample.ts >= start && sample.ts <= end) unique.set(sample.ts, sample);
  }
  return [...unique.values()].sort((a, b) => a.ts - b.ts);
}

// Engineering-scale bands avoid magnifying sensor noise with per-pen autoscaling.
export function chartDomains(samples) {
  const pressure = [0, 10000];
  const weight = [0, 100000];
  for (const sample of samples) {
    for (const pen of PENS) {
      const value = sample[pen.key];
      if (!Number.isFinite(value)) continue;
      const domain = pen.dim === "pressure" ? pressure : weight;
      const step = pen.dim === "pressure" ? 2000 : 20000;
      domain[0] = Math.min(domain[0], Math.floor(value / step) * step);
      domain[1] = Math.max(domain[1], Math.ceil(value / step) * step);
    }
  }
  return { pressure, weight };
}

export function traceSegments(samples, key, start, end, domain, width, height, maxGapMs = 30000) {
  const segments = [];
  let segment = null;
  let previousTime = null;
  for (const sample of samples) {
    const value = sample[key];
    if (!Number.isFinite(value)) {
      segment = null;
      previousTime = null;
      continue;
    }
    if (!segment || sample.ts - previousTime > maxGapMs) {
      segment = [];
      segments.push(segment);
    }
    segment.push({
      x: (sample.ts - start) / (end - start) * width,
      y: height - (value - domain[0]) / (domain[1] - domain[0]) * height,
    });
    previousTime = sample.ts;
  }
  return segments;
}

export function nearestSample(samples, time, maxDistanceMs = 30000) {
  let best = null;
  for (const sample of samples) {
    if (Math.abs(sample.ts - time) <= maxDistanceMs && (!best || Math.abs(sample.ts - time) < Math.abs(best.ts - time))) best = sample;
  }
  return best;
}
