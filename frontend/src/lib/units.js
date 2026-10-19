/**
 * CoilAegis Global Unit System
 * -----------------------------------------------------------------------
 * Single source of truth for Imperial ⇄ Metric conversion across all 17
 * calc sheets, live gauges, 3D viewer, and PDF exports.
 *
 * CONVENTION — all engineering engines (ctPhysics.js, backend models,
 * fatigue, Von Mises) store numbers in IMPERIAL. The UI is responsible
 * for converting IMPERIAL → active display unit on render, and MMMetric →
 * IMPERIAL on form submit.
 *
 * All constants are exact (NIST / SPE Metric Standard SPE/COSSM 1984):
 *   1 ft    = 0.3048 m          (exact)
 *   1 in    = 25.4   mm         (exact)
 *   1 lbf   = 4.4482216152605 N (exact)
 *   1 psi   = 6.894757293168361 kPa
 *   1 bbl   = 0.158987294928    m³
 *   1 ppg   = 119.826427317     kg/m³
 */

export const UNIT_SYSTEMS = { IMPERIAL: "imperial", METRIC: "metric" };

// ─── Exact factors ──────────────────────────────────────────────────────
export const K = {
  FT_PER_M:   1 / 0.3048,          // m → ft
  M_PER_FT:   0.3048,              // ft → m
  IN_PER_MM:  1 / 25.4,            // mm → in
  MM_PER_IN:  25.4,                // in → mm
  LBF_PER_N:  1 / 4.4482216152605, // N → lbf
  N_PER_LBF:  4.4482216152605,     // lbf → N
  PSI_PER_KPA: 1 / 6.894757293168361, // kPa → psi
  KPA_PER_PSI: 6.894757293168361,  // psi → kPa
  PSI_PER_BAR: 14.5037737797,      // bar → psi
  PSI_PER_MPA: 145.037737797,      // MPa → psi
  BBL_PER_M3:  6.28981077043,      // m³ → bbl
  M3_PER_BBL:  0.158987294928,     // bbl → m³
  PPG_PER_KGM3: 1 / 119.826427317, // kg/m³ → ppg
  KGM3_PER_PPG: 119.826427317,     // ppg → kg/m³
};

// ─── Dimension-aware conversion registry ────────────────────────────────
// Each entry: { imperial: {unit, from, to}, metric: {unit, from, to} }
// `from(x, system)` returns value in the active system from a canonical
// IMPERIAL value. `to(x, system)` returns IMPERIAL from the display unit.
const CONV = {
  depth: {
    imperial: { label: "ft",  from: (v) => v,                 to: (v) => v },
    metric:   { label: "m",   from: (v) => v * K.M_PER_FT,    to: (v) => v * K.FT_PER_M },
  },
  speed_ftmin: {
    imperial: { label: "ft/min", from: (v) => v,              to: (v) => v },
    metric:   { label: "m/min",  from: (v) => v * K.M_PER_FT, to: (v) => v * K.FT_PER_M },
  },
  od: {
    imperial: { label: "in",  from: (v) => v,                 to: (v) => v },
    metric:   { label: "mm",  from: (v) => v * K.MM_PER_IN,   to: (v) => v * K.IN_PER_MM },
  },
  wt: {
    imperial: { label: "in",  from: (v) => v,                 to: (v) => v },
    metric:   { label: "mm",  from: (v) => v * K.MM_PER_IN,   to: (v) => v * K.IN_PER_MM },
  },
  force: {
    imperial: { label: "lbf", from: (v) => v,                 to: (v) => v },
    metric:   { label: "kN",  from: (v) => v * K.N_PER_LBF / 1000, to: (v) => v * K.LBF_PER_N * 1000 },
  },
  weight: {
    // Metric field convention for CT hook/injector weight is deca-newton
    // (1 daN ≈ 1 kgf). Keeps the digit scale similar to lbs for the crew.
    imperial: { label: "lbs", from: (v) => v,                      to: (v) => v },
    metric:   { label: "daN", from: (v) => v * K.N_PER_LBF / 10,   to: (v) => v * K.LBF_PER_N * 10 },
  },
  pressure: {
    // Field convention for CT pump / wellhead / net-ΔP readings is MPa in
    // Metric. kPa produces 5-digit values that are hard to read on gauges.
    imperial: { label: "psi", from: (v) => v,                         to: (v) => v },
    metric:   { label: "MPa", from: (v) => v / K.PSI_PER_MPA,         to: (v) => v * K.PSI_PER_MPA },
  },
  pressure_kpa: {
    // Opt-in retained for low-pressure annulus/casing fields that still
    // want kPa resolution.
    imperial: { label: "psi", from: (v) => v,                 to: (v) => v },
    metric:   { label: "kPa", from: (v) => v * K.KPA_PER_PSI, to: (v) => v * K.PSI_PER_KPA },
  },
  pressure_psi_fixed: {
    // Hydraulic injector-skate pressure is always expressed in psi in the
    // field, regardless of the viewer's unit system — manufacturers only
    // publish skate-cylinder recommended ranges in psi.
    imperial: { label: "psi", from: (v) => v, to: (v) => v },
    metric:   { label: "psi", from: (v) => v, to: (v) => v },
  },
  pressure_mpa: {
    imperial: { label: "psi", from: (v) => v,                 to: (v) => v },
    metric:   { label: "MPa", from: (v) => v * K.KPA_PER_PSI / 1000, to: (v) => v * K.PSI_PER_KPA * 1000 },
  },
  stress: {
    imperial: { label: "psi", from: (v) => v,                 to: (v) => v },
    metric:   { label: "MPa", from: (v) => v / K.PSI_PER_MPA, to: (v) => v * K.PSI_PER_MPA },
  },
  density: {
    imperial: { label: "ppg",   from: (v) => v,               to: (v) => v },
    metric:   { label: "kg/m³", from: (v) => v * K.KGM3_PER_PPG, to: (v) => v * K.PPG_PER_KGM3 },
  },
  flow_bpm: {
    imperial: { label: "bpm",   from: (v) => v,                               to: (v) => v },
    metric:   { label: "L/min", from: (v) => v * K.M3_PER_BBL * 1000,         to: (v) => v / (K.M3_PER_BBL * 1000) },
  },
  volume_bbl: {
    imperial: { label: "bbl",   from: (v) => v,                       to: (v) => v },
    metric:   { label: "m³",    from: (v) => v * K.M3_PER_BBL,        to: (v) => v / K.M3_PER_BBL },
  },
  dls: {
    imperial: { label: "°/100ft", from: (v) => v,            to: (v) => v },
    metric:   { label: "°/30m",   from: (v) => v * 0.984252, to: (v) => v / 0.984252 },
  },
  temp: {
    imperial: { label: "°F", from: (v) => v,                 to: (v) => v },
    metric:   { label: "°C", from: (v) => (v - 32) * 5 / 9,  to: (v) => v * 9 / 5 + 32 },
  },
};

/** Convert a canonical IMPERIAL value to the active display system. */
export const fromImp = (value, dim, system) => {
  if (value == null || !Number.isFinite(+value)) return value;
  const spec = CONV[dim]?.[system] || CONV[dim]?.imperial;
  return spec ? spec.from(+value) : value;
};

/** Convert a value in the active display system BACK to canonical IMPERIAL. */
export const toImp = (value, dim, system) => {
  if (value == null || !Number.isFinite(+value)) return value;
  const spec = CONV[dim]?.[system] || CONV[dim]?.imperial;
  return spec ? spec.to(+value) : value;
};

/** Active unit label for a dimension (e.g. "ft" or "m"). */
export const unitLabel = (dim, system) => CONV[dim]?.[system]?.label || "";

/** Format a canonical IMPERIAL value for display, e.g. "4,520 psi" / "31,164 kPa". */
export const fmt = (value, dim, system, { digits, suffix = true } = {}) => {
  if (value == null || !Number.isFinite(+value)) return "—";
  const v = fromImp(+value, dim, system);
  const d = digits ?? (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  const s = v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  return suffix ? `${s} ${unitLabel(dim, system)}` : s;
};
