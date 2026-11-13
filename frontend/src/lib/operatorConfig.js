// Operator screen config. All values are canonical IMPERIAL; UI converts via UnitContext.
import { calculateDepthMotion, computeMultiEncoderConsensus } from "./aegisTelemetry";

export const DEPTH_MIN_FT = 3281;
export const DEPTH_MAX_FT = 16404;

const PSI_PER_MPA = 145.037737797;
const LBS_PER_DAN = 2.24808943;
const FT_PER_M = 1 / 0.3048;

// Extra dims not in lib/units.js registry
export const EXTRA_DIMS = {
  slurry_rate: { imperial: ["bpm", (v) => v], metric: ["m³/min", (v) => v * 0.158987294928] },
  proppant: { imperial: ["PPA", (v) => v], metric: ["kg/m³", (v) => v * 119.826427317] },
  n2_rate: { imperial: ["SCFM", (v) => v], metric: ["m³/min", (v) => v / 35.3146667] },
  n2_vol: { imperial: ["SCF", (v) => v], metric: ["m³", (v) => v / 35.3146667] },
  torque: { imperial: ["ft·lbf", (v) => v], metric: ["N·m", (v) => v * 1.35581795] },
};
export const FIXED_DIMS = { pct: "%SMYS", deg: "°", mv: "mV", api: "API", volt: "V", g: "g" };

export const SEED_TELEMETRY = {
  depth: 14233, tvd: 7007, inclination: 89.9, dls: 0.305, drag: 13671, vonMises: 26.8,
  weight: 5535, internalPress: 5410, whp: 2828, netDeltaP: 2582, annulusPress: 827, skatePressure: 1100,
  speedFtPerMin: 0, direction: "stationary", encoderStatus: "not-configured", encoderWarning: false,
  treatingPress: 8122, slurryRate: 43.6, proppantConc: 3.9, slurryDensity: 10.01,
  n2Rate: 1066, n2Cum: 355476, n2Discharge: 5265, ccl: 112.4, gamma: 82.1, voltage: 535.9,
  toolTemp: 221.7, dhTension: 5888, dhIntPress: 8035, dhAnnPress: 7063, dhTemp: 208.0,
  vibration: 2.2, dhTorque: 270.7,
};

export const JOB_SETS = ["Pressures", "Frac / TP", "N2", "E-coil", "Smart tools"];

export const CHANNELS = [
  { key: "whp", group: "Pressures", title: "Wellhead Pressure", dim: "pressure", tag: "Pressure", warn: 6411, crit: 7208 },
  { key: "internalPress", group: "Pressures", title: "Internal Pressure", dim: "pressure", tag: "Pressure" },
  { key: "annulusPress", group: "Pressures", title: "Annulus Pressure", dim: "pressure", tag: "Pressure", warn: 10153, crit: 12328 },
  { key: "skatePressure", group: "Pressures", title: "Skate Clamping Pressure", dim: "pressure", tag: "Pressure" },
  { key: "treatingPress", group: "Pressures", title: "Treating Pressure", dim: "pressure", tag: "Frac", warn: 10443, crit: 13053 },
  { key: "slurryRate", group: "Frac / TP", title: "Slurry Rate", dim: "slurry_rate", tag: "Frac", warn: 59.8, crit: 69.2 },
  { key: "proppantConc", group: "Frac / TP", title: "Proppant Concentration", dim: "proppant", tag: "Frac", warn: 7.51, crit: 9.18 },
  { key: "slurryDensity", group: "Frac / TP", title: "Slurry Density", dim: "density", tag: "Frac", warn: 12.1, crit: 12.94 },
  { key: "n2Rate", group: "N2", title: "N2 Rate", dim: "n2_rate", tag: "N2", warn: 1695, crit: 1978 },
  { key: "n2Cum", group: "N2", title: "N2 Cumulative", dim: "n2_vol", tag: "N2", warn: 1483217, crit: 1695105 },
  { key: "n2Discharge", group: "N2", title: "N2 Discharge Pressure", dim: "pressure", tag: "N2", warn: 8122, crit: 9137 },
  { key: "ccl", group: "E-coil", title: "CCL Signal", dim: "mv", tag: "E-coil", waveform: true },
  { key: "gamma", group: "E-coil", title: "Gamma Ray", dim: "api", tag: "E-coil" },
  { key: "voltage", group: "E-coil", title: "Conductor Voltage", dim: "volt", tag: "E-coil", warn: 800, crit: 950 },
  { key: "toolTemp", group: "E-coil", title: "Tool Temperature", dim: "temp", tag: "E-coil", warn: 248, crit: 284 },
  { key: "dhTension", group: "Smart tools", title: "Downhole Tension", dim: "weight", tag: "Smart tools", warn: 16861, crit: 19109 },
  { key: "dhIntPress", group: "Smart tools", title: "Downhole Int. Pressure", dim: "pressure", tag: "Smart tools", warn: 10153, crit: 12328 },
  { key: "dhAnnPress", group: "Smart tools", title: "Downhole Ann. Pressure", dim: "pressure", tag: "Smart tools", warn: 10153, crit: 12328 },
  { key: "dhTemp", group: "Smart tools", title: "Downhole Temperature", dim: "temp", tag: "Smart tools", warn: 248, crit: 284 },
  { key: "vibration", group: "Smart tools", title: "Vibration", dim: "g", tag: "Smart tools", warn: 6, crit: 8, waveform: true },
  { key: "dhTorque", group: "Smart tools", title: "Downhole Torque", dim: "torque", tag: "Smart tools", warn: 1328, crit: 1696 },
];

export const PLUGS = [
  { id: "P1", type: "Frac plug", start: 11942, end: 11946 },
  { id: "P2", type: "Frac plug", start: 12336, end: 12340 },
  { id: "P3", type: "Frac plug", start: 12730, end: 12734 },
  { id: "P4", type: "Frac plug", start: 13123, end: 13127 },
];

export const DEFAULT_CREW = [
  { id: 1, name: "Lead Specialist", designation: "Coiled Tubing Specialist", hourlyRate: 45, hoursLogged: 12 },
  { id: 2, name: "Rig Operator", designation: "Injector / Reel Operator", hourlyRate: 32, hoursLogged: 12 },
  { id: 3, name: "Field Specialist Hand", designation: "Field Hand 1", hourlyRate: 15, hoursLogged: 12 },
  { id: 4, name: "Field Trainee", designation: "Field Hand 2", hourlyRate: 13, hoursLogged: 12 },
];

// Bounded random walk around seed values so every channel trends live
const DRIFT_KEYS = { annulusPress: 0.004, slurryRate: 0.006, proppantConc: 0.008, slurryDensity: 0.002, n2Rate: 0.005,
  n2Discharge: 0.004, gamma: 0.01, voltage: 0.003, toolTemp: 0.002, dhTension: 0.004, dhIntPress: 0.003, dhAnnPress: 0.003, dhTemp: 0.002 };
function drift(prev) {
  const out = {};
  Object.entries(DRIFT_KEYS).forEach(([k, a]) => {
    const seed = SEED_TELEMETRY[k];
    const next = prev[k] + (Math.random() - 0.5) * 2 * a * seed;
    out[k] = Math.min(seed * 1.12, Math.max(seed * 0.88, next));
  });
  out.n2Cum = prev.n2Cum + prev.n2Rate / 300;
  return out;
}

// One sim tick: physics authored in SI (as designed), stored in imperial.
export function simTick(prev, speed, minFt = DEPTH_MIN_FT, maxFt = DEPTH_MAX_FT) {
  const stepFt = 0.33 * speed;
  const depth = prev.depth >= maxFt || prev.depth < minFt ? minFt : +Math.min(prev.depth + stepFt, maxFt).toFixed(1);
  const dm = depth / FT_PER_M;
  const whp = (19.2 + Math.sin(dm / 10) * 0.8) * PSI_PER_MPA;
  const internalPress = (37.3 + Math.sin(dm / 14) * 1.2) * PSI_PER_MPA;
  const drifted = drift(prev);
  return {
    ...prev,
    depth,
    tvd: Math.min(depth, 7007),
    whp,
    internalPress,
    annulusPress: drifted.annulusPress,
    netDeltaP: internalPress - drifted.annulusPress,
    treatingPress: (55.5 + Math.cos(dm / 8) * 1.5) * PSI_PER_MPA,
    ccl: Math.sin(Date.now() / 120) * 85,
    weight: (2400 + dm * 0.15 + (Math.random() - 0.5) * 40) * LBS_PER_DAN,
    dhTorque: (350 + dm * 0.02 + (Math.random() - 0.5) * 15) / 1.35581795,
    vonMises: Math.min(25 + dm / 200 + Math.random() * 0.4, 78),
    vibration: 2.2 + (Math.random() - 0.5) * 0.6,
    ...drifted,
  };
}

// Map a /api/liveops/stream sample onto the operator telemetry shape
export function fromDaqSample(prev, s) {
  const whp = s.whp_psi ?? s.wellhead_pressure_psi ?? prev.whp;
  const internalPress = s.p_internal_psi ?? prev.internalPress;
  const annulusPress = s.p_external_psi ?? s.annulus_pressure_psi ?? prev.annulusPress;
  const encoders = [
    ["traction wheel", "encoder_1_depth_ft", "traction_wheel_depth_ft"],
    ["gooseneck", "encoder_2_depth_ft", "gooseneck_depth_ft"],
    ["levelwind", "encoder_3_depth_ft", "levelwind_depth_ft"],
  ].flatMap(([name, primary, alias]) => {
    if (!Object.prototype.hasOwnProperty.call(s, primary) && !Object.prototype.hasOwnProperty.call(s, alias)) return [];
    return [{ name, value: Object.prototype.hasOwnProperty.call(s, primary) ? s[primary] : s[alias] }];
  });
  const encoderConsensus = encoders.length
    ? computeMultiEncoderConsensus(encoders.map(({ name, value }) => ({ name, depthFt: value })))
    : null;
  const encoderDepth = encoderConsensus?.validEncoderCount >= 2 ? encoderConsensus.depthFt : null;
  const depth = encoderDepth ?? s.depth_ft ?? prev.depth;
  const timestampMs = Date.parse(s.event_at ?? s.ts ?? s.created_at ?? "");
  const elapsedSeconds = Number.isFinite(timestampMs) && Number.isFinite(prev.sampleTimestampMs)
    ? (timestampMs - prev.sampleTimestampMs) / 1000
    : null;
  const motion = calculateDepthMotion(prev.depth, depth, elapsedSeconds);
  return {
    ...prev,
    ...s,
    depth: depth ?? prev.depth,
    speedFtPerMin: motion.speedFtPerMin ?? prev.speedFtPerMin,
    direction: motion.direction === "unknown" ? prev.direction : motion.direction,
    encoderStatus: encoderConsensus?.status ?? "not-configured",
    encoderWarning: encoderConsensus?.warning ?? false,
    encoderMaxDeltaFt: encoderConsensus?.maxDeltaFt ?? null,
    sampleTimestampMs: Number.isFinite(timestampMs) ? timestampMs : prev.sampleTimestampMs,
    weight: s.weight_lb ?? prev.weight,
    internalPress,
    whp,
    annulusPress,
    skatePressure: s.traction_pressure_psi ?? s.p_skate_psi ?? prev.skatePressure,
    netDeltaP: internalPress - annulusPress,
    treatingPress: s.pressure_psi ?? prev.treatingPress,
    vonMises: s.vm_utilization != null ? s.vm_utilization * 100 : prev.vonMises,
  };
}
