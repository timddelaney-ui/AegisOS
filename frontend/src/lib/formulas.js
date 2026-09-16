/*
 * CT Field Workbook — Industry-standard formulas & safe-operating-limit checks.
 *
 * References baked in:
 *   API RP 5C7  — Coiled Tubing Operations (mechanical / free-point / running loads)
 *   API RP 5C3  — CT wall stress / yield
 *   API RP 13D  — Rheology / hydraulics
 *   API Spec 5ST — CT material grades
 *   Bourgoyne et al. — Applied Drilling Engineering (Fanning friction, Reynolds)
 *   IADC/SPE 130580 — CT hydraulics
 *   AER Directive 020 — Well abandonment plug requirements (Alberta)
 *   AER Directive 037 — Service rig operations
 *   Nierode & Williams (1971) — Acid reaction kinetics
 *   Moore (1974) — Cuttings transport slip velocity
 *
 * All internal math is Imperial (oilfield). Metric inputs are converted in,
 * results are converted back to the caller's unit system for display.
 */

// -------- Unit conversions ----------------------------------------------------
export const conv = {
  m_to_ft: (m) => m * 3.28084,
  ft_to_m: (ft) => ft / 3.28084,
  mm_to_in: (mm) => mm / 25.4,
  in_to_mm: (i) => i * 25.4,
  daN_to_lb: (daN) => daN * 2.24809,
  lb_to_daN: (lb) => lb / 2.24809,
  MPa_to_psi: (mpa) => mpa * 145.038,
  psi_to_MPa: (psi) => psi / 145.038,
  psi_to_kPa: (psi) => psi * 6.8948,
  m3_to_bbl: (m3) => m3 * 6.28981,
  bbl_to_m3: (b) => b / 6.28981,
  Lmin_to_bpm: (L) => L * 0.00628981,
  bpm_to_Lmin: (b) => b / 0.00628981,
  gpm_to_Lmin: (g) => g * 3.78541,
  kgm3_to_ppg: (k) => k / 119.826,
  ppg_to_kgm3: (p) => p * 119.826,
  scfm_to_sm3min: (s) => s * 0.0283168,
  sm3min_to_scfm: (s) => s / 0.0283168,
  C_to_F: (c) => (c * 9) / 5 + 32,
  F_to_C: (f) => ((f - 32) * 5) / 9,
  ftmin_to_mmin: (v) => v * 0.3048,
  psi_per_ft_to_kPa_per_m: (g) => g * 22.621,          // 1 psi/ft = 22.621 kPa/m
  psi_per_1000ft_to_kPa_per_1000m: (g) => g * 22.621,  // same numeric factor / 1000 dropped
  bbl_per_ft_to_m3_per_m: (c) => c * 0.5216,           // 1 bbl/ft = 0.5216 m³/m
  in2_to_mm2: (a) => a * 645.16,
  hhp_to_kw: (hp) => hp * 0.7457,
};

// -------- Unified presenter --------------------------------------------------
// Given an Imperial value + kind, returns {value, unit} in requested unitSystem.
function fmt(imp, u, kind, decimals = 2) {
  if (imp === null || imp === undefined || isNaN(imp)) {
    const emptyUnits = {
      depth: ["ft", "m"], diameter: ["in", "mm"], area: ["in²", "mm²"],
      force: ["lb", "daN"], pressure: ["psi", "MPa"],
      pressureGradient: ["psi/ft", "kPa/m"], frictionK: ["psi/1000ft", "kPa/1000m"],
      volume: ["bbl", "m³"], capacity: ["bbl/ft", "m³/m"],
      rateBPM: ["BPM", "L/min"], rateGPM: ["gpm", "L/min"],
      velocity: ["ft/min", "m/min"], density: ["ppg", "kg/m³"],
      temperature: ["°F", "°C"], scf: ["SCF", "Sm³"], power: ["HHP", "kW"],
      time: ["min", "min"], percent: ["%", "%"], ratio: ["×", "×"],
      unitless: ["", ""], sacks: ["sk", "sk"], count: ["#", "#"],
      hoursShutIn: ["h", "h"], mass: ["lb", "kg"],
    };
    const [i, m] = emptyUnits[kind] || ["", ""];
    return { value: "—", unit: u === "imp" ? i : m };
  }
  let outVal, outUnit;
  switch (kind) {
    case "depth":            outVal = u === "imp" ? imp : conv.ft_to_m(imp);              outUnit = u === "imp" ? "ft" : "m"; break;
    case "diameter":         outVal = u === "imp" ? imp : conv.in_to_mm(imp);             outUnit = u === "imp" ? "in" : "mm"; break;
    case "area":             outVal = u === "imp" ? imp : conv.in2_to_mm2(imp);           outUnit = u === "imp" ? "in²" : "mm²"; break;
    case "force":            outVal = u === "imp" ? imp : conv.lb_to_daN(imp);            outUnit = u === "imp" ? "lb" : "daN"; break;
    case "pressure":         outVal = u === "imp" ? imp : conv.psi_to_MPa(imp);           outUnit = u === "imp" ? "psi" : "MPa"; break;
    case "pressureGradient": outVal = u === "imp" ? imp : conv.psi_per_ft_to_kPa_per_m(imp); outUnit = u === "imp" ? "psi/ft" : "kPa/m"; break;
    case "frictionK":        outVal = u === "imp" ? imp : conv.psi_per_1000ft_to_kPa_per_1000m(imp); outUnit = u === "imp" ? "psi/1000ft" : "kPa/1000m"; break;
    case "volume":           outVal = u === "imp" ? imp : conv.bbl_to_m3(imp);            outUnit = u === "imp" ? "bbl" : "m³"; break;
    case "capacity":         outVal = u === "imp" ? imp : conv.bbl_per_ft_to_m3_per_m(imp); outUnit = u === "imp" ? "bbl/ft" : "m³/m"; break;
    case "rateBPM":          outVal = u === "imp" ? imp : conv.bpm_to_Lmin(imp);          outUnit = u === "imp" ? "BPM" : "L/min"; break;
    case "rateGPM":          outVal = u === "imp" ? imp : conv.gpm_to_Lmin(imp);          outUnit = u === "imp" ? "gpm" : "L/min"; break;
    case "velocity":         outVal = u === "imp" ? imp : conv.ftmin_to_mmin(imp);        outUnit = u === "imp" ? "ft/min" : "m/min"; break;
    case "density":          outVal = u === "imp" ? imp : conv.ppg_to_kgm3(imp);          outUnit = u === "imp" ? "ppg" : "kg/m³"; break;
    case "temperature":      outVal = u === "imp" ? imp : conv.F_to_C(imp);               outUnit = u === "imp" ? "°F" : "°C"; break;
    case "scf":              outVal = u === "imp" ? imp : imp * 0.0283168;                outUnit = u === "imp" ? "SCF" : "Sm³"; break;
    case "power":            outVal = u === "imp" ? imp : conv.hhp_to_kw(imp);            outUnit = u === "imp" ? "HHP" : "kW"; break;
    case "time":             outVal = imp; outUnit = "min"; break;
    case "hoursShutIn":      outVal = imp; outUnit = "h"; break;
    case "percent":          outVal = imp; outUnit = "%"; break;
    case "ratio":            outVal = imp; outUnit = "×"; break;
    case "sacks":            outVal = imp; outUnit = "sk"; break;
    case "count":            outVal = imp; outUnit = "#"; break;
    case "mass":             outVal = u === "imp" ? imp : imp * 0.4536;                   outUnit = u === "imp" ? "lb" : "kg"; break;
    default:                 outVal = imp; outUnit = "";
  }
  return { value: Number(outVal).toFixed(decimals), unit: outUnit };
}

// -------- Value extraction ---------------------------------------------------
function grab(values, params, unitSystem, patterns) {
  for (let i = 0; i < params.length; i++) {
    const label = params[i];
    const l = label.toLowerCase();
    if (patterns.some((p) => l.includes(p.toLowerCase()))) {
      const raw = parseFloat(values[i]);
      if (isNaN(raw)) return null;
      if (unitSystem === "imp") return raw;
      // Convert Metric input to Imperial based on unit hint in the label
      if (l.includes("(mm)")) return conv.mm_to_in(raw);
      if (l.includes("(m)") && !l.includes("mm") && !l.includes("mpa") && !l.includes("min")) return conv.m_to_ft(raw);
      if (l.includes("(daN)")) return conv.daN_to_lb(raw);
      if (l.includes("(mpa)")) return conv.MPa_to_psi(raw);
      if (l.includes("(m3)")) return conv.m3_to_bbl(raw);
      if (l.includes("(l/min)")) return conv.Lmin_to_bpm(raw);
      if (l.includes("(kg/m3)")) return conv.kgm3_to_ppg(raw);
      if (l.includes("(sm3/min)")) return conv.sm3min_to_scfm(raw);
      if (l.includes("(deg c)")) return conv.C_to_F(raw);
      if (l.includes("(m/hr)")) return conv.m_to_ft(raw); // ROP
      return raw;
    }
  }
  return null;
}

// -------- Material properties -----------------------------------------------
const E_STEEL_PSI = 30_000_000;
const CT_YIELD_PSI = 100_000;   // CT-100 grade nominal
const CT_TENSILE_PSI = 110_000;
const WATER_PPG = 8.33;

const areaCircle = (d) => (Math.PI / 4) * d * d;
const wallArea = (od, id) => areaCircle(od) - areaCircle(id);
const capacity_bbl_per_ft = (id_in) => (id_in * id_in) / 1029.4;
const annCap_bbl_per_ft = (dCase, dCT) => (dCase * dCase - dCT * dCT) / 1029.4;
const ct_weight_per_ft = (od, id) => wallArea(od, id) * 3.4;

// -------- Hydraulics helpers (Bourgoyne / Blasius) --------------------------
// Reynolds number for Newtonian fluid in pipe/annulus (field units)
function reynolds(rho_ppg, v_fps, d_in, mu_cp) {
  return (7742 * (rho_ppg || WATER_PPG) * v_fps * d_in) / (mu_cp || 1);
}
// Fanning friction factor (Blasius for turbulent smooth pipe)
function fanning(Re) {
  if (!Re || Re <= 0) return null;
  if (Re < 2100) return 16 / Re;
  return 0.0791 / Math.pow(Re, 0.25);
}
// Straight-pipe friction loss (psi over length_ft), Fanning + Bourgoyne unit form
// dP = f · ρ · v² · L / (25.81 · d)
function pipeFriction_psi(Q_bpm, d_in, rho_ppg, mu_cp, length_ft) {
  if (!Q_bpm || !d_in || !length_ft || d_in <= 0) return null;
  const A_in2 = areaCircle(d_in);
  const v_fps = (Q_bpm * 13.48) / A_in2;
  const Re = reynolds(rho_ppg, v_fps, d_in, mu_cp);
  const f = fanning(Re);
  if (f === null) return null;
  return (f * (rho_ppg || WATER_PPG) * v_fps * v_fps * length_ft) / (25.81 * d_in);
}
// Annular friction loss (psi over length_ft), using hydraulic diameter (d_case − d_ct)
function annularFriction_psi(Q_bpm, d_case, d_ct, rho_ppg, mu_cp, length_ft) {
  if (!Q_bpm || !d_case || !d_ct || !length_ft) return null;
  const A_ann_in2 = areaCircle(d_case) - areaCircle(d_ct);
  const d_h = d_case - d_ct;
  const v_fps = (Q_bpm * 13.48) / A_ann_in2;
  const Re = reynolds(rho_ppg, v_fps, d_h, mu_cp);
  const f = fanning(Re);
  if (f === null) return null;
  return (f * (rho_ppg || WATER_PPG) * v_fps * v_fps * length_ft) / (25.81 * d_h);
}
// Velocity helper (ft/min) — commonly used for annular velocity checks
const v_annular_ftmin = (Q_bpm, A_in2) =>
  Q_bpm && A_in2 ? (Q_bpm * 9701.9) / A_in2 / 12 : null;

// ============================================================================
// SHEET CALCULATORS
// ============================================================================

function calc_Pipe_Stretch(vals, params, u) {
  const stretch_in = grab(vals, params, u, ["stretch"]);
  const overpull_lb = grab(vals, params, u, ["overpull"]);
  const ct_od = grab(vals, params, u, ["ct od"]);
  const ct_id = grab(vals, params, u, ["ct id"]);
  const depth_ft = grab(vals, params, u, ["current depth"]);

  const wA = ct_od && ct_id ? wallArea(ct_od, ct_id) : null;
  const freept_ft = stretch_in && overpull_lb && wA ? (stretch_in * E_STEEL_PSI * wA) / overpull_lb / 12 : null;
  const stuckPct = freept_ft && depth_ft ? (freept_ft / depth_ft) * 100 : null;
  const yieldForce = wA ? CT_YIELD_PSI * wA : null;
  const maxSafeOverpull = yieldForce ? yieldForce * 0.8 : null;
  const utilisation = overpull_lb && maxSafeOverpull ? (overpull_lb / maxSafeOverpull) * 100 : null;

  const warnings = [];
  if (overpull_lb && maxSafeOverpull && overpull_lb > maxSafeOverpull)
    warnings.push({ level: "danger", msg: `Overpull ${overpull_lb.toFixed(0)} lb exceeds 80% of CT yield (${maxSafeOverpull.toFixed(0)} lb). Risk of parting. Reduce pull (API RP 5C7).` });
  else if (overpull_lb && yieldForce && overpull_lb > 0.6 * yieldForce)
    warnings.push({ level: "warn", msg: `Overpull is within 60–80% of yield — verify grade and bending history.` });

  return {
    results: [
      { label: "Free-point depth", ...fmt(freept_ft, u, "depth", 0), formula: "L = ΔL · E · A / F", note: "Depth to stuck point from surface" },
      { label: "Stuck-point ratio", ...fmt(stuckPct, u, "percent", 1), note: stuckPct && stuckPct > 95 ? "Near bottom — string likely free" : "" },
      { label: "CT wall cross-section", ...fmt(wA, u, "area", 4), formula: "A = π/4 · (OD² − ID²)" },
      { label: "CT yield force (Fy)", ...fmt(yieldForce, u, "force", 0), formula: "Fy = σy · A", note: `σy = ${CT_YIELD_PSI/1000}k psi (CT-100)` },
      { label: "Max safe overpull (0.80 × Fy)", ...fmt(maxSafeOverpull, u, "force", 0), note: "Per API RP 5C7 §9.4 — do not exceed" },
      { label: "Overpull utilisation", ...fmt(utilisation, u, "percent", 1), note: "Keep < 80%" },
    ],
    warnings,
    formula: "L = ΔL·E·A / F   (E = 30 × 10⁶ psi for CT steel)",
    reference: "API RP 5C7 §9.4 · API Spec 5ST",
  };
}

function calc_Sand_Cleanout(vals, params, u) {
  const q_bpm = grab(vals, params, u, ["flow rate"]);
  const casing_id = grab(vals, params, u, ["casing id"]);
  const tubing_od = grab(vals, params, u, ["tubing od"]);
  const visc = grab(vals, params, u, ["viscosity"]);
  const depth_ft = grab(vals, params, u, ["current depth"]);
  // FR loading: imp is gpt (gallons per thousand gal); met is L/m³.
  //   1 gpt = 1 L/m³ · 1.0 (both dimensionless ratios ×1000)
  //   Actually: 1 gpt = 1 gal / 1000 gal = 0.001 = 1 L/m³ (since 1 L/m³ = 1e-3)
  //   So gpt and L/m³ are numerically identical.
  const fr_load = grab(vals, params, u, ["friction reducer"]);

  const A_ann_in2 = casing_id && tubing_od ? areaCircle(casing_id) - areaCircle(tubing_od) : null;
  const v_ann = v_annular_ftmin(q_bpm, A_ann_in2);
  const annCap = casing_id && tubing_od ? annCap_bbl_per_ft(casing_id, tubing_od) : null;
  const annVol = annCap && depth_ft ? annCap * depth_ft : null;
  const bottomsUp_min = annVol && q_bpm ? annVol / q_bpm : null;

  // Moore's slip velocity (Newtonian, sand SG = 2.65, dp = 0.03 in)
  const dp = 0.03, rho_ratio = 1.65;
  const v_slip = visc ? 175 * Math.pow(dp, 0.667) * Math.pow(rho_ratio, 0.667) / Math.pow(visc, 0.333) : null;
  const transportRatio = v_ann && v_slip ? v_ann / v_slip : null;

  // FR volume per bbl of carrier fluid (1 gpt = 1 gal FR per 1000 gal fluid = 0.042 gal/bbl)
  const fr_gal_per_bbl = fr_load !== null ? fr_load * 0.042 : null;
  const fr_gal_per_bottomsup = fr_gal_per_bbl && annVol ? fr_gal_per_bbl * annVol : null;

  const warnings = [];
  if (v_ann !== null && v_ann < 100)
    warnings.push({ level: "warn", msg: `Annular velocity ${v_ann.toFixed(0)} ft/min below 100 ft/min minimum for vertical solids transport.` });
  if (transportRatio !== null && transportRatio < 1.5)
    warnings.push({ level: "warn", msg: `Transport ratio ${transportRatio.toFixed(2)} below 1.5× rule of thumb — cuttings may fall back.` });
  if (fr_load !== null && fr_load < 0.5)
    warnings.push({ level: "warn", msg: `FR loading ${fr_load.toFixed(2)} gpt is low — typical CT cleanout carriers run 1.0–2.5 gpt.` });
  if (fr_load !== null && fr_load > 4.0)
    warnings.push({ level: "warn", msg: `FR loading ${fr_load.toFixed(2)} gpt is high — verify friction-pressure benefit vs cost.` });

  const results = [
    { label: "Annular flow area", ...fmt(A_ann_in2, u, "area", 3) },
    { label: "Annular velocity", ...fmt(v_ann, u, "velocity", 0), formula: "Va = Q · 9701.9 / A / 12", note: "≥ 100 ft/min recommended (Moore)" },
    { label: "Annular capacity", ...fmt(annCap, u, "capacity", 4) },
    { label: "Total annular volume", ...fmt(annVol, u, "volume", 1) },
    { label: "Bottoms-up circulation time", ...fmt(bottomsUp_min, u, "time", 1), note: "Circulate ≥ 1.5 BU after tag" },
    { label: "Slip velocity (est.)", ...fmt(v_slip, u, "velocity", 1), formula: "Moore (1974)" },
    { label: "Transport ratio (Va/Vs)", ...fmt(transportRatio, u, "ratio", 2), note: "Target ≥ 1.5×" },
  ];
  if (fr_gal_per_bottomsup !== null) {
    results.push({
      label: "FR volume per bottoms-up",
      value: (u === "imp" ? fr_gal_per_bottomsup : fr_gal_per_bottomsup * 3.7854).toFixed(1),
      unit: u === "imp" ? "gal" : "L",
      formula: "V_FR = load · 0.042 · Vann",
      note: `Loading: ${fr_load !== null ? fr_load.toFixed(2) : "—"} ${u === "imp" ? "gpt" : "L/m³"}`,
    });
  }

  return {
    results,
    warnings,
    formula: "Va = Q · 9701.9 / A(in²) / 12 ;  Vs per Moore correlation",
    reference: "API RP 13D · IADC/SPE 130580 · Moore (1974)",
  };
}

function calc_CT_Milling(vals, params, u) {
  const depth = grab(vals, params, u, ["depth"]);
  const ct_od = grab(vals, params, u, ["ct od"]);
  const ct_id = grab(vals, params, u, ["ct id"]);
  const casing_id = grab(vals, params, u, ["casing id"]);
  const taggedWt = grab(vals, params, u, ["weight on gauge", "tagged"]);
  const rihWt    = grab(vals, params, u, ["run-in-hole", "run in hole"]);
  const q_bpm = grab(vals, params, u, ["pump rate"]);
  const visc = grab(vals, params, u, ["viscosity"]);
  const rho = grab(vals, params, u, ["density"]);

  // WOB = RIH free-hanging weight − indicator reading with bit tagged.
  //   • Free hanging (no bit contact): tagged ≈ RIH  → WOB ≈ 0
  //   • Bit taking weight: tagged < RIH             → WOB > 0
  const WOB = taggedWt !== null && rihWt !== null ? rihWt - taggedWt : null;
  const q_gpm = q_bpm !== null ? q_bpm * 42 : null;
  const Pf = pipeFriction_psi(q_bpm, ct_id, rho, visc, depth);
  const dP_per_1000 = Pf && depth ? (Pf / depth) * 1000 : null;
  const Ph = rho && depth ? 0.052 * rho * depth : null;
  const HHP = q_gpm && Pf ? (Pf * q_gpm) / 1714 : null;
  const A_ann = casing_id && ct_od ? areaCircle(casing_id) - areaCircle(ct_od) : null;
  const v_ann = v_annular_ftmin(q_bpm, A_ann);
  const capCT = ct_id ? capacity_bbl_per_ft(ct_id) : null;
  const strVol = capCT && depth ? capCT * depth : null;
  const buoyed_wt_perft = ct_od && ct_id && rho ? ct_weight_per_ft(ct_od, ct_id) * (1 - rho / 65.4) : null;
  const buoyed_string_wt = buoyed_wt_perft && depth ? buoyed_wt_perft * depth : null;

  const warnings = [];
  if (WOB !== null && WOB > 2000)
    warnings.push({ level: "warn", msg: `WOB ${WOB.toFixed(0)} lb exceeds 2000 lb — sinusoidal buckling risk (API RP 5C7 §7.3).` });
  if (WOB !== null && WOB < 0)
    warnings.push({ level: "warn", msg: `Negative WOB — tagged weight exceeds run-in-hole weight. Recheck inputs (RIH should be higher).` });
  if (v_ann !== null && v_ann < 90)
    warnings.push({ level: "warn", msg: `Annular velocity ${v_ann.toFixed(0)} ft/min may be insufficient for cuttings transport.` });
  if (Pf !== null && Pf > 5000)
    warnings.push({ level: "warn", msg: `CT friction ${Pf.toFixed(0)} psi is high — consider larger CT or lower rate.` });

  return {
    results: [
      { label: "Weight on Bit (WOB)", ...fmt(WOB, u, "force", 0), formula: "WOB = RIH weight − Weight on gauge (tagged)", note: "Target 500–1500 lb for composite" },
      { label: "Pump rate", ...fmt(q_gpm, u, "rateGPM", 1), note: `= ${q_bpm !== null ? q_bpm.toFixed(2) : "—"} BPM` },
      { label: "CT friction pressure (total)", ...fmt(Pf, u, "pressure", 0), formula: "Fanning: ΔP = f·ρ·v²·L / (25.81·d)" },
      { label: "Friction gradient", ...fmt(dP_per_1000, u, "frictionK", 0) },
      { label: "Hydrostatic pressure", ...fmt(Ph, u, "pressure", 0), formula: "Ph = 0.052 · ρ · TVD" },
      { label: "Hydraulic HP (surface)", ...fmt(HHP, u, "power", 1), formula: "HHP = ΔP · Q / 1714" },
      { label: "Annular velocity", ...fmt(v_ann, u, "velocity", 0), note: "≥ 100 ft/min for cuttings" },
      { label: "CT internal capacity", ...fmt(capCT, u, "capacity", 4) },
      { label: "CT internal volume", ...fmt(strVol, u, "volume", 2) },
      { label: "Buoyed string weight", ...fmt(buoyed_string_wt, u, "force", 0) },
    ],
    warnings,
    formula: "Fanning friction: ΔP = f·ρ·v²·L / (25.81·d)  ·  f = 0.0791/Re^0.25 (turbulent, Blasius)",
    reference: "API RP 5C7 §7 · Bourgoyne et al. · API RP 13D",
  };
}

function calc_CT_Drilling(vals, params, u) {
  const base = calc_CT_Milling(vals, params, u);
  const rop = grab(vals, params, u, ["rop"]);
  const casing_id = grab(vals, params, u, ["casing id"]);
  const ct_od = grab(vals, params, u, ["ct od"]);
  const rate_bpm = grab(vals, params, u, ["pump rate"]);

  const A_hole = casing_id ? areaCircle(casing_id) : null;
  const cuttings_bbl_hr = A_hole && rop ? (A_hole * rop * 12 * 0.8) / 9701.9 : null;
  const A_ann = casing_id && ct_od ? areaCircle(casing_id) - areaCircle(ct_od) : null;
  const v_ann = v_annular_ftmin(rate_bpm, A_ann);
  const mud_bbl_hr = rate_bpm ? rate_bpm * 60 : null;
  const conc_pct = cuttings_bbl_hr && mud_bbl_hr ? (cuttings_bbl_hr / (mud_bbl_hr + cuttings_bbl_hr)) * 100 : null;

  const warnings = [...base.warnings];
  if (conc_pct !== null && conc_pct > 5)
    warnings.push({ level: "warn", msg: `Return cuttings concentration ${conc_pct.toFixed(1)}% > 5%. Reduce ROP or increase flow.` });

  const cuttings_display = cuttings_bbl_hr !== null
    ? (u === "imp" ? cuttings_bbl_hr : conv.bbl_to_m3(cuttings_bbl_hr)).toFixed(2)
    : "—";

  return {
    results: [
      ...base.results,
      { label: "Cuttings generation", value: cuttings_display, unit: u === "imp" ? "bbl/hr" : "m³/hr", formula: "V̇ = ROP · A · (1−φ)" },
      { label: "Cuttings concentration in return", ...fmt(conc_pct, u, "percent", 2), note: "Keep < 5% by volume" },
      { label: "Annular velocity", ...fmt(v_ann, u, "velocity", 0) },
    ],
    warnings,
    formula: base.formula + "  ·  V̇cuttings = ROP·A·(1−φ)",
    reference: "API RP 5C7 · IADC/SPE 130580 · API RP 13D",
  };
}

function calc_Pill_Spotting(vals, params, u) {
  const cur = grab(vals, params, u, ["current depth"]);
  const tgt = grab(vals, params, u, ["target depth"]);
  const pillV = grab(vals, params, u, ["pill vol"]);
  const ct_od = grab(vals, params, u, ["ct od"]);
  const ct_id = grab(vals, params, u, ["ct id"]);
  const casing = grab(vals, params, u, ["casing id"]);
  const rate = grab(vals, params, u, ["pump rate"]);
  const rho = grab(vals, params, u, ["density"]);

  const distance = cur !== null && tgt !== null ? Math.abs(tgt - cur) : null;
  const capInt = ct_id ? capacity_bbl_per_ft(ct_id) : null;
  const capAnn = casing && ct_od ? annCap_bbl_per_ft(casing, ct_od) : null;
  const displaceVol = capInt && tgt ? capInt * tgt : null;
  const pillLenInt = pillV && capInt ? pillV / capInt : null;
  const pillLenAnn = pillV && capAnn ? pillV / capAnn : null;
  const timePump = displaceVol && rate ? displaceVol / rate : null;
  const P_hyd_target = rho && tgt ? 0.052 * rho * tgt : null;

  const warnings = [];
  if (rate !== null && rate < 0.5)
    warnings.push({ level: "warn", msg: `Pump rate ${rate.toFixed(2)} BPM is very low — placement uncertainty increases.` });

  return {
    results: [
      { label: "Distance to target", ...fmt(distance, u, "depth", 0) },
      { label: "CT internal capacity", ...fmt(capInt, u, "capacity", 4) },
      { label: "Annular capacity", ...fmt(capAnn, u, "capacity", 4) },
      { label: "Displacement volume to spot", ...fmt(displaceVol, u, "volume", 2), formula: "Vd = capCT · TargetDepth" },
      { label: "Pill length inside CT", ...fmt(pillLenInt, u, "depth", 0) },
      { label: "Pill length in annulus", ...fmt(pillLenAnn, u, "depth", 0), note: "Coverage over target zone" },
      { label: "Total pump time", ...fmt(timePump, u, "time", 1), formula: "t = Vd / Q" },
      { label: "Hydrostatic @ target", ...fmt(P_hyd_target, u, "pressure", 0) },
    ],
    warnings,
    formula: "Vd = capCT × TargetDepth · Coverage = Vpill / capAnnulus",
    reference: "API RP 5C7 §11 · Halliburton CT Placement Manual",
  };
}

function calc_Frac_Through_CT(vals, params, u) {
  const depth = grab(vals, params, u, ["depth"]);
  const ct_od = grab(vals, params, u, ["ct od"]);
  const ct_id = grab(vals, params, u, ["ct id"]);
  const casing = grab(vals, params, u, ["casing id"]);
  const surfP = grab(vals, params, u, ["treating p"]);
  const q_bpm = grab(vals, params, u, ["pump rate"]);
  const rho = grab(vals, params, u, ["density"]);
  const fr_load = grab(vals, params, u, ["friction reducer"]);

  const Ph = rho && depth ? 0.052 * rho * depth : null;
  // FR reduces effective turbulent friction. Typical drag-reduction curve for polyacrylamide FR:
  //   0 gpt → 1.00, 1 gpt → 0.55, 2 gpt → 0.35, 3 gpt → 0.28, plateau ~4 gpt @ 0.22
  const fr_factor = fr_load !== null && fr_load > 0
    ? Math.max(0.22, 1.0 - 0.30 * Math.log(1 + fr_load))
    : 1.0;
  const Pf_raw = pipeFriction_psi(q_bpm, ct_id, rho, 1, depth);
  const Pf = Pf_raw !== null ? Pf_raw * fr_factor : null;
  const dP_per_1000 = Pf && depth ? (Pf / depth) * 1000 : null;
  const BHTP = surfP !== null && Ph !== null && Pf !== null ? surfP + Ph - Pf : null;
  const fracGrad = BHTP && depth ? BHTP / depth : null;
  const capCT = ct_id ? capacity_bbl_per_ft(ct_id) : null;
  const strVol = capCT && depth ? capCT * depth : null;
  const hoopStress = surfP && ct_od && ct_id ? (surfP * ct_id) / (2 * (ct_od - ct_id) / 2) : null; // σθ = P·r / t
  const capAnn = casing && ct_od ? annCap_bbl_per_ft(casing, ct_od) : null;
  const A_ann = casing && ct_od ? areaCircle(casing) - areaCircle(ct_od) : null;
  const vAnn = v_annular_ftmin(q_bpm, A_ann);
  const fr_savings_pct = fr_load !== null && fr_load > 0 ? (1 - fr_factor) * 100 : null;

  const warnings = [];
  const MAX_CT_WP = 10000;
  if (surfP && surfP > MAX_CT_WP)
    warnings.push({ level: "danger", msg: `Surface pressure ${surfP.toFixed(0)} psi exceeds ${MAX_CT_WP} psi CT working pressure. IMMEDIATE shut-in (API Spec 5ST).` });
  else if (surfP && surfP > 0.9 * MAX_CT_WP)
    warnings.push({ level: "warn", msg: `Surface pressure at >90% CT working limit. Reduce rate or fluid weight.` });
  if (Pf && Pf > 5000)
    warnings.push({ level: "warn", msg: `Friction ${Pf.toFixed(0)} psi is very high — consider larger CT ID, reduce rate, or increase FR.` });
  if (fracGrad && fracGrad > 1.0)
    warnings.push({ level: "warn", msg: `Frac gradient ${fracGrad.toFixed(3)} psi/ft at/above overburden — verify formation.` });
  if (hoopStress && hoopStress > 0.8 * CT_YIELD_PSI)
    warnings.push({ level: "warn", msg: `CT hoop stress ${hoopStress.toFixed(0)} psi > 80% yield. Check remaining life on fatigue log.` });
  if (fr_load !== null && fr_load < 0.5)
    warnings.push({ level: "warn", msg: `FR loading ${fr_load.toFixed(2)} ${u==="imp"?"gpt":"L/m³"} is low for fracing through CT — 1.5–3.0 typical.` });

  const results = [
    { label: "Hydrostatic pressure", ...fmt(Ph, u, "pressure", 0), formula: "Ph = 0.052 · ρ · TVD" },
    { label: "CT friction pressure (net)", ...fmt(Pf, u, "pressure", 0), formula: "Fanning · FR factor", note: fr_load !== null ? `FR ${fr_load.toFixed(2)} ${u==="imp"?"gpt":"L/m³"} → ${(fr_factor*100).toFixed(0)}% of raw friction` : "no FR entered" },
    { label: "Friction gradient", ...fmt(dP_per_1000, u, "frictionK", 0) },
    { label: "Bottomhole treating pressure", ...fmt(BHTP, u, "pressure", 0), formula: "BHTP = Psurf + Ph − Pf" },
    { label: "Frac gradient", ...fmt(fracGrad, u, "pressureGradient", 3), note: "Typical 0.6–0.9 psi/ft" },
    { label: "CT internal volume", ...fmt(strVol, u, "volume", 1) },
    { label: "Annular velocity", ...fmt(vAnn, u, "velocity", 0) },
    { label: "CT hoop stress @ surface P", ...fmt(hoopStress, u, "pressure", 0), formula: "σθ = P · r / t", note: `Yield ${CT_YIELD_PSI/1000}k psi (CT-100)` },
    { label: "Annular capacity", ...fmt(capAnn, u, "capacity", 4) },
  ];
  if (fr_savings_pct !== null) {
    results.push({ label: "FR friction reduction", value: fr_savings_pct.toFixed(0), unit: "%", note: "Effective drag reduction from FR loading" });
  }

  return {
    results,
    warnings,
    formula: "BHTP = Psurf + 0.052·ρ·TVD − Pf·FR_factor  ·  Fanning ΔP = f·ρ·v²·L/(25.81·d)",
    reference: "API RP 5C7 · Bourgoyne et al. · Halliburton Red Book",
  };
}

function calc_Annular_Frac(vals, params, u) {
  const depth = grab(vals, params, u, ["base depth"]);
  const offset = grab(vals, params, u, ["offset"]);
  const surfP = grab(vals, params, u, ["treating p"]);
  const q_bpm = grab(vals, params, u, ["pump rate"]);
  const rho = grab(vals, params, u, ["density"]);
  const casing = grab(vals, params, u, ["casing id"]);
  const tubOD = grab(vals, params, u, ["tubing od"]);
  const fr_load = grab(vals, params, u, ["friction reducer"]);

  const trueDepth = depth !== null && offset !== null ? depth + offset : depth;
  const Ph = rho && trueDepth ? 0.052 * rho * trueDepth : null;
  const fr_factor = fr_load !== null && fr_load > 0
    ? Math.max(0.22, 1.0 - 0.30 * Math.log(1 + fr_load))
    : 1.0;
  const Pf_raw = annularFriction_psi(q_bpm, casing, tubOD, rho, 1, trueDepth);
  const Pf = Pf_raw !== null ? Pf_raw * fr_factor : null;
  const dP_per_1000 = Pf && trueDepth ? (Pf / trueDepth) * 1000 : null;
  const BHTP = surfP !== null && Ph !== null && Pf !== null ? surfP + Ph - Pf : null;
  const fracGrad = BHTP && trueDepth ? BHTP / trueDepth : null;
  const A_ann = casing && tubOD ? areaCircle(casing) - areaCircle(tubOD) : null;
  const vAnn = v_annular_ftmin(q_bpm, A_ann);
  const capAnn = casing && tubOD ? annCap_bbl_per_ft(casing, tubOD) : null;
  const totalVol = capAnn && trueDepth ? capAnn * trueDepth : null;

  const warnings = [];
  if (fracGrad && fracGrad > 1.0)
    warnings.push({ level: "warn", msg: `Frac gradient ${fracGrad.toFixed(3)} psi/ft — verify formation limits (AER Directive 009).` });
  if (surfP && surfP > 5000)
    warnings.push({ level: "warn", msg: `Surface pressure ${surfP.toFixed(0)} psi — verify wellhead / casing burst rating.` });
  if (fr_load !== null && fr_load < 0.5)
    warnings.push({ level: "warn", msg: `FR loading ${fr_load.toFixed(2)} ${u==="imp"?"gpt":"L/m³"} is low for annular frac — 1.0–2.5 typical.` });

  const results = [
    { label: "True vertical depth (stage)", ...fmt(trueDepth, u, "depth", 0) },
    { label: "Hydrostatic @ TVD", ...fmt(Ph, u, "pressure", 0) },
    { label: "Annular friction pressure (net)", ...fmt(Pf, u, "pressure", 0), formula: "Fanning · FR factor", note: fr_load !== null ? `FR ${fr_load.toFixed(2)} ${u==="imp"?"gpt":"L/m³"} → ${(fr_factor*100).toFixed(0)}% of raw friction` : "no FR entered" },
    { label: "Friction gradient", ...fmt(dP_per_1000, u, "frictionK", 0) },
    { label: "Bottomhole treating pressure", ...fmt(BHTP, u, "pressure", 0) },
    { label: "Frac gradient", ...fmt(fracGrad, u, "pressureGradient", 3) },
    { label: "Annular velocity", ...fmt(vAnn, u, "velocity", 0) },
    { label: "Annular capacity", ...fmt(capAnn, u, "capacity", 4) },
    { label: "Total annular volume", ...fmt(totalVol, u, "volume", 1) },
  ];

  return {
    results,
    warnings,
    formula: "BHTP = Psurf + 0.052·ρ·TVD − Pf·FR_factor  ·  Fanning w/ d_h = D−d",
    reference: "AER Directive 009 · API RP 13D · Bourgoyne et al.",
  };
}

function calc_Mechanical_Sleeve(vals, params, u) {
  const depth = grab(vals, params, u, ["base depth"]);
  const offset = grab(vals, params, u, ["offset"]);
  const shiftF = grab(vals, params, u, ["shift force"]);
  const drag = grab(vals, params, u, ["string drag"]);

  const tvd = depth !== null && offset !== null ? depth + offset : depth;
  const requiredSurface = shiftF !== null && drag !== null ? shiftF + drag : null;
  // Default CT-100 1.5×1.25 for yield reference
  const ct_od = 1.5, ct_id = 1.25;
  const wA = wallArea(ct_od, ct_id);
  const yieldF = wA * CT_YIELD_PSI;
  const maxSafe = yieldF * 0.8;
  const utilisation = requiredSurface && maxSafe ? (requiredSurface / maxSafe) * 100 : null;

  const warnings = [];
  if (utilisation !== null && utilisation > 100)
    warnings.push({ level: "danger", msg: `Required surface pull ${requiredSurface.toFixed(0)} lb is >80% of Fy (${maxSafe.toFixed(0)} lb). Do NOT force — use hydraulic option.` });
  else if (utilisation !== null && utilisation > 75)
    warnings.push({ level: "warn", msg: `Surface pull utilisation ${utilisation.toFixed(0)}% — approaching yield limit.` });

  return {
    results: [
      { label: "Sleeve TVD", ...fmt(tvd, u, "depth", 0) },
      { label: "Required surface force", ...fmt(requiredSurface, u, "force", 0), formula: "Fsurf = Fshift + Fdrag" },
      { label: "CT yield force (assumed 1.5×1.25 CT-100)", ...fmt(yieldF, u, "force", 0), formula: "Fy = σy · A" },
      { label: "Max safe surface pull (0.80 × Fy)", ...fmt(maxSafe, u, "force", 0) },
      { label: "Utilisation of safe max", ...fmt(utilisation, u, "percent", 0), note: "Keep < 100% per API RP 5C7" },
    ],
    warnings,
    formula: "Fsurf = Fshift + Fdrag  ·  Fmax = 0.80·σy·A",
    reference: "API Spec 11D1 · API RP 5C7",
  };
}

function calc_Hydraulic_Sleeve(vals, params, u) {
  const depth = grab(vals, params, u, ["base depth"]);
  const offset = grab(vals, params, u, ["offset"]);
  const target = grab(vals, params, u, ["target p"]);
  const tvd = depth !== null && offset !== null ? depth + offset : depth;

  const A_piston = 4.19; // in² (nominal 3.5" tool)
  const F_shift = target !== null ? target * A_piston : null;
  const warnings = [];
  const MAX_WP = 7500;
  if (target && target > MAX_WP)
    warnings.push({ level: "warn", msg: `Target ${target.toFixed(0)} psi above typical 7500 psi sleeve rating — verify tool spec.` });

  return {
    results: [
      { label: "Sleeve TVD", ...fmt(tvd, u, "depth", 0) },
      { label: "Piston area (assumed 3.5″ tool)", ...fmt(A_piston, u, "area", 2) },
      { label: "Shift force at ΔP", ...fmt(F_shift, u, "force", 0), formula: "F = ΔP · A_piston" },
      { label: "Applied surface pressure target", ...fmt(target, u, "pressure", 0) },
    ],
    warnings,
    formula: "F_shift = ΔP · A_piston",
    reference: "API Spec 11D1 · Tool OEM Spec",
  };
}

function calc_Nitrogen_Purge(vals, params, u) {
  const tid = grab(vals, params, u, ["tubing id"]);
  const surfP = grab(vals, params, u, ["surface p"]);
  const rate = grab(vals, params, u, ["n2 rate"]);
  const depth = grab(vals, params, u, ["current depth"]);

  const cap = tid ? capacity_bbl_per_ft(tid) : null;
  const sysVol_bbl = cap && depth ? cap * depth : null;
  const scfRequired = sysVol_bbl && surfP !== null ? sysVol_bbl * 5.615 * ((surfP + 14.7) / 14.7) * 3 : null;
  const purgeTime = scfRequired && rate ? scfRequired / rate : null;

  const warnings = [];
  if (purgeTime && purgeTime > 120)
    warnings.push({ level: "warn", msg: `Purge time ${purgeTime.toFixed(0)} min exceeds 2 h — verify N₂ supply and thermal drift.` });

  return {
    results: [
      { label: "Tubing capacity", ...fmt(cap, u, "capacity", 4) },
      { label: "System volume", ...fmt(sysVol_bbl, u, "volume", 2) },
      { label: "N₂ required (3× purge)", ...fmt(scfRequired, u, "scf", 0), formula: "V = 3·Vsys·(P+14.7)/14.7 · 5.615" },
      { label: "Purge time @ set rate", ...fmt(purgeTime, u, "time", 0) },
    ],
    warnings,
    formula: "SCF = 3 · Vsys · (P+14.7)/14.7 · 5.615  (isothermal, CGA G-10.1)",
    reference: "CGA G-10.1 · CSA Z662 §14",
  };
}

function calc_Nitrogen_Kickoff(vals, params, u) {
  const depth = grab(vals, params, u, ["depth"]);
  const grad = grab(vals, params, u, ["gradient"]);
  const rate = grab(vals, params, u, ["n2 rate"]);
  const staticL = grab(vals, params, u, ["static level"]);

  const columnP = grad && depth ? grad * depth : null;
  const dryDepth = depth !== null && staticL !== null ? depth - staticL : null;
  const liftPressure = grad && dryDepth ? grad * dryDepth : null;
  const capCol = 0.0012;
  const scfNeeded = capCol && dryDepth && liftPressure ? capCol * dryDepth * 5.615 * ((liftPressure + 14.7) / 14.7) : null;
  const timeMin = scfNeeded && rate ? scfNeeded / rate : null;

  const warnings = [];
  if (liftPressure && liftPressure > 2000)
    warnings.push({ level: "warn", msg: `Lift pressure ${liftPressure.toFixed(0)} psi is high — verify N₂ pump capacity.` });

  return {
    results: [
      { label: "Static column pressure", ...fmt(columnP, u, "pressure", 0), formula: "P = g · TVD" },
      { label: "Dry depth to unload", ...fmt(dryDepth, u, "depth", 0) },
      { label: "Lift pressure required", ...fmt(liftPressure, u, "pressure", 0) },
      { label: "N₂ required (est.)", ...fmt(scfNeeded, u, "scf", 0) },
      { label: "Kickoff time @ rate", ...fmt(timeMin, u, "time", 0) },
    ],
    warnings,
    formula: "P_lift = grad · (TVD − Static level)",
    reference: "API Spec 11V2 · CGA G-10.1",
  };
}

function calc_Acid_Stimulation(vals, params, u) {
  const acidV = grab(vals, params, u, ["acid vol"]);
  const rate = grab(vals, params, u, ["pump rate"]);
  const bht = grab(vals, params, u, ["bht"]);
  const depth = grab(vals, params, u, ["depth"]);
  const ct_id = grab(vals, params, u, ["ct id"]);

  const capCT = ct_id ? capacity_bbl_per_ft(ct_id) : null;
  const displaceVol = capCT && depth ? capCT * depth : null;
  const overflushVol = acidV ? acidV * 1.5 : null;
  const pumpTime = acidV && rate ? acidV / rate : null;
  const totalPumpTime = pumpTime !== null && overflushVol && rate ? pumpTime + overflushVol / rate : null;
  const reactionHalfLife = bht !== null ? 60 * Math.pow(0.5, Math.max(0, (bht - 100) / 10)) : null;

  const warnings = [];
  if (bht !== null && bht > 200)
    warnings.push({ level: "warn", msg: `BHT ${bht.toFixed(0)}°F is high — use retarded acid system (Nierode-Williams).` });
  if (rate !== null && rate < 0.5)
    warnings.push({ level: "warn", msg: `Low pump rate — acid may pre-spend before reaching perforations.` });

  return {
    results: [
      { label: "CT internal capacity", ...fmt(capCT, u, "capacity", 4) },
      { label: "Displacement volume", ...fmt(displaceVol, u, "volume", 2) },
      { label: "Overflush (1.5×)", ...fmt(overflushVol, u, "volume", 2) },
      { label: "Acid pump time", ...fmt(pumpTime, u, "time", 1) },
      { label: "Total treatment time", ...fmt(totalPumpTime, u, "time", 1) },
      { label: "Reaction half-life (est.)", ...fmt(reactionHalfLife, u, "time", 1), formula: "Nierode-Williams (simplified)" },
    ],
    warnings,
    formula: "Vd = capCT·TVD  ·  Vof = 1.5·Vacid  ·  t = V/Q",
    reference: "AER Dir 035 · Nierode & Williams (1971)",
  };
}

function calc_Scale_Squeeze(vals, params, u) {
  const inh = grab(vals, params, u, ["inhibitor vol"]);
  const rate = grab(vals, params, u, ["pump rate"]);
  const interval = grab(vals, params, u, ["perforated interval"]);
  const casing = grab(vals, params, u, ["casing id"]);
  const temp = grab(vals, params, u, ["formation temp"]);

  const A_int = casing ? areaCircle(casing) : null;
  const poreV = A_int && interval ? (A_int * interval * 12) / 9701.9 * 0.2 : null;
  const inhConcentration = inh && poreV ? (inh / poreV) * 100 : null;
  const pumpTime = inh && rate ? inh / rate : null;
  const shutInHrs = temp !== null && temp > 150 ? 24 : 48;

  const warnings = [];
  if (inhConcentration !== null && inhConcentration < 150)
    warnings.push({ level: "warn", msg: `Inhibitor covers only ${inhConcentration.toFixed(0)}% of pore volume — target 200–300% for effective squeeze.` });

  return {
    results: [
      { label: "Perf interval pore volume (est.)", ...fmt(poreV, u, "volume", 2), note: "φ = 20% assumed" },
      { label: "Inhibitor coverage", ...fmt(inhConcentration, u, "percent", 0), note: "Target 200–300%" },
      { label: "Pump time", ...fmt(pumpTime, u, "time", 1) },
      { label: "Recommended shut-in", ...fmt(shutInHrs, u, "hoursShutIn", 0), note: temp !== null ? (temp > 150 ? "Hot well — 24 h" : "48 h standard") : "" },
    ],
    warnings,
    formula: "Vpore ≈ A·L·φ  ·  Coverage = Vinh / Vpore",
    reference: "SPE 87458 · NACE SP0106",
  };
}

function calc_Cement_Plug(vals, params, u) {
  const rho = grab(vals, params, u, ["slurry wt"]);
  const slurryV = grab(vals, params, u, ["slurry vol"]);
  const casing = grab(vals, params, u, ["casing id"]);
  const yieldSk = grab(vals, params, u, ["yield"]);
  const depth = grab(vals, params, u, ["current depth"]);

  const capHole = casing ? (casing * casing) / 1029.4 : null;
  const plugHeight = slurryV && capHole ? slurryV / capHole : null;
  const sacks = slurryV && yieldSk ? (slurryV * 5.615) / yieldSk : null;
  const P_hydCement = rho && plugHeight ? 0.052 * rho * plugHeight : null;
  const plugTop = depth !== null && plugHeight !== null ? depth - plugHeight : null;
  const AER_MIN = 165;

  const warnings = [];
  if (plugHeight !== null && plugHeight < AER_MIN)
    warnings.push({ level: "danger", msg: `Plug height ${plugHeight.toFixed(0)} ft is below AER Directive 020 minimum 165 ft (50 m). Increase slurry volume.` });
  if (rho !== null && rho < 14)
    warnings.push({ level: "warn", msg: `Slurry weight ${rho.toFixed(1)} ppg is light — verify against formation pressures.` });

  return {
    results: [
      { label: "Hole capacity", ...fmt(capHole, u, "capacity", 4) },
      { label: "Plug height", ...fmt(plugHeight, u, "depth", 0), formula: "H = V / capHole", note: "AER Dir 020 min 165 ft (50 m)" },
      { label: "Cement sacks", ...fmt(sacks, u, "sacks", 1), formula: "sk = V · 5.615 / Yield" },
      { label: "Slurry hydrostatic", ...fmt(P_hydCement, u, "pressure", 0) },
      { label: "Plug top depth (est.)", ...fmt(plugTop, u, "depth", 0) },
    ],
    warnings,
    formula: "Vslurry = capHole · H_plug  ·  sk = V·5.615 / Yield",
    reference: "AER Directive 020 §4 · API RP 10B",
  };
}

function calc_Well_Abandonment(vals, params, u) {
  const cur = grab(vals, params, u, ["current depth"]);
  const plug = grab(vals, params, u, ["plug depth"]);
  const cemV = grab(vals, params, u, ["cement vol"]);
  const rho = grab(vals, params, u, ["slurry wt"]);
  const casing = grab(vals, params, u, ["casing id"]);

  const capHole = casing ? (casing * casing) / 1029.4 : null;
  const plugHeight = cemV && capHole ? cemV / capHole : null;
  const P_hyd = rho && plug ? 0.052 * rho * plug : null;
  const AER_MIN = 165;

  const warnings = [];
  if (plugHeight !== null && plugHeight < AER_MIN)
    warnings.push({ level: "danger", msg: `Plug height ${plugHeight.toFixed(0)} ft is below AER Dir 020 minimum 165 ft (50 m). Non-compliant.` });
  if (cur !== null && plug !== null && cur < plug)
    warnings.push({ level: "warn", msg: `Current depth is above plug depth — verify TOC calculation.` });

  return {
    results: [
      { label: "Plug height achieved", ...fmt(plugHeight, u, "depth", 0), note: "AER Dir 020 min 165 ft (50 m)" },
      { label: "Cement volume required", ...fmt(cemV, u, "volume", 2) },
      { label: "Hydrostatic at plug", ...fmt(P_hyd, u, "pressure", 0) },
      { label: "Compliance", value: plugHeight !== null && plugHeight >= AER_MIN ? "PASS" : "FAIL", unit: "AER Dir 020", note: "Two-plug barrier still required" },
    ],
    warnings,
    formula: "H_plug = Vcem / capHole",
    reference: "AER Directive 020 · CSA Z625",
  };
}

function calc_CT_Perforating(vals, params, u) {
  const depth = grab(vals, params, u, ["depth"]);
  const gunOD = grab(vals, params, u, ["gun od"]);
  const casing = grab(vals, params, u, ["casing id"]);
  const firingP = grab(vals, params, u, ["firing p"]);

  const clearance = casing !== null && gunOD !== null ? (casing - gunOD) / 2 : null;
  const minClearance = 0.25;

  const warnings = [];
  if (clearance !== null && clearance < minClearance)
    warnings.push({ level: "warn", msg: `Radial clearance ${(clearance * 25.4).toFixed(1)} mm is below 6 mm (0.25 in) minimum — risk of hang-up.` });
  if (firingP && firingP < 500)
    warnings.push({ level: "warn", msg: `Firing pressure ${firingP} psi is low — verify actuator spec.` });

  return {
    results: [
      { label: "Gun run depth", ...fmt(depth, u, "depth", 0) },
      { label: "Radial clearance", ...fmt(clearance, u, "diameter", 3), note: "Min 0.25 in (6 mm)" },
      { label: "Firing pressure", ...fmt(firingP, u, "pressure", 0) },
    ],
    warnings,
    formula: "Clearance = (D_casing − D_gun) / 2",
    reference: "API RP 67 · API RP 5C3",
  };
}

function calc_Fishing_Ops(vals, params, u) {
  const fishWt = grab(vals, params, u, ["fish wt"]);
  const jarOP = grab(vals, params, u, ["jar overpull"]);
  const tubOD = grab(vals, params, u, ["tubing od"]);

  // Assume 0.125" wall thickness for CT
  const wallA = tubOD ? wallArea(tubOD, tubOD - 0.25) : null;
  const yieldF = wallA ? wallA * CT_YIELD_PSI : null;
  const tensileF = wallA ? wallA * CT_TENSILE_PSI : null;
  const maxSafe = yieldF ? yieldF * 0.7 : null;
  const totalPull = fishWt !== null && jarOP !== null ? fishWt + jarOP : null;
  const util = totalPull && maxSafe ? (totalPull / maxSafe) * 100 : null;

  const warnings = [];
  if (util !== null && util > 100)
    warnings.push({ level: "danger", msg: `Combined pull ${totalPull.toFixed(0)} lb exceeds 70% of yield safe limit. STOP — risk of parting.` });
  else if (util !== null && util > 80)
    warnings.push({ level: "warn", msg: `Pull utilisation ${util.toFixed(0)}% — monitor fatigue log closely.` });

  return {
    results: [
      { label: "CT yield force", ...fmt(yieldF, u, "force", 0), formula: "Fy = σy · A" },
      { label: "CT ultimate tensile", ...fmt(tensileF, u, "force", 0) },
      { label: "Max safe pull (0.70 × Fy)", ...fmt(maxSafe, u, "force", 0), note: "Fishing-conservative per API RP 5C7" },
      { label: "Total combined pull", ...fmt(totalPull, u, "force", 0), formula: "Ftotal = Ffish + Fjar" },
      { label: "Utilisation of safe max", ...fmt(util, u, "percent", 0) },
    ],
    warnings,
    formula: "Ftotal = Wfish + Fjar  ·  Fmax = 0.70·σy·A (fishing)",
    reference: "API RP 5C7 §12 · API Spec 7-1",
  };
}

const CALCULATORS = {
  Pipe_Stretch: calc_Pipe_Stretch,
  Sand_Cleanout: calc_Sand_Cleanout,
  CT_Milling: calc_CT_Milling,
  CT_Drilling: calc_CT_Drilling,
  Pill_Spotting: calc_Pill_Spotting,
  Frac_Through_CT: calc_Frac_Through_CT,
  Annular_Frac: calc_Annular_Frac,
  Mechanical_Sleeve: calc_Mechanical_Sleeve,
  Hydraulic_Sleeve: calc_Hydraulic_Sleeve,
  Nitrogen_Purge: calc_Nitrogen_Purge,
  Nitrogen_Kickoff: calc_Nitrogen_Kickoff,
  Acid_Stimulation: calc_Acid_Stimulation,
  Scale_Squeeze: calc_Scale_Squeeze,
  Cement_Plug: calc_Cement_Plug,
  Well_Abandonment: calc_Well_Abandonment,
  CT_Perforating: calc_CT_Perforating,
  Fishing_Ops: calc_Fishing_Ops,
};

export function computeResults(sheetKey, values, params, unitSystem) {
  const fn = CALCULATORS[sheetKey];
  if (!fn) return null;
  try {
    return fn(values, params, unitSystem);
  } catch (e) {
    return { results: [], warnings: [{ level: "warn", msg: "Calculation error — check inputs." }], formula: "", reference: "" };
  }
}
