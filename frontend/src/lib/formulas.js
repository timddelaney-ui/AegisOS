/*
 * CT Field Workbook — Industry-standard formulas & safe-operating-limit checks.
 *
 * References baked in:
 *   API RP 5C7  — Coiled Tubing Operations (mechanical / free-point / running loads)
 *   API RP 5C3  — CT wall stress / yield
 *   API RP 13D  — Rheology / hydraulics
 *   API Spec 5ST — CT material grades
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
  m3_to_bbl: (m3) => m3 * 6.28981,
  bbl_to_m3: (b) => b / 6.28981,
  Lmin_to_bpm: (L) => L * 0.00628981,
  bpm_to_Lmin: (b) => b / 0.00628981,
  kgm3_to_ppg: (k) => k / 119.826,
  ppg_to_kgm3: (p) => p * 119.826,
  scfm_to_sm3min: (s) => s * 0.0283168,
  sm3min_to_scfm: (s) => s / 0.0283168,
  C_to_F: (c) => (c * 9) / 5 + 32,
  F_to_C: (f) => ((f - 32) * 5) / 9,
};

// -------- Value extraction ---------------------------------------------------
// Find a numeric value from the sheet's inputs by matching parameter label patterns.
// Always returns the value normalised to Imperial (canonical) units for calculations.
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
      if (l.includes("(m)") && !l.includes("mm")) return conv.m_to_ft(raw);
      if (l.includes("(daN)")) return conv.daN_to_lb(raw);
      if (l.includes("(mpa)")) return conv.MPa_to_psi(raw);
      if (l.includes("(m3)")) return conv.m3_to_bbl(raw);
      if (l.includes("(l/min)")) return conv.Lmin_to_bpm(raw);
      if (l.includes("(kg/m3)")) return conv.kgm3_to_ppg(raw);
      if (l.includes("(sm3/min)")) return conv.sm3min_to_scfm(raw);
      if (l.includes("(deg c)")) return conv.C_to_F(raw);
      return raw;
    }
  }
  return null;
}

// -------- Presenter helper ---------------------------------------------------
// Format an Imperial value into the user's unit system for display.
function present(value, unitPair, decimals = 2) {
  if (value === null || value === undefined || isNaN(value))
    return { value: "—", unit: unitPair.imp };
  return { value: Number(value).toFixed(decimals), unit: unitPair.imp };
}
function presentMetric(imperialValue, converter, unitLabel, decimals = 2) {
  if (imperialValue === null || isNaN(imperialValue)) return { value: "—", unit: unitLabel };
  return { value: Number(converter(imperialValue)).toFixed(decimals), unit: unitLabel };
}
function display(imperialValue, unitSystem, impUnit, metricConverter, metricUnit, decimals = 2) {
  if (imperialValue === null || imperialValue === undefined || isNaN(imperialValue))
    return { value: "—", unit: unitSystem === "imp" ? impUnit : metricUnit };
  const v = unitSystem === "imp" ? imperialValue : metricConverter(imperialValue);
  return { value: Number(v).toFixed(decimals), unit: unitSystem === "imp" ? impUnit : metricUnit };
}

// Standard material properties
const E_STEEL_PSI = 30_000_000; // Young's modulus of steel per API 5C3
const CT_YIELD_PSI = 100_000;   // CT-100 grade nominal yield (API Spec 5ST)
const CT_TENSILE_PSI = 110_000; // Nominal ultimate tensile
const WATER_LB_GAL = 8.33;

// Cross-section helpers
const areaCircle = (d) => (Math.PI / 4) * d * d; // in²  from d in inches
const wallArea = (od, id) => areaCircle(od) - areaCircle(id); // in²
const capacity_bbl_per_ft = (id_in) => (id_in * id_in) / 1029.4; // API RP 13D
const annCap_bbl_per_ft = (dCase, dCT) =>
  (dCase * dCase - dCT * dCT) / 1029.4;
const ct_weight_per_ft = (od, id) => wallArea(od, id) * 3.4; // lb/ft (steel density ≈ 490 lb/ft³ × in²→ft²)

// -------- Individual sheet calculators ---------------------------------------

function calc_Pipe_Stretch(vals, params, u) {
  const stretch_in = grab(vals, params, u, ["stretch"]);         // in
  const overpull_lb = grab(vals, params, u, ["overpull"]);        // lbs
  const ct_od = grab(vals, params, u, ["ct od"]);                 // in
  const ct_id = grab(vals, params, u, ["ct id"]);                 // in
  const depth_ft = grab(vals, params, u, ["current depth"]);      // ft

  const wA = ct_od && ct_id ? wallArea(ct_od, ct_id) : null;      // in²
  // Free-point depth: L(in) = ΔL × E × A / F  →  ÷12 = ft
  const freept_ft =
    stretch_in && overpull_lb && wA
      ? (stretch_in * E_STEEL_PSI * wA) / overpull_lb / 12
      : null;
  const stuckPct = freept_ft && depth_ft ? (freept_ft / depth_ft) * 100 : null;
  const yieldForce = wA ? CT_YIELD_PSI * wA : null;               // lb
  const maxSafeOverpull = yieldForce ? yieldForce * 0.8 : null;   // 80% yield (API RP 5C7 §9.4)

  const warnings = [];
  if (overpull_lb && maxSafeOverpull && overpull_lb > maxSafeOverpull)
    warnings.push({
      level: "danger",
      msg: `Overpull ${overpull_lb.toFixed(0)} lb exceeds 80% of CT yield (${maxSafeOverpull.toFixed(
        0
      )} lb). Risk of parting. Reduce pull immediately (API RP 5C7).`,
    });
  else if (overpull_lb && yieldForce && overpull_lb > 0.6 * yieldForce)
    warnings.push({
      level: "warn",
      msg: `Overpull is within 60–80% of yield — caution. Verify grade and bending history.`,
    });

  const results = [
    {
      label: "Free-point depth",
      ...display(freept_ft, u, "ft", conv.ft_to_m, "m", 0),
      formula: "L = ΔL · E · A / F",
      note: "Depth to stuck point from surface",
    },
    {
      label: "Stuck-point ratio",
      value: stuckPct !== null ? stuckPct.toFixed(1) : "—",
      unit: "% of current depth",
      note: stuckPct !== null && stuckPct > 95 ? "Near bottom — string likely free" : "",
    },
    {
      label: "CT wall cross-section",
      value: wA !== null ? wA.toFixed(4) : "—",
      unit: "in²",
      note: `≈ ${wA ? (wA * 645.16).toFixed(1) : "—"} mm²`,
    },
    {
      label: "Max safe overpull (0.80 × Fy)",
      ...display(maxSafeOverpull, u, "lb", conv.lb_to_daN, "daN", 0),
      formula: "Fmax = 0.80 · σy · A",
      note: "Per API RP 5C7 §9.4 — do not exceed",
    },
  ];
  return {
    results,
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

  const A_ann_in2 =
    casing_id && tubing_od ? areaCircle(casing_id) - areaCircle(tubing_od) : null;
  // V_ann (ft/min) = Q(BPM) × 9701.9 / A(in²) / 12
  const v_ann_ftmin = q_bpm && A_ann_in2 ? (q_bpm * 9701.9) / A_ann_in2 / 12 : null;
  const annCap = casing_id && tubing_od ? annCap_bbl_per_ft(casing_id, tubing_od) : null;
  const annVol = annCap && depth_ft ? annCap * depth_ft : null;
  const bottomsUp_min = annVol && q_bpm ? annVol / q_bpm : null;

  // Slip velocity (Moore correlation, Newtonian assumption, sand SG=2.65)
  // v_slip ≈ 175 × d_p^0.667 × ((ρs-ρf)/ρf)^0.667 / μ^0.333 (ft/min)
  // Use particle diameter 0.03 in (0.76 mm typical formation sand)
  const dp = 0.03; // in
  const rho_ratio = (2.65 - 1.0) / 1.0;
  const v_slip = visc ? 175 * Math.pow(dp, 0.667) * Math.pow(rho_ratio, 0.667) / Math.pow(visc, 0.333) : null;
  const transportRatio = v_ann_ftmin && v_slip ? v_ann_ftmin / v_slip : null;

  const warnings = [];
  if (v_ann_ftmin !== null && v_ann_ftmin < 100)
    warnings.push({
      level: "warn",
      msg: `Annular velocity ${v_ann_ftmin.toFixed(0)} ft/min is below the 100 ft/min minimum for vertical solids transport. Increase pump rate or reduce annular clearance.`,
    });
  if (transportRatio !== null && transportRatio < 1.5)
    warnings.push({
      level: "warn",
      msg: `Transport ratio ${transportRatio.toFixed(2)} — below industry 1.5× rule of thumb. Cuttings may fall back.`,
    });

  const results = [
    {
      label: "Annular velocity",
      ...display(v_ann_ftmin, u, "ft/min", (x) => x * 0.3048, "m/min", 0),
      formula: "Va = Q · 9701.9 / A / 12",
      note: "≥ 100 ft/min recommended (Moore)",
    },
    { label: "Annular capacity", value: annCap ? annCap.toFixed(4) : "—", unit: "bbl/ft", note: "" },
    {
      label: "Total annular volume",
      ...display(annVol, u, "bbl", conv.bbl_to_m3, "m³", 1),
    },
    {
      label: "Bottoms-up circulation time",
      value: bottomsUp_min !== null ? bottomsUp_min.toFixed(1) : "—",
      unit: "min",
      note: "Circulate ≥ 1.5 BU after tag",
    },
    {
      label: "Slip velocity (est.)",
      ...display(v_slip, u, "ft/min", (x) => x * 0.3048, "m/min", 1),
      formula: "Moore (1974)",
    },
    {
      label: "Transport ratio (Va/Vs)",
      value: transportRatio !== null ? transportRatio.toFixed(2) : "—",
      unit: "×",
      note: "Target ≥ 1.5×",
    },
  ];
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
  const surfWt = grab(vals, params, u, ["surface wt"]);
  const upWt = grab(vals, params, u, ["up weight"]);
  const q_bpm = grab(vals, params, u, ["pump rate"]);
  const rho = grab(vals, params, u, ["density"]);

  const WOB = surfWt !== null && upWt !== null ? surfWt - upWt : null;    // lb
  const q_gpm = q_bpm !== null ? q_bpm * 42 : null;
  // Pressure loss friction (empirical for CT): dP/1000ft ≈ 0.017 × Q^1.86 / d^4.86 × ρ/8.33   psi/1000ft
  const dP_per_1000 =
    q_bpm !== null && ct_id
      ? 0.017 * Math.pow(q_gpm, 1.86) / Math.pow(ct_id, 4.86) * (rho ? rho / WATER_LB_GAL : 1)
      : null;
  const dP_total = dP_per_1000 && depth ? (dP_per_1000 * depth) / 1000 : null;
  const P_hydrostatic = rho && depth ? 0.052 * rho * depth : null;
  const HHP = q_gpm && dP_total ? (dP_total * q_gpm) / 1714 : null;
  const A_ann = casing_id && ct_od ? areaCircle(casing_id) - areaCircle(ct_od) : null;
  const v_ann = q_bpm && A_ann ? (q_bpm * 9701.9) / A_ann / 12 : null;
  const capCT = ct_id ? capacity_bbl_per_ft(ct_id) : null;
  const buoyed_wt_perft = ct_od && ct_id && rho ? ct_weight_per_ft(ct_od, ct_id) * (1 - rho / 65.4) : null;
  const buoyed_string_wt = buoyed_wt_perft && depth ? buoyed_wt_perft * depth : null;

  const warnings = [];
  if (WOB !== null && WOB > 2000)
    warnings.push({
      level: "warn",
      msg: `WOB ${WOB.toFixed(0)} lb exceeds 2000 lb — sinusoidal buckling risk. Consider tractor or larger CT (API RP 5C7 §7.3).`,
    });
  if (WOB !== null && WOB < 0)
    warnings.push({
      level: "warn",
      msg: `Negative WOB — mill is not tagged. Confirm tag depth before pumping.`,
    });
  if (v_ann !== null && v_ann < 90)
    warnings.push({
      level: "warn",
      msg: `Annular velocity ${v_ann.toFixed(0)} ft/min may be insufficient for cuttings transport.`,
    });

  const results = [
    { label: "Weight on Bit (WOB)", ...display(WOB, u, "lb", conv.lb_to_daN, "daN", 0), formula: "WOB = SurfWt − UpWt", note: "Target 500–1500 lb for composite" },
    { label: "Pump rate", value: q_gpm !== null ? q_gpm.toFixed(1) : "—", unit: "gpm", note: `= ${q_bpm !== null ? q_bpm.toFixed(2) : "—"} BPM` },
    { label: "CT friction pressure", ...display(dP_total, u, "psi", conv.psi_to_MPa, "MPa", 0), formula: "dP = 0.017 · Q^1.86 / d^4.86 · ρ/8.33" },
    { label: "Friction per 1000 ft", ...display(dP_per_1000, u, "psi/1000ft", (x) => conv.psi_to_MPa(x) / 0.3048 * 1000, "MPa/1000m", 0) },
    { label: "Hydrostatic pressure", ...display(P_hydrostatic, u, "psi", conv.psi_to_MPa, "MPa", 0), formula: "Ph = 0.052 · ρ · TVD" },
    { label: "Hydraulic HP (surface)", value: HHP !== null ? HHP.toFixed(1) : "—", unit: "HHP", formula: "HHP = ΔP·Q / 1714" },
    { label: "Annular velocity", ...display(v_ann, u, "ft/min", (x) => x * 0.3048, "m/min", 0), note: "≥ 100 ft/min for cuttings" },
    { label: "CT internal capacity", value: capCT ? capCT.toFixed(4) : "—", unit: "bbl/ft" },
    { label: "Buoyed string weight", ...display(buoyed_string_wt, u, "lb", conv.lb_to_daN, "daN", 0) },
  ];
  return {
    results,
    warnings,
    formula: "WOB = SurfWt−UpWt · dP = f(Q, d, ρ) · HHP = ΔP·Q/1714",
    reference: "API RP 5C7 §7 · API RP 13D · IADC/SPE 130580",
  };
}

function calc_CT_Drilling(vals, params, u) {
  const base = calc_CT_Milling(vals, params, u); // shares hydraulics
  const rop = grab(vals, params, u, ["rop"]);
  const casing_id = grab(vals, params, u, ["casing id"]);
  const ct_od = grab(vals, params, u, ["ct od"]);
  const rate_bpm = grab(vals, params, u, ["pump rate"]);

  const A_hole = casing_id ? areaCircle(casing_id) : null;
  // Cuttings generation rate: ROP × A_hole × (1 - porosity 0.2) [in² × ft/hr]
  // Convert to bbl/hr: A(in²) × ft/hr × 1/9701.9 (bbl/(in²·ft))^-1 → nope
  // bbl/hr = A(in²) × 12(in/ft is wrong) ... use: volume rate bbl/hr = A(in²) × ROP(ft/hr) / 231 (in³/gal) / 42 (gal/bbl)
  // Simpler: A × ROP → in²·ft/hr → in³ = ×12 → bbl = /9701.9
  const cuttings_bbl_hr = A_hole && rop ? (A_hole * rop * 12 * 0.8) / 9701.9 : null;
  const A_ann = casing_id && ct_od ? areaCircle(casing_id) - areaCircle(ct_od) : null;
  const v_ann = rate_bpm && A_ann ? (rate_bpm * 9701.9) / A_ann / 12 : null;
  // Concentration in return: cuttings / (mud flow + cuttings)  ×100
  const mud_bbl_hr = rate_bpm ? rate_bpm * 60 : null;
  const conc_pct =
    cuttings_bbl_hr && mud_bbl_hr ? (cuttings_bbl_hr / (mud_bbl_hr + cuttings_bbl_hr)) * 100 : null;

  const extras = [
    { label: "Cuttings generation", value: cuttings_bbl_hr !== null ? cuttings_bbl_hr.toFixed(2) : "—", unit: "bbl/hr", formula: "V̇ = ROP · A · (1−φ)" },
    { label: "Cuttings concentration in return", value: conc_pct !== null ? conc_pct.toFixed(2) : "—", unit: "%", note: "Keep below 5% by volume" },
    { label: "Annular velocity", ...display(v_ann, u, "ft/min", (x) => x * 0.3048, "m/min", 0) },
  ];
  const warnings = [...base.warnings];
  if (conc_pct !== null && conc_pct > 5)
    warnings.push({ level: "warn", msg: `Return cuttings concentration ${conc_pct.toFixed(1)}% > 5%. Reduce ROP or increase flow rate.` });

  return {
    results: [...base.results, ...extras],
    warnings,
    formula: base.formula + " · V̇cuttings = ROP·A·(1−φ)",
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
  // Displacement to place pill top at target depth:
  const displaceVol = capInt && tgt ? capInt * tgt : null;         // pump this much to spot at target
  const pillLenInt = pillV && capInt ? pillV / capInt : null;      // ft of pill inside CT
  const pillLenAnn = pillV && capAnn ? pillV / capAnn : null;      // ft of pill in annulus at target
  const timePump = displaceVol && rate ? displaceVol / rate : null;
  const P_hyd_at_target = rho && tgt ? 0.052 * rho * tgt : null;

  const warnings = [];
  if (displaceVol !== null && rate !== null && rate < 0.5)
    warnings.push({ level: "warn", msg: `Pump rate ${rate.toFixed(2)} BPM is very low — placement uncertainty increases.` });

  const results = [
    { label: "Distance to target", ...display(distance, u, "ft", conv.ft_to_m, "m", 0) },
    { label: "CT internal capacity", value: capInt ? capInt.toFixed(4) : "—", unit: "bbl/ft" },
    { label: "Annular capacity", value: capAnn ? capAnn.toFixed(4) : "—", unit: "bbl/ft" },
    { label: "Displacement volume to spot", ...display(displaceVol, u, "bbl", conv.bbl_to_m3, "m³", 2), formula: "Vd = capCT · Depth" },
    { label: "Pill length in CT", ...display(pillLenInt, u, "ft", conv.ft_to_m, "m", 0) },
    { label: "Pill length in annulus", ...display(pillLenAnn, u, "ft", conv.ft_to_m, "m", 0), note: "Coverage over target zone" },
    { label: "Total pump time", value: timePump !== null ? timePump.toFixed(1) : "—", unit: "min", formula: "t = Vd / Q" },
    { label: "Hydrostatic @ target", ...display(P_hyd_at_target, u, "psi", conv.psi_to_MPa, "MPa", 0) },
  ];
  return {
    results,
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

  const q_gpm = q_bpm ? q_bpm * 42 : null;
  const Ph = rho && depth ? 0.052 * rho * depth : null;
  const dP_per_1000 =
    q_bpm !== null && ct_id
      ? (0.017 * Math.pow(q_gpm, 1.86) / Math.pow(ct_id, 4.86)) * (rho ? rho / WATER_LB_GAL : 1)
      : null;
  const Pf = dP_per_1000 && depth ? (dP_per_1000 * depth) / 1000 : null;
  const BHTP = surfP !== null && Ph !== null && Pf !== null ? surfP + Ph - Pf : null;
  const fracGrad = BHTP && depth ? BHTP / depth : null;
  const capCT = ct_id ? capacity_bbl_per_ft(ct_id) : null;
  const strVol = capCT && depth ? capCT * depth : null;
  const ctWallHoop = surfP && ct_od && ct_id ? (surfP * ct_id) / (ct_od - ct_id) / 2 : null; // rough hoop stress
  const A_ann = casing && ct_od ? areaCircle(casing) - areaCircle(ct_od) : null;
  const capAnn = casing && ct_od ? annCap_bbl_per_ft(casing, ct_od) : null;
  const vAnn = q_bpm && A_ann ? (q_bpm * 9701.9) / A_ann / 12 : null;

  const warnings = [];
  const MAX_CT_WP = 10000; // CT-100 nominal working pressure psi
  if (surfP && surfP > MAX_CT_WP)
    warnings.push({ level: "danger", msg: `Surface pressure ${surfP.toFixed(0)} psi exceeds ${MAX_CT_WP} psi CT working pressure. IMMEDIATE shut-in required (API Spec 5ST).` });
  else if (surfP && surfP > 0.9 * MAX_CT_WP)
    warnings.push({ level: "warn", msg: `Surface pressure at >90% CT working limit. Reduce rate or fluid weight.` });
  if (fracGrad && fracGrad > 1.0)
    warnings.push({ level: "warn", msg: `Frac gradient ${fracGrad.toFixed(3)} psi/ft is at or above overburden. Verify formation limits.` });

  const results = [
    { label: "Hydrostatic pressure", ...display(Ph, u, "psi", conv.psi_to_MPa, "MPa", 0), formula: "Ph = 0.052 · ρ · TVD" },
    { label: "Friction pressure (CT)", ...display(Pf, u, "psi", conv.psi_to_MPa, "MPa", 0), formula: "Pf ≈ 0.017·Q^1.86/d^4.86·ρ/8.33" },
    { label: "Bottomhole treating pressure", ...display(BHTP, u, "psi", conv.psi_to_MPa, "MPa", 0), formula: "BHTP = Psurf + Ph − Pf" },
    { label: "Frac gradient", value: fracGrad !== null ? fracGrad.toFixed(3) : "—", unit: "psi/ft", note: "Typical 0.6–0.9 psi/ft" },
    { label: "CT internal volume", ...display(strVol, u, "bbl", conv.bbl_to_m3, "m³", 1) },
    { label: "Annular velocity", ...display(vAnn, u, "ft/min", (x) => x * 0.3048, "m/min", 0) },
    { label: "Approx CT hoop stress", value: ctWallHoop ? ctWallHoop.toFixed(0) : "—", unit: "psi", note: `Yield ${CT_YIELD_PSI} psi (CT-100)` },
    { label: "Annular capacity", value: capAnn ? capAnn.toFixed(4) : "—", unit: "bbl/ft" },
  ];
  return {
    results,
    warnings,
    formula: "BHTP = Psurf + 0.052·ρ·TVD − Pf ;  Pf ≈ 0.017·Q^1.86/d^4.86·ρ/8.33",
    reference: "API RP 5C7 · API RP 13D · Halliburton Red Book",
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

  const trueDepth = depth !== null && offset !== null ? depth + offset : depth;
  const Ph = rho && trueDepth ? 0.052 * rho * trueDepth : null;
  const A_ann = casing && tubOD ? areaCircle(casing) - areaCircle(tubOD) : null;
  const dh = casing && tubOD ? casing - tubOD : null; // hydraulic diameter (approx)
  const q_gpm = q_bpm ? q_bpm * 42 : null;
  // Annular friction: dP ≈ 0.02 × Q^1.86 / dh^4.86 × ρ/8.33 (industry approximation)
  const dP_per_1000 = q_gpm && dh ? (0.02 * Math.pow(q_gpm, 1.86) / Math.pow(dh, 4.86)) * (rho ? rho / WATER_LB_GAL : 1) : null;
  const Pf = dP_per_1000 && trueDepth ? (dP_per_1000 * trueDepth) / 1000 : null;
  const BHTP = surfP !== null && Ph !== null && Pf !== null ? surfP + Ph - Pf : null;
  const fracGrad = BHTP && trueDepth ? BHTP / trueDepth : null;
  const vAnn = q_bpm && A_ann ? (q_bpm * 9701.9) / A_ann / 12 : null;
  const capAnn = casing && tubOD ? annCap_bbl_per_ft(casing, tubOD) : null;
  const totalVol = capAnn && trueDepth ? capAnn * trueDepth : null;

  const warnings = [];
  if (fracGrad && fracGrad > 1.0)
    warnings.push({ level: "warn", msg: `Frac gradient ${fracGrad.toFixed(3)} psi/ft — verify formation limits per AER Directive 009.` });
  if (surfP && casing && surfP > 5000)
    warnings.push({ level: "warn", msg: `Surface pressure ${surfP.toFixed(0)} psi — verify wellhead / casing burst rating.` });

  const results = [
    { label: "True vertical depth (stage)", ...display(trueDepth, u, "ft", conv.ft_to_m, "m", 0) },
    { label: "Hydrostatic @ TVD", ...display(Ph, u, "psi", conv.psi_to_MPa, "MPa", 0) },
    { label: "Annular friction pressure", ...display(Pf, u, "psi", conv.psi_to_MPa, "MPa", 0) },
    { label: "Bottomhole treating pressure", ...display(BHTP, u, "psi", conv.psi_to_MPa, "MPa", 0) },
    { label: "Frac gradient", value: fracGrad !== null ? fracGrad.toFixed(3) : "—", unit: "psi/ft" },
    { label: "Annular velocity", ...display(vAnn, u, "ft/min", (x) => x * 0.3048, "m/min", 0) },
    { label: "Annular capacity", value: capAnn ? capAnn.toFixed(4) : "—", unit: "bbl/ft" },
    { label: "Total annular volume", ...display(totalVol, u, "bbl", conv.bbl_to_m3, "m³", 1) },
  ];
  return {
    results,
    warnings,
    formula: "BHTP = Psurf + 0.052·ρ·TVD − Pf(annulus) ;  Pf ≈ 0.02·Q^1.86/dh^4.86",
    reference: "AER Directive 009 · API RP 13D",
  };
}

function calc_Mechanical_Sleeve(vals, params, u) {
  const depth = grab(vals, params, u, ["base depth"]);
  const offset = grab(vals, params, u, ["offset"]);
  const shiftF = grab(vals, params, u, ["shift force"]);
  const drag = grab(vals, params, u, ["string drag"]);

  const tvd = depth !== null && offset !== null ? depth + offset : depth;
  const requiredSurface = shiftF !== null && drag !== null ? shiftF + drag : null;
  const availAt80Yield = null;
  // For a 1.5" × 1.25" CT-100 CT: wall area 0.5399 in² × 100k = 53,987 lb tensile
  const ct_od = 1.5, ct_id = 1.25; // default assumption; real string may vary
  const yieldF = wallArea(ct_od, ct_id) * CT_YIELD_PSI;
  const maxSafe = yieldF * 0.8;
  const utilisation = requiredSurface && maxSafe ? (requiredSurface / maxSafe) * 100 : null;

  const warnings = [];
  if (utilisation !== null && utilisation > 80)
    warnings.push({ level: "danger", msg: `Required surface pull ${requiredSurface.toFixed(0)} lb is >80% of max safe (${maxSafe.toFixed(0)} lb). Do NOT force sleeve — consider hydraulic option.` });
  else if (utilisation !== null && utilisation > 60)
    warnings.push({ level: "warn", msg: `Surface pull utilisation ${utilisation.toFixed(0)}% — approaching yield limit.` });

  const results = [
    { label: "Sleeve TVD", ...display(tvd, u, "ft", conv.ft_to_m, "m", 0) },
    { label: "Required surface force", ...display(requiredSurface, u, "lb", conv.lb_to_daN, "daN", 0), formula: "Fsurf = Fshift + Fdrag" },
    { label: "Max safe surface pull (0.80×Fy)", ...display(maxSafe, u, "lb", conv.lb_to_daN, "daN", 0), note: "For 1.5×1.25 CT-100 default" },
    { label: "Utilisation of yield", value: utilisation !== null ? utilisation.toFixed(0) : "—", unit: "%", note: "Keep < 80% per API RP 5C7" },
  ];
  return {
    results,
    warnings,
    formula: "Fsurf = Fshift + Fdrag ;  Fmax = 0.80·σy·A",
    reference: "API Spec 11D1 · API RP 5C7",
  };
}

function calc_Hydraulic_Sleeve(vals, params, u) {
  const depth = grab(vals, params, u, ["base depth"]);
  const offset = grab(vals, params, u, ["offset"]);
  const target = grab(vals, params, u, ["target p"]);
  const tvd = depth !== null && offset !== null ? depth + offset : depth;

  // Assume standard 3.5" hydraulic tool piston area 4.19 in²
  const A_piston = 4.19; // in²
  const F_shift = target !== null ? target * A_piston : null; // lb  (rough)
  // Applied surface = target (differential) + hydrostatic to ball seat if valve-driven
  const warnings = [];
  const MAX_WP = 7500;
  if (target && target > MAX_WP)
    warnings.push({ level: "warn", msg: `Target pressure ${target.toFixed(0)} psi is above typical 7500 psi sleeve rating — verify tool spec.` });

  const results = [
    { label: "Sleeve TVD", ...display(tvd, u, "ft", conv.ft_to_m, "m", 0) },
    { label: "Piston area (assumed 3.5\" tool)", value: A_piston.toFixed(2), unit: "in²" },
    { label: "Shift force at ΔP", ...display(F_shift, u, "lb", conv.lb_to_daN, "daN", 0), formula: "F = ΔP · A_piston" },
    { label: "Applied surface pressure target", ...display(target, u, "psi", conv.psi_to_MPa, "MPa", 0) },
  ];
  return {
    results,
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
  // Convert bbl → SCF: 1 bbl @ (P+14.7 psi) → SCF: SCF = V(bbl) × 5.615 × (P+14.7)/14.7 (isothermal)
  const scfRequired = sysVol_bbl && surfP ? sysVol_bbl * 5.615 * ((surfP + 14.7) / 14.7) * 3 : null; // 3× purge factor per CGA G-10.1
  const purgeTime = scfRequired && rate ? scfRequired / rate : null;

  const warnings = [];
  if (purgeTime && purgeTime > 120)
    warnings.push({ level: "warn", msg: `Purge time ${purgeTime.toFixed(0)} min exceeds 2 h — verify N₂ supply and thermal drift.` });

  const results = [
    { label: "Tubing capacity", value: cap ? cap.toFixed(4) : "—", unit: "bbl/ft" },
    { label: "System volume", ...display(sysVol_bbl, u, "bbl", conv.bbl_to_m3, "m³", 2) },
    { label: "N₂ required (3× purge)", value: scfRequired ? scfRequired.toFixed(0) : "—", unit: "SCF", formula: "V = 3·Vsys·(P+14.7)/14.7" },
    { label: "Purge time @ set rate", value: purgeTime !== null ? purgeTime.toFixed(0) : "—", unit: "min" },
  ];
  return {
    results,
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
  // N2 needed to unload column (rough): SCF ≈ 5.615 × Vcol × (P/14.7)
  const capCol = 0.0012; // bbl/ft for 1.5" ID default
  const scfNeeded = capCol && dryDepth && liftPressure ? (capCol * dryDepth) * 5.615 * ((liftPressure + 14.7) / 14.7) : null;
  const timeMin = scfNeeded && rate ? scfNeeded / rate : null;

  const warnings = [];
  if (liftPressure && liftPressure > 2000)
    warnings.push({ level: "warn", msg: `Lift pressure ${liftPressure.toFixed(0)} psi is high — verify N₂ pump capacity.` });

  const results = [
    { label: "Static column pressure", ...display(columnP, u, "psi", conv.psi_to_MPa, "MPa", 0), formula: "P = g · TVD" },
    { label: "Dry depth (to unload)", ...display(dryDepth, u, "ft", conv.ft_to_m, "m", 0) },
    { label: "Lift pressure required", ...display(liftPressure, u, "psi", conv.psi_to_MPa, "MPa", 0) },
    { label: "N₂ required (est.)", value: scfNeeded ? scfNeeded.toFixed(0) : "—", unit: "SCF" },
    { label: "Kickoff time @ rate", value: timeMin !== null ? timeMin.toFixed(0) : "—", unit: "min" },
  ];
  return {
    results,
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
  // Nierode-Williams simplified: reaction half-life doubles per 10°F rise up to 200°F
  const reactionHalfLife = bht !== null ? 60 * Math.pow(0.5, Math.max(0, (bht - 100) / 10)) : null; // rough, min
  const totalPumpTime = pumpTime && rate ? pumpTime + (overflushVol / rate) : null;

  const warnings = [];
  if (bht !== null && bht > 200)
    warnings.push({ level: "warn", msg: `BHT ${bht.toFixed(0)}°F is high — use retarded acid system (Nierode-Williams).` });
  if (rate !== null && rate < 0.5)
    warnings.push({ level: "warn", msg: `Low pump rate — acid may pre-spend before reaching perforations.` });

  const results = [
    { label: "CT internal capacity", value: capCT ? capCT.toFixed(4) : "—", unit: "bbl/ft" },
    { label: "Displacement volume", ...display(displaceVol, u, "bbl", conv.bbl_to_m3, "m³", 2) },
    { label: "Overflush (1.5×)", ...display(overflushVol, u, "bbl", conv.bbl_to_m3, "m³", 2) },
    { label: "Acid pump time", value: pumpTime !== null ? pumpTime.toFixed(1) : "—", unit: "min" },
    { label: "Total treatment time", value: totalPumpTime !== null ? totalPumpTime.toFixed(1) : "—", unit: "min" },
    { label: "Reaction half-life (est.)", value: reactionHalfLife !== null ? reactionHalfLife.toFixed(1) : "—", unit: "min", formula: "Nierode-Williams (simplified)" },
  ];
  return {
    results,
    warnings,
    formula: "Vd = capCT·TVD ;  Vof = 1.5·Vacid ;  t = V/Q",
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
  const poreV = A_int && interval ? (A_int * interval * 12) / 9701.9 * 0.2 : null; // 20% φ
  const inhConcentration = inh && poreV ? (inh / poreV) * 100 : null;
  const pumpTime = inh && rate ? inh / rate : null;
  const shutInHrs = temp !== null && temp > 150 ? 24 : 48; // hotter -> shorter recommended shut-in

  const warnings = [];
  if (inhConcentration !== null && inhConcentration < 150)
    warnings.push({ level: "warn", msg: `Inhibitor volume covers only ${inhConcentration.toFixed(0)}% of estimated pore volume — target 200–300% for effective squeeze.` });

  const results = [
    { label: "Perf interval pore volume (est.)", ...display(poreV, u, "bbl", conv.bbl_to_m3, "m³", 2), note: "φ = 20% assumed" },
    { label: "Inhibitor coverage", value: inhConcentration !== null ? inhConcentration.toFixed(0) : "—", unit: "% pore vol", note: "Target 200–300%" },
    { label: "Pump time", value: pumpTime !== null ? pumpTime.toFixed(1) : "—", unit: "min" },
    { label: "Recommended shut-in", value: shutInHrs.toFixed(0), unit: "hours", note: temp !== null ? (temp > 150 ? "Hot well — 24 h" : "48 h standard") : "" },
  ];
  return {
    results,
    warnings,
    formula: "Vpore ≈ A·L·φ ;  Coverage = Vinh / Vpore",
    reference: "SPE 87458 · NACE SP0106",
  };
}

function calc_Cement_Plug(vals, params, u) {
  const rho = grab(vals, params, u, ["slurry wt"]);
  const slurryV = grab(vals, params, u, ["slurry vol"]);
  const casing = grab(vals, params, u, ["casing id"]);
  const yieldSk = grab(vals, params, u, ["yield"]);
  const depth = grab(vals, params, u, ["current depth"]);

  const A_hole = casing ? areaCircle(casing) : null;
  const capHole = casing ? (casing * casing) / 1029.4 : null;
  const plugHeight = slurryV && capHole ? slurryV / capHole : null;
  const sacks = slurryV && yieldSk ? (slurryV * 5.615) / yieldSk : null; // sk = slurry ft³ / yield ft³/sk
  const P_hydCement = rho && plugHeight ? 0.052 * rho * plugHeight : null;
  const AER_MIN = 165; // ft (~50 m) per AER Directive 020

  const warnings = [];
  if (plugHeight !== null && plugHeight < AER_MIN)
    warnings.push({ level: "danger", msg: `Plug height ${plugHeight.toFixed(0)} ft is below AER Directive 020 minimum of 165 ft (50 m). Increase slurry volume.` });
  if (rho !== null && rho < 14)
    warnings.push({ level: "warn", msg: `Slurry weight ${rho.toFixed(1)} ppg is light — verify against formation pressures.` });

  const results = [
    { label: "Hole capacity", value: capHole ? capHole.toFixed(4) : "—", unit: "bbl/ft" },
    { label: "Plug height", ...display(plugHeight, u, "ft", conv.ft_to_m, "m", 0), formula: "H = V / capHole", note: "AER Dir 020 min 165 ft" },
    { label: "Cement sacks", value: sacks !== null ? sacks.toFixed(1) : "—", unit: "sk", formula: "sk = V · 5.615 / Yield" },
    { label: "Slurry hydrostatic", ...display(P_hydCement, u, "psi", conv.psi_to_MPa, "MPa", 0) },
    { label: "Plug top depth (est.)", ...display(depth !== null && plugHeight !== null ? depth - plugHeight : null, u, "ft", conv.ft_to_m, "m", 0) },
  ];
  return {
    results,
    warnings,
    formula: "Vslurry = capHole · H_plug ;  sk = V·5.615 / Yield",
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
  const AER_MIN = 165;
  const P_hyd = rho && plug ? 0.052 * rho * plug : null;

  const warnings = [];
  if (plugHeight !== null && plugHeight < AER_MIN)
    warnings.push({ level: "danger", msg: `Plug height ${plugHeight.toFixed(0)} ft is below AER Dir 020 minimum 165 ft (50 m). Non-compliant.` });
  if (cur !== null && plug !== null && cur < plug)
    warnings.push({ level: "warn", msg: `Current depth is above plug depth — verify TOC calculation.` });

  const results = [
    { label: "Plug height achieved", ...display(plugHeight, u, "ft", conv.ft_to_m, "m", 0), note: "AER Dir 020 min 165 ft (50 m)" },
    { label: "Cement volume required", ...display(cemV, u, "bbl", conv.bbl_to_m3, "m³", 2) },
    { label: "Hydrostatic at plug", ...display(P_hyd, u, "psi", conv.psi_to_MPa, "MPa", 0) },
    { label: "Compliance", value: plugHeight !== null && plugHeight >= AER_MIN ? "PASS" : "FAIL", unit: "AER Dir 020", note: "Two-plug barrier still required" },
  ];
  return {
    results,
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

  const clearance = casing !== null && gunOD !== null ? (casing - gunOD) / 2 : null; // in
  const minClearance = 0.25; // in typical minimum
  const collapseP_est = casing ? 3000 : null; // very rough — actual per API RP 5C3

  const warnings = [];
  if (clearance !== null && clearance < minClearance)
    warnings.push({ level: "warn", msg: `Radial clearance ${(clearance * 25.4).toFixed(1)} mm is below 6 mm (0.25 in) minimum — risk of hang-up.` });
  if (firingP && firingP < 500)
    warnings.push({ level: "warn", msg: `Firing pressure ${firingP} psi is low — verify actuator spec.` });

  const results = [
    { label: "Gun run depth", ...display(depth, u, "ft", conv.ft_to_m, "m", 0) },
    { label: "Radial clearance", ...display(clearance, u, "in", conv.in_to_mm, "mm", 3), note: "Min 0.25 in (6 mm)" },
    { label: "Firing pressure", ...display(firingP, u, "psi", conv.psi_to_MPa, "MPa", 0) },
    { label: "Approx casing collapse rating", value: collapseP_est ? collapseP_est.toFixed(0) : "—", unit: "psi", note: "Check per API RP 5C3" },
  ];
  return {
    results,
    warnings,
    formula: "Clearance = (D_casing − D_gun) / 2",
    reference: "API RP 67 · API RP 5C3",
  };
}

function calc_Fishing_Ops(vals, params, u) {
  const fishWt = grab(vals, params, u, ["fish wt"]);
  const jarOP = grab(vals, params, u, ["jar overpull"]);
  const tubOD = grab(vals, params, u, ["tubing od"]);

  // Assume 1.25" ID default with tubOD (single-wall CT)
  const wallA = tubOD ? wallArea(tubOD, tubOD - 0.25) : null;
  const yieldF = wallA ? wallA * CT_YIELD_PSI : null;
  const tensileF = wallA ? wallA * CT_TENSILE_PSI : null;
  const maxSafe = yieldF ? yieldF * 0.7 : null; // fishing conservative 70% (API RP 5C7)
  const totalPull = fishWt !== null && jarOP !== null ? fishWt + jarOP : null;
  const util = totalPull && maxSafe ? (totalPull / maxSafe) * 100 : null;

  const warnings = [];
  if (util !== null && util > 100)
    warnings.push({ level: "danger", msg: `Combined pull ${totalPull.toFixed(0)} lb exceeds 70% of yield safe limit. STOP — risk of CT parting.` });
  else if (util !== null && util > 80)
    warnings.push({ level: "warn", msg: `Pull utilisation ${util.toFixed(0)}% — monitor fatigue log closely.` });

  const results = [
    { label: "CT yield force", ...display(yieldF, u, "lb", conv.lb_to_daN, "daN", 0), formula: "Fy = σy · A" },
    { label: "CT ultimate tensile", ...display(tensileF, u, "lb", conv.lb_to_daN, "daN", 0) },
    { label: "Max safe pull (0.70 × Fy)", ...display(maxSafe, u, "lb", conv.lb_to_daN, "daN", 0), note: "Fishing-conservative per API RP 5C7" },
    { label: "Total combined pull", ...display(totalPull, u, "lb", conv.lb_to_daN, "daN", 0), formula: "Ftotal = Ffish + Fjar" },
    { label: "Utilisation", value: util !== null ? util.toFixed(0) : "—", unit: "% of safe max" },
  ];
  return {
    results,
    warnings,
    formula: "Ftotal = Wfish + Fjar ;  Fmax = 0.70·σy·A (fishing)",
    reference: "API RP 5C7 §12 · API Spec 7-1",
  };
}

// -------- Router -------------------------------------------------------------
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
