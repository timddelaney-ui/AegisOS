import { computeMultiEncoderConsensus } from "./aegisTelemetry";
import { cyclesToFailure, damagePerCycleScaled } from "./ctPhysics";

export const ENCODER_THRESHOLD_FT = 2.0;
export const ENCODER_LABELS = ["Enc 1 Traction", "Enc 2 Gooseneck", "Enc 3 Levelwind"];

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

// RIH when speed or depth delta is positive; the depth delta wins when speed is unsigned.
export function injectorDirection(speedFtMin, depthDeltaFt, deadband = 0.05) {
  const speed = num(speedFtMin);
  const delta = num(depthDeltaFt);
  if (Number.isFinite(delta) && Math.abs(delta) > deadband) return delta > 0 ? "RIH" : "POOH";
  if (Number.isFinite(speed) && Math.abs(speed) > deadband) return speed > 0 ? "RIH" : "POOH";
  return "STOPPED";
}

export const diffPressure = (pInt, pWh) => {
  const a = num(pInt);
  const b = num(pWh);
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
};

export function encoderConsensus(depths, thresholdFt = ENCODER_THRESHOLD_FT) {
  const encoders = ENCODER_LABELS.map((name, i) => ({ name, depthFt: depths?.[i] }));
  const result = computeMultiEncoderConsensus(encoders, thresholdFt);
  return { ...result, mismatch: result.validEncoderCount >= 2 && result.maxDeltaFt > thresholdFt };
}

// warn/crit compare against the magnitude unless `signed` (then high side only).
export function statusFor(value, { warn, crit, signed = false } = {}) {
  const v = num(value);
  if (!Number.isFinite(v)) return "normal";
  const x = signed ? v : Math.abs(v);
  if (Number.isFinite(crit) && x >= crit) return "alarm";
  if (Number.isFinite(warn) && x >= warn) return "warning";
  return "normal";
}

export const STATUS_COLOR = { normal: "#22D3EE", warning: "#F59E0B", alarm: "#EF4444" };

export const signedFixed = (v, digits = 0) => {
  const n = num(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits).replace(/^-0(\.0+)?$/, (m) => m.slice(1));
};

export const WINDOWS = { "10m": 10 * 60e3, "1h": 3600e3, "4h": 4 * 3600e3, Shift: 12 * 3600e3 };

export const FATIGUE_SECTIONS = [
  { key: "top", label: "Top", range: "0-33% (reel end)", from: 0, to: 0.33 },
  { key: "middle", label: "Middle", range: "33-67%", from: 0.33, to: 0.67 },
  { key: "bottom", label: "Bottom", range: "67-100% (BHA end)", from: 0.67, to: 1 },
];

// Client-side estimate: cycles = trips of that section over the reel core / guide arch.
export function estimateFatigueSections({ lengthFt = 0, odIn = 1.75, wtIn = 0.134, smys = 90000, pressurePsi = 0, cyclesBySection = {} } = {}) {
  return FATIGUE_SECTIONS.map((s) => {
    const cycles = Number(cyclesBySection[s.key]) || 0;
    const perCycle = damagePerCycleScaled({ OD_in: odIn, WT_in: wtIn, bend_radius_in: 72, smys, internal_psi: pressurePsi });
    return {
      key: s.key,
      cumulative_damage_pct: Math.min(100, cycles * perCycle * 100),
      cycle_count: cycles,
      governing_depth_ft: Math.round(lengthFt * (s.from + s.to) / 2),
      life_cycles: Math.round(cyclesToFailure(odIn, 72, smys)),
      estimated: true,
    };
  });
}
