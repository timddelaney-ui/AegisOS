// CT physics — triaxial stress + Von Mises envelope + Palmgren-Miner fatigue
// All models are clean-room from published, open-domain sources:
//   • API RP 5C7 (CT thick-wall Lamé stress, 80% SMYS safe working limit)
//   • Palmgren (1924), Miner (1945) linear damage
//   • Manson–Coffin plastic strain-life (public form)
// NO proprietary coefficients from commercial software.

// ---- Grade → SMYS (psi), public datasheets ----
export const GRADE_SMYS = {
  "QT-800": 80000,
  "QT-900": 90000,
  "QT-1000": 100000,
  "CT-110": 110000,
  "CT-80": 80000,
  "CT-90": 90000,
  "CT-100": 100000,
};

export const defaultSmys = (grade) => GRADE_SMYS[(grade || "").toUpperCase()] || 90000;

// ---- Thick-wall Lamé triaxial stress + Von Mises ----
// Returns stresses at the INNER wall (worst case for burst / collapse).
// σ_h = [p_i·(r_i²+r_o²) − 2·p_o·r_o²] / (r_o²−r_i²)   (Lamé)
// σ_r = −p_i                                             (at r=r_i)
// σ_a = F / A                                            (axial)
// VM  = √(½·[(σ_h−σ_r)² + (σ_r−σ_a)² + (σ_a−σ_h)²])
export function triaxialVonMises({ OD, WT, p_i, p_o = 0, F_axial = 0, smys }) {
  const od = Number(OD) || 0;
  const wt = Number(WT) || 0;
  const id = Math.max(0.01, od - 2 * wt);
  const r_i = id / 2;
  const r_o = od / 2;
  if (r_o <= r_i) return null;

  const pi = Number(p_i) || 0;
  const po = Number(p_o) || 0;
  const dp = pi - po;

  const sigma_h = (pi * (r_i * r_i + r_o * r_o) - 2 * po * r_o * r_o) / (r_o * r_o - r_i * r_i);
  const sigma_r = -pi;
  const area = Math.PI * (r_o * r_o - r_i * r_i); // in²
  const sigma_a = (Number(F_axial) || 0) / Math.max(area, 1e-6);

  const vm = Math.sqrt(
    0.5 * (
      (sigma_h - sigma_r) ** 2 +
      (sigma_r - sigma_a) ** 2 +
      (sigma_a - sigma_h) ** 2
    )
  );
  const smys_val = Number(smys) || 90000;
  const safe = 0.8 * smys_val;
  const util = vm / safe;
  return {
    sigma_r, sigma_h, sigma_a, dp, area,
    von_mises: vm,
    smys: smys_val, safe_limit: safe,
    utilization: util,
    utilization_smys: vm / smys_val,
    // Visual warning when within 5 % of the 80 % SMYS safe boundary.
    near_limit: util >= 0.95 && util < 1.0,
    exceeds_limit: util >= 1.0,
  };
}

// Backwards-compat shim — Live Ops & 17 sheets still import this.
// Routes through the thick-wall formulation holding p_o = 0 and treating dp as p_i.
export function thinWallVonMises({ OD, WT, dp, F_axial = 0, p_o = 0, smys }) {
  return triaxialVonMises({ OD, WT, p_i: (Number(dp) || 0) + p_o, p_o, F_axial, smys });
}

// ---- Von Mises envelope (API RP 5C7 "Egg") ----
// Plotted in the industry-conventional (Δp, F_axial) space. At each Δp we
// solve the quadratic VM(σ_a) = VM_target for σ_a (two roots → upper + lower
// branch of the egg). Produces the closed curve directly, including the burst
// and collapse "tips" where the two branches meet.
export function vmEnvelope({ OD, WT, smys, p_o = 0, utilization_target = 1.0, steps = 180 }) {
  const od = Number(OD) || 0;
  const wt = Number(WT) || 0;
  const id = Math.max(0.01, od - 2 * wt);
  const r_i = id / 2;
  const r_o = od / 2;
  if (r_o <= r_i) return [];
  const area = Math.PI * (r_o * r_o - r_i * r_i);
  const po = Number(p_o) || 0;
  const smys_val = Number(smys) || 90000;
  // utilization_target: 1.0 ⇒ 80 % SMYS boundary (API RP 5C7 safe working limit)
  //                     1.25 ⇒ 100 % SMYS (nominal yield)
  const vm_target = 0.8 * smys_val * utilization_target;

  // Scan Δp from an estimated collapse tip to the burst tip. Tips occur where
  // 4·VM² = 3·(σ_h − σ_r)² and the two σ_a roots coincide.
  // At each Δp:
  //   σ_h = [(po+Δp)·(r_i²+r_o²) − 2·po·r_o²] / (r_o²−r_i²)
  //   σ_r = −(po+Δp)
  // Solve x² − (σ_h+σ_r)x + [0.5·(σ_h−σ_r)² + 0.5·σ_r² + 0.5·σ_h² − VM²] = 0
  // Discriminant Δ = 4·VM² − 3·(σ_h−σ_r)²  (so tips at Δ=0).

  // Find tips first — bisection: expand outward until Δ goes negative.
  const sigmaFromDp = (dp) => {
    const pi = po + dp;
    const sh = (pi * (r_i * r_i + r_o * r_o) - 2 * po * r_o * r_o) / (r_o * r_o - r_i * r_i);
    const sr = -pi;
    return { sh, sr };
  };
  const disc = (dp) => {
    const { sh, sr } = sigmaFromDp(dp);
    return 4 * vm_target * vm_target - 3 * (sh - sr) * (sh - sr);
  };

  // Rough bracket: burst up to ~2x SMYS worth of pressure
  const guess = smys_val * 2;
  // Burst tip (positive Δp)
  let lo = 0, hi = guess;
  while (disc(hi) > 0 && hi < 1e9) hi *= 2;
  for (let i = 0; i < 40 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (disc(mid) > 0) lo = mid; else hi = mid;
  }
  const dp_max = lo;
  // Collapse tip (negative Δp)
  lo = 0; hi = -guess;
  while (disc(hi) > 0 && hi > -1e9) hi *= 2;
  for (let i = 0; i < 40 && lo - hi > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (disc(mid) > 0) lo = mid; else hi = mid;
  }
  const dp_min = lo;

  const pts = [];
  const n = Math.max(60, steps / 2);
  // Upper branch (collapse tip → burst tip)
  for (let i = 0; i <= n; i++) {
    const dp = dp_min + (dp_max - dp_min) * (i / n);
    const { sh, sr } = sigmaFromDp(dp);
    const b = sh + sr;
    const d = 4 * vm_target * vm_target - 3 * (sh - sr) * (sh - sr);
    if (d < 0) continue;
    const sqrtD = Math.sqrt(d);
    const sigma_a_upper = (b + sqrtD) / 2;
    pts.push({ dp, F_axial: sigma_a_upper * area });
  }
  // Lower branch (burst tip → collapse tip)
  for (let i = n; i >= 0; i--) {
    const dp = dp_min + (dp_max - dp_min) * (i / n);
    const { sh, sr } = sigmaFromDp(dp);
    const b = sh + sr;
    const d = 4 * vm_target * vm_target - 3 * (sh - sr) * (sh - sr);
    if (d < 0) continue;
    const sqrtD = Math.sqrt(d);
    const sigma_a_lower = (b - sqrtD) / 2;
    pts.push({ dp, F_axial: sigma_a_lower * area });
  }
  // Close the loop
  if (pts.length) pts.push(pts[0]);
  return pts;
}

// ---------- Injector-skate ovality + fatigue scaling ----------
// Clean-room public-domain mechanics:
//   • Clamping force F_c = p_skate · A_cyl · n_cylinders
//   • Ring diametral deflection under a pair of opposing point loads
//     (classic strength-of-materials result): δ = F·R³·(π/4 − 2/π) / (E·I)
//     where I = t³ / 12 per unit length. The constant k = π/4 − 2/π ≈ 0.1488.
//   • Ovality % = δ_D / D_nom · 100
//   • Localized contact stress p_c = F_c / (L_pad · n_pads · OD · k_arc)
//     (approximate average pad pressure)
//   • Fatigue scaling: Peterson stress-concentration K_t grows with ovality;
//     Δε scales linearly with K_t; damage per cycle ~ K_t^(2) via Manson-Coffin.
export const DEFAULT_SKATE = {
  cylinder_bore_in: 3.5,     // typical hydraulic skate cylinder bore
  n_cylinders: 4,            // 2 skates × 2 cylinders each
  n_pads: 4,                 // chain contact pads simultaneously engaged
  pad_length_in: 6.0,        // single pad contact length along axis
  pad_arc_fraction: 0.25,    // fraction of OD circumference each pad covers
  recommended_max_psi: 1600, // anti-slip threshold typical for 1.75"-2.375" CT
};
export const E_STEEL_PSI = 30e6; // Young's modulus for CT steel, psi

export function injectorSkateMechanics({
  skate_pressure_psi,
  OD,
  WT,
  skate = DEFAULT_SKATE,
}) {
  const psi = Number(skate_pressure_psi) || 0;
  const od = Number(OD) || 2.0;
  const wt = Number(WT) || 0.156;
  const bore = skate.cylinder_bore_in;
  const A_cyl = Math.PI * (bore / 2) ** 2;
  const F_total = psi * A_cyl * skate.n_cylinders;             // total clamping force, lbf

  // Pipe ring under opposing point loads
  const R = (od - wt) / 2;                                     // mean radius, in
  const I_per_len = Math.pow(wt, 3) / 12;                      // in^4 per inch length
  const k_ring = Math.PI / 4 - 2 / Math.PI;                    // ≈ 0.1488
  // Force per unit length under n_pads engaged: F_eff = F_total / (n_pads · pad_length)
  const F_eff = F_total / Math.max(1, skate.n_pads * skate.pad_length_in);
  const delta = (F_eff * Math.pow(R, 3) * k_ring) / (E_STEEL_PSI * I_per_len);  // inch deflection per unit length
  const ovality_pct = (2 * delta / od) * 100;                 // diametral ovality %

  // Localized contact stress — average pad pressure (lbf/in²)
  const pad_area = skate.pad_length_in * (Math.PI * od * skate.pad_arc_fraction);
  const p_contact = F_total / Math.max(skate.n_pads * pad_area, 1e-6);

  // Stress concentration (Peterson-style; K_t = 1 at zero ovality, grows ~ linearly).
  // 1 % ovality ⇒ K_t ≈ 1.25, 3 % ⇒ ~1.75. Clean-room empirical fit from public
  // ring-ovality K_t literature (Timoshenko, "Theory of Elasticity"). Capped at 3.0.
  const K_t = Math.min(3.0, 1 + 0.25 * Math.max(0, ovality_pct));

  // Over-pressure factor — once above recommended skate psi, extra multiplier.
  const over = Math.max(0, psi - skate.recommended_max_psi) / Math.max(1, skate.recommended_max_psi);
  const over_pressure_factor = 1 + 0.5 * over;                 // +50 % per 100 % over

  // Combined fatigue damage scaler per cycle:  Δε ∝ K_t  ⇒ damage ∝ K_t^2
  const fatigue_scale = Math.pow(K_t, 2) * over_pressure_factor;

  return {
    skate_pressure_psi: psi,
    clamping_force_lbf: F_total,
    ovality_pct,
    contact_stress_psi: p_contact,
    K_t,
    over_pressure_factor,
    fatigue_scale,                 // multiplier to apply to baseline cycle damage
    over_recommended: psi > skate.recommended_max_psi,
    recommended_max_psi: skate.recommended_max_psi,
  };
}

// ---------- Fatigue (local client-side ESTIMATE) ----------
// Palmgren-Miner linear damage summation.
// Life model (Manson-Coffin public form): N_f = (eps_p / 0.5)^(-2) * grade_factor
// Plastic strain at reel-core wrap: eps_p = (OD/2) / R_bend
export const REEL_CORE_RADIUS_IN = 72.0; // 72" reel core, open standard
export function cyclesToFailure(OD_in, bend_radius_in = REEL_CORE_RADIUS_IN, smys = 90000) {
  const eps_p = (OD_in / 2) / Math.max(bend_radius_in, 0.1);
  const gradeFactor = Math.pow(smys / 90000, 1.2);
  const base = Math.pow(eps_p / 0.5, -2);
  return Math.max(50, base * gradeFactor);
}

// Augmented damage per cycle at a node, with pressure penalty + optional
// injector-skate penalty (K_t²·over_pressure_factor).
export function damagePerCycleScaled({
  OD_in, WT_in, bend_radius_in, smys, internal_psi = 0, skate_fatigue_scale = 1,
}) {
  const Nf = cyclesToFailure(OD_in, bend_radius_in, smys);
  // Pressure penalty (public API RP 5C7 teaching): damage increases with Δp
  const pf = 1 + Math.max(0, internal_psi) / 10000;
  return (1 / Nf) * pf * Math.max(1, skate_fatigue_scale);
}

// Interpret damage array (0..1) into a color string green->red
export function damageColor(d) {
  if (d <= 0.3) return "#C44A08";       // "safe" accent — subject to UI theme
  if (d <= 0.5) return "#4EA55F";
  if (d <= 0.7) return "#C36600";
  if (d <= 0.9) return "#D64545";
  return "#8B0000";                     // retire
}

// Locate interval at MD
export function intervalAt(reel, md_ft) {
  if (!reel || !reel.intervals) return null;
  for (const seg of reel.intervals) {
    if (md_ft >= seg.start_md_ft && md_ft <= seg.end_md_ft) return seg;
  }
  return reel.intervals[reel.intervals.length - 1];
}
