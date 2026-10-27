// Pure variance maths for Shadow Comparison Mode. No React / storage imports so
// every function is unit-testable and safe to call from any calculation module.
import { cyclesToFailure, damagePerCycleScaled } from "../ctPhysics";

// Delta bands (percent, absolute): green < 1, amber 1–3, red > 3.
// Anything above ALERT_PCT is highlighted for field verification.
export const GREEN_MAX_PCT = 1;
export const AMBER_MAX_PCT = 3;
export const ALERT_PCT = 2;

export const CATEGORIES = {
  fatigue: {
    label: "Tubing fatigue & cycles",
    reference: "Standard fatigue software",
    metrics: ["Fatigue life consumed", "Cycle count", "Damage per cycle"],
  },
  pressure: {
    label: "Hydrostatic & friction pressure",
    reference: "Measured wellhead / pump pressure",
    metrics: ["Hydrostatic pressure", "Friction pressure loss", "Pump pressure", "Wellhead pressure"],
  },
  weight: {
    label: "String weight, buoyancy & overpull",
    reference: "Weight indicator",
    metrics: ["Buoyed string weight", "Overpull limit", "Pickup weight"],
  },
};

export const STATUS = {
  green: { label: "Match", color: "#22C55E", bg: "rgba(34,197,94,0.14)" },
  amber: { label: "Watch", color: "#F59E0B", bg: "rgba(245,158,11,0.16)" },
  red: { label: "Alert", color: "#EF4444", bg: "rgba(239,68,68,0.16)" },
  na: { label: "N/A", color: "#94A3B8", bg: "rgba(148,163,184,0.14)" },
};

const num = (v) => (typeof v === "string" && v.trim() === "" ? NaN : Number(v));

/** Signed percentage delta of `aegis` against `reference`. Null when not computable. */
export function pctDelta(aegis, reference) {
  const a = num(aegis);
  const r = num(reference);
  if (!Number.isFinite(a) || !Number.isFinite(r)) return null;
  if (r === 0) return a === 0 ? 0 : null;
  return ((a - r) / Math.abs(r)) * 100;
}

/** Colour band for a signed percentage delta. */
export function classifyDelta(delta) {
  if (delta == null || !Number.isFinite(delta)) return "na";
  const d = Math.abs(delta);
  if (d < GREEN_MAX_PCT) return "green";
  if (d <= AMBER_MAX_PCT) return "amber";
  return "red";
}

export const exceedsAlert = (delta) => delta != null && Math.abs(delta) > ALERT_PCT;

let seq = 0;
/** Build a normalised variance record. Returns null when the inputs are not numeric. */
export function buildRecord({ category, metric, aegis, reference, unit = "", jobId = "", note = "", ts }) {
  if (!CATEGORIES[category]) return null;
  const a = num(aegis);
  const r = num(reference);
  if (!Number.isFinite(a) || !Number.isFinite(r)) return null;
  const delta = pctDelta(a, r);
  seq += 1;
  return {
    id: `${Date.now().toString(36)}-${seq}`,
    ts: ts || new Date().toISOString(),
    category,
    metric: String(metric || CATEGORIES[category].metrics[0]).slice(0, 80),
    aegis: a,
    reference: r,
    unit: String(unit).slice(0, 16),
    delta,
    absDelta: delta == null ? null : Math.abs(delta),
    status: classifyDelta(delta),
    alert: exceedsAlert(delta),
    jobId: String(jobId).slice(0, 60),
    note: String(note).slice(0, 240),
  };
}

/** Aggregate stats across records (optionally one category). */
export function summarize(records, category) {
  const rows = (records || []).filter((r) => r.absDelta != null && (!category || r.category === category));
  const counts = { green: 0, amber: 0, red: 0 };
  rows.forEach((r) => { counts[r.status] += 1; });
  const n = rows.length;
  const sum = rows.reduce((s, r) => s + r.absDelta, 0);
  const sq = rows.reduce((s, r) => s + r.absDelta ** 2, 0);
  return {
    n,
    counts,
    alerts: rows.filter((r) => r.alert).length,
    meanAbsDelta: n ? sum / n : null,
    rmsDelta: n ? Math.sqrt(sq / n) : null,
    maxAbsDelta: n ? Math.max(...rows.map((r) => r.absDelta)) : null,
    withinGreenPct: n ? (counts.green / n) * 100 : null,
    withinAlertPct: n ? (rows.filter((r) => !r.alert).length / n) * 100 : null,
    overall: n === 0 ? "na" : counts.red ? "red" : counts.amber ? "amber" : "green",
  };
}

// ───────────── physics helpers used to auto-fill the Aegis side ─────────────

const posNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** Hydrostatic pressure, psi = 0.052 · MW(ppg) · TVD(ft). */
export function hydrostaticPsi(mwPpg, tvdFt) {
  const mw = posNum(mwPpg); const tvd = posNum(tvdFt);
  return mw && tvd ? 0.052 * mw * tvd : null;
}

/** Steel-in-fluid buoyancy factor, 1 − MW/65.4. */
export function buoyancyFactor(mwPpg) {
  const mw = Number(mwPpg);
  return Number.isFinite(mw) && mw >= 0 ? 1 - mw / 65.4 : null;
}

/** Buoyed string weight, lbf = air weight per ft · length · BF. */
export function buoyedWeightLbf(lbPerFt, lengthFt, mwPpg) {
  const w = posNum(lbPerFt); const l = posNum(lengthFt); const bf = buoyancyFactor(mwPpg);
  return w && l && bf != null ? w * l * bf : null;
}

/** Cumulative Palmgren–Miner damage (fraction of life consumed) for N cycles. */
export function fatigueConsumed({ OD_in, WT_in, bend_radius_in, smys, internal_psi = 0, cycles }) {
  const n = Number(cycles);
  const od = posNum(OD_in);
  if (!od || !Number.isFinite(n) || n < 0) return null;
  const d = damagePerCycleScaled({ OD_in: od, WT_in, bend_radius_in, smys, internal_psi });
  return { damagePerCycle: d, consumed: d * n, cyclesToFailure: cyclesToFailure(od, bend_radius_in, smys) };
}
