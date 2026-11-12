/**
 * Aegis OS telemetry and engineering utility model.
 *
 * Includes field validation helpers for:
 * - fluid totalizer summation
 * - multi-encoder drift consensus detection
 * - Von Mises stress envelope evaluation
 * - historical sync / latency analysis
 */

const DEFAULT_FLUID_KEYS = ["acid", "frSlug", "mmfrSlugs", "gelPills", "waterFlush"];

export function normalizeFluidChannels(input = {}) {
  const { rates, volumes } = normalizeFluidValues(input);
  return {
    channels: Object.fromEntries(DEFAULT_FLUID_KEYS.map((key) => [key, { rate: rates[key], volume: volumes[key] }])),
    rates,
    volumes,
    qTotal: Object.values(rates).reduce((sum, val) => sum + val, 0),
    vTotal: Object.values(volumes).reduce((sum, val) => sum + val, 0),
  };
}

export function computeFluidTotals(fluidChannels = {}) {
  const { rates, volumes } = normalizeFluidValues(fluidChannels);
  return {
    fluidTotalizers: volumes,
    rates,
    volumes,
    qTotal: Object.values(rates).reduce((sum, val) => sum + val, 0),
    vTotal: Object.values(volumes).reduce((sum, val) => sum + val, 0),
  };
}

function normalizeFluidValues(input) {
  const source = input && typeof input === "object" ? input : {};
  const aliases = {
    acid: ["Acid"],
    frSlug: ["FR_Slug", "FR Slug"],
    mmfrSlugs: ["MMFR_Slugs", "MMFR Slugs"],
    gelPills: ["Gel_Pills", "Gel Pills"],
    waterFlush: ["Water / Flush", "Water_Flush"],
  };
  const rates = {};
  const volumes = {};
  for (const key of DEFAULT_FLUID_KEYS) {
    const channel = source[key] ?? aliases[key].map((alias) => source[alias]).find((value) => value != null) ??
      source[`${key}Rate`] ?? source[`${key}_rate`] ?? 0;
    const rate = channel && typeof channel === "object" ? channel.rate ?? 0 : channel;
    const volume = channel && typeof channel === "object"
      ? channel.volume ?? 0
      : source[`${key}Volume`] ?? source[`${key}_volume`] ?? 0;
    rates[key] = finiteFluidValue(rate, `${key} rate`);
    volumes[key] = finiteFluidValue(volume, `${key} volume`);
  }
  return { rates, volumes };
}

function finiteFluidValue(value, label) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${label} must be a finite, non-negative number`);
  }
  return number;
}

export function computeMultiEncoderConsensus(encoders = [], thresholdFt = 2.0) {
  if (!Number.isFinite(thresholdFt) || thresholdFt < 0) {
    throw new TypeError("thresholdFt must be a finite, non-negative number");
  }
  const list = Array.isArray(encoders) ? encoders : [];
  const normalized = list.map((entry) => {
    const raw = entry?.depthFt ?? entry?.depth_ft ?? entry?.value;
    const depthFt = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    return { name: entry?.name || entry?.id || "encoder", depthFt };
  });
  const valid = normalized.filter((entry) => Number.isFinite(entry.depthFt));

  const deltas = [];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i];
      const b = valid[j];
      const delta = Math.abs(a.depthFt - b.depthFt);
      deltas.push({
        names: [a.name, b.name],
        deltaFt: delta,
        thresholdFt,
      });
    }
  }

  const maxDeltaFt = deltas.reduce((max, item) => Math.max(max, item.deltaFt), 0);
  const insufficientData = valid.length < 2 || valid.length !== normalized.length;
  const warning = insufficientData || maxDeltaFt > thresholdFt;
  const depths = valid.map((entry) => entry.depthFt).sort((a, b) => a - b);
  const depthFt = depths.length
    ? depths.length % 2
      ? depths[(depths.length - 1) / 2]
      : (depths[depths.length / 2 - 1] + depths[depths.length / 2]) / 2
    : null;

  return {
    encoders: normalized,
    deltas,
    maxDeltaFt,
    depthFt,
    validEncoderCount: valid.length,
    thresholdFt,
    warning,
    status: insufficientData ? "insufficient-data" : warning ? "slippage-warning" : "consensus-ok",
  };
}

export function calculateDepthMotion(previousDepthFt, currentDepthFt, elapsedSeconds) {
  if ([previousDepthFt, currentDepthFt, elapsedSeconds].some((value) => value === null || value === undefined || value === "")) {
    return { depthFt: null, speedFtPerMin: null, direction: "unknown" };
  }
  const previous = Number(previousDepthFt);
  const current = Number(currentDepthFt);
  const elapsed = Number(elapsedSeconds);
  if (![previous, current, elapsed].every(Number.isFinite) || elapsed <= 0) {
    return { depthFt: Number.isFinite(current) ? current : null, speedFtPerMin: null, direction: "unknown" };
  }
  const delta = current - previous;
  return {
    depthFt: current,
    speedFtPerMin: (Math.abs(delta) / elapsed) * 60,
    direction: delta > 0 ? "RIH" : delta < 0 ? "POOH" : "stationary",
  };
}

export function computeVonMisesStress({ sigmaA = 0, sigmaR = 0, sigmaH = 0, smys = 0.8 }) {
  const axial = Number(sigmaA) || 0;
  const radial = Number(sigmaR) || 0;
  const hoop = Number(sigmaH) || 0;
  const limit = Number(smys) || 0.8;

  const vm = Math.sqrt(
    0.5 * (
      (axial - radial) ** 2 +
      (radial - hoop) ** 2 +
      (hoop - axial) ** 2
    )
  );

  const safeLimit = limit * 1.0;
  const yieldRatio = safeLimit === 0 ? 0 : vm / safeLimit;
  const withinSafeEnvelope = yieldRatio <= 0.8;

  return {
    sigmaA: axial,
    sigmaR: radial,
    sigmaH: hoop,
    vonMises: vm,
    safeLimit,
    yieldRatio,
    withinSafeEnvelope,
    status: withinSafeEnvelope ? "within-80-smys" : "exceeds-80-smys",
  };
}

export function evaluateHistoricalPayload(payload = {}, nowMs = Date.now()) {
  const timestampRaw = payload.timestamp ?? payload.timestampMs ?? payload.ts;
  const timestampMs = Number(timestampRaw) || 0;
  const now = Number(nowMs) || Date.now();
  const historicalSync = Boolean(payload.is_historical_sync ?? payload.isHistoricalSync ?? false);

  let latencyMs = 0;
  if (timestampMs > 0) {
    latencyMs = Math.max(0, now - timestampMs);
  }

  const stale = historicalSync || latencyMs > 5000;
  const status = stale ? "stale-or-historical" : "fresh";

  return {
    timestampMs,
    latencyMs,
    historicalSync,
    stale,
    status,
    isHistoricalSync: historicalSync,
  };
}
