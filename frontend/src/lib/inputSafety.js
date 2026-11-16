// Strict numeric parsing + plausibility checks for field-entered values.
// Goal: a misplaced decimal, stray comma, negative pressure or absurd rate must
// produce a visible error, never a silently wrong calculation.

const PLAIN = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;
const THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/** @returns {{empty?:boolean, value?:number, text?:string, error?:string}} */
export function parseNumericInput(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, "");
  if (s === "") return { empty: true };
  if (THOUSANDS.test(s) && s.includes(".")) {
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? { value: n, text: String(n) } : { error: "Not a valid number" };
  }
  if (!PLAIN.test(s)) return { error: "Not a valid number" };
  const commas = (s.match(/,/g) || []).length;
  if (commas > 1 || (commas === 1 && s.includes("."))) return { error: "Use one decimal point only" };
  if (commas === 1 && /,\d{3}$/.test(s)) return { error: "Ambiguous comma — type the decimal point as ." };
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return { error: "Not a valid number" };
  return { value: n, text: String(n) };
}

const unitToken = (label) => {
  const m = /\(([^)]+)\)\s*$/.exec(label || "");
  return m ? m[1].trim().toLowerCase() : "";
};

// Fields that are legitimately signed: temperature, weight (pipe-light), differential pressure, TVD/depth offsets and angle deltas.
const SIGNED = /temp|deg [cf]|dls|incl|angle|offset|dip|azimuth|correction|weight|differential|delta|\u0394|\bdp\b|net p/i;

// Plausible physical ceilings per unit token (anything above is almost certainly a decimal slip).
const MAX_BY_UNIT = {
  psi: 30000, mpa: 207,
  ft: 100000, m: 30480,
  bpm: 30, "l/min": 4800, gpm: 1260,
  ppg: 30, "kg/m3": 3600,
  in: 24, mm: 610,
  lbs: 2e6, dan: 9e5,
  "ft/hr": 5000, "m/hr": 1500,
  "ft/min": 1000, "m/min": 300,
};

/** Validate a parsed value against its label. Returns an error string or null. */
export function plausibilityError(label, value) {
  if (!Number.isFinite(value)) return "Not a valid number";
  if (value < 0 && !SIGNED.test(label || "")) return "Cannot be negative";
  const max = MAX_BY_UNIT[unitToken(label)];
  if (max != null && Math.abs(value) > max) return `Implausible (> ${max.toLocaleString()}) — check decimal`;
  return null;
}

/**
 * Validate every sheet input. Returns { clean, errors }:
 *   clean  — index → normalized numeric string ("" when empty or invalid)
 *   errors — index → message (only for invalid fields)
 */
export function validateSheetValues(params, values) {
  const clean = {};
  const errors = {};
  params.forEach((label, i) => {
    const p = parseNumericInput(values[i]);
    if (p.empty) { clean[i] = ""; return; }
    const err = p.error || plausibilityError(label, p.value);
    if (err) { errors[i] = err; clean[i] = ""; return; }
    clean[i] = p.text;
  });
  return { clean, errors };
}

// Imperial → metric conversion keyed by "<imperial token>|<metric token>" (exact factors).
const PAIRS = {
  "ft|m": (v) => v * 0.3048,
  "in|mm": (v) => v * 25.4,
  "lbs|dan": (v) => (v * 4.4482216152605) / 10,
  "psi|mpa": (v) => v / 145.0377377,
  "bpm|l/min": (v) => v * 158.987294928,
  "ppg|kg/m3": (v) => v * 119.826427317,
  "gpt|l/m3": (v) => v,
  "ft/hr|m/hr": (v) => v * 0.3048,
  "ft/min|m/min": (v) => v * 0.3048,
  "deg f|deg c": (v) => ((v - 32) * 5) / 9,
};

/** Convert a value between the paired imperial / metric labels. Returns null if the pair is unknown. */
export function convertSheetValue(impLabel, metLabel, value, toMetric) {
  const a = unitToken(impLabel), b = unitToken(metLabel);
  if (a === b) return value;
  const fwd = PAIRS[`${a}|${b}`];
  if (!fwd) return null;
  if (toMetric) return fwd(value);
  // inverse by evaluating the linear map at 0 and 1 (all maps are affine)
  const f0 = fwd(0), f1 = fwd(1);
  return (value - f0) / (f1 - f0);
}

const trim = (n) => String(Number(n.toPrecision(10)));

/** Convert all entered values when the unit system flips; unknown pairs fall back to "" (re-entry required). */
export function convertSheetValues(impParams, metParams, values, toMetric) {
  const out = {};
  impParams.forEach((_, i) => {
    const p = parseNumericInput(values[i]);
    if (p.empty || p.error) { out[i] = values[i] ?? ""; return; }
    const c = convertSheetValue(impParams[i], metParams[i], p.value, toMetric);
    out[i] = c == null ? "" : trim(c);
  });
  return out;
}
