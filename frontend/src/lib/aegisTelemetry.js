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
export const TELEMETRY_POLL_INTERVAL_MS = 2000;
export const TELEMETRY_STALE_AFTER_MS = 5000;

const PRIMARY_LIVE_CHANNELS = ["depth_ft", "weight_lb", "pressure_psi"];
const LIVE_SAMPLE_CHANNELS = [
  ...PRIMARY_LIVE_CHANNELS,
  "traction_pressure_psi",
  "p_internal_psi",
  "p_external_psi",
  "axial_force_lbf",
  "vm_utilization",
  "fatigue_worst",
];

export function assessLiveTelemetrySample(sample, nowMs = Date.now(), pollSucceeded = true) {
  if (!pollSucceeded) return { state: "SIM_FALLBACK", reason: "upstream-outage", missingChannels: [] };
  if (!sample) return { state: "SIM_FALLBACK", reason: "missing-sample", missingChannels: [] };
  if (typeof sample !== "object" || Array.isArray(sample)) {
    return { state: "SIM_FALLBACK", reason: "malformed-payload", missingChannels: [] };
  }

  const timestampMs = Date.parse(sample.created_at);
  if (!Number.isFinite(timestampMs)) {
    return { state: "SIM_FALLBACK", reason: "malformed-payload", missingChannels: [] };
  }

  const providedChannels = LIVE_SAMPLE_CHANNELS.filter((channel) => sample[channel] != null);
  if (providedChannels.some((channel) => typeof sample[channel] !== "number" || !Number.isFinite(sample[channel]))) {
    return { state: "SIM_FALLBACK", reason: "malformed-payload", missingChannels: [] };
  }

  const missingChannels = PRIMARY_LIVE_CHANNELS.filter((channel) => !Number.isFinite(sample[channel]));
  if (missingChannels.length === PRIMARY_LIVE_CHANNELS.length) {
    return { state: "SIM_FALLBACK", reason: "missing-channels", missingChannels };
  }

  const ageMs = Number(nowMs) - timestampMs;
  if (sample.is_historical_sync || ageMs > TELEMETRY_STALE_AFTER_MS) {
    return { state: "STALE", reason: "delayed-sample", ageMs, missingChannels };
  }
  if (ageMs < -TELEMETRY_STALE_AFTER_MS) {
    return { state: "SIM_FALLBACK", reason: "malformed-payload", missingChannels };
  }

  return { state: "LIVE", reason: null, ageMs: Math.max(0, ageMs), missingChannels };
}

export function normalizeFluidChannels(input = {}) {
  const values = {
    acid: Number(input.acid ?? input.Acid ?? 0),
    frSlug: Number(input.frSlug ?? input.FR_Slug ?? 0),
    mmfrSlugs: Number(input.mmfrSlugs ?? input.MMFR_Slugs ?? 0),
    gelPills: Number(input.gelPills ?? input.Gel_Pills ?? 0),
    waterFlush: Number(input.waterFlush ?? input["Water / Flush"] ?? 0),
  };

  const rate = Object.values(values).reduce((sum, val) => sum + (Number.isFinite(val) ? val : 0), 0);
  return {
    channels: values,
    rates: values,
    qTotal: rate,
    vTotal: rate,
  };
}

export function computeFluidTotals(fluidChannels = {}) {
  const source = fluidChannels && typeof fluidChannels === "object" ? fluidChannels : {};
  const totals = {};

  for (const key of DEFAULT_FLUID_KEYS) {
    totals[key] = Number(source[key] ?? source[key.toLowerCase()] ?? 0);
  }

  const qTotal = DEFAULT_FLUID_KEYS.reduce((sum, key) => sum + (Number.isFinite(totals[key]) ? totals[key] : 0), 0);
  const vTotal = qTotal;

  return {
    fluidTotalizers: totals,
    qTotal,
    vTotal,
  };
}

export function computeMultiEncoderConsensus(encoders = [], thresholdFt = 2.0) {
  const list = Array.isArray(encoders) ? encoders : [];
  const normalized = list.map((entry) => ({
    name: entry.name || entry.id || "encoder",
    depthFt: Number(entry.depthFt ?? entry.depth_ft ?? entry.value ?? 0),
  }));

  const deltas = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      const delta = Math.abs(a.depthFt - b.depthFt);
      deltas.push({
        names: [a.name, b.name],
        deltaFt: delta,
        thresholdFt,
      });
    }
  }

  const maxDeltaFt = deltas.reduce((max, item) => Math.max(max, item.deltaFt), 0);
  const warning = maxDeltaFt > thresholdFt;

  return {
    encoders: normalized,
    deltas,
    maxDeltaFt,
    thresholdFt,
    warning,
    status: warning ? "slippage-warning" : "consensus-ok",
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

  const stale = historicalSync || latencyMs > TELEMETRY_STALE_AFTER_MS;
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
