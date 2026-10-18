// CT physics — triaxial stress + Von Mises + Palmgren-Miner fatigue
// All models are clean-room from published, open-domain sources:
//   • API RP 5C7 (CT thick-wall stress, 80% SMYS safe working limit)
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

// Thin-wall Von Mises for the CT "egg" envelope. Industry-standard formulation:
//   σ_h = Δp · r_m / WT   (mean-radius hoop)
//   σ_a = F / A
//   σ_r ≈ 0  (thin-wall; also conventional for the egg plot)
// Then  VM² = σ_h² − σ_h·σ_a + σ_a².
// This yields a clean 45°-rotated ellipse (the classic CT egg) and is
// consistent with API RP 5C7 Figure 2 / open-standard CT fatigue teaching.
export function thinWallVonMises({ OD, WT, dp, F_axial = 0, smys }) {
  const od = Number(OD) || 0;
  const wt = Number(WT) || 0;
  const id = Math.max(0.01, od - 2 * wt);
  const r_m = (od - wt) / 2;
  const area = Math.PI * ((od / 2) ** 2 - (id / 2) ** 2);
  const sigma_h = (Number(dp) || 0) * r_m / Math.max(wt, 1e-6);
  const sigma_a = (Number(F_axial) || 0) / Math.max(area, 1e-6);
  const vm = Math.sqrt(sigma_h * sigma_h - sigma_h * sigma_a + sigma_a * sigma_a);
  const smys_val = Number(smys) || 90000;
  const safe = 0.8 * smys_val;
  return {
    sigma_h, sigma_a, sigma_r: 0,
    von_mises: vm, dp: Number(dp) || 0,
    smys: smys_val, safe_limit: safe,
    utilization: vm / safe,
    utilization_smys: vm / smys_val,
    area,
    K_h: r_m / Math.max(wt, 1e-6),
  };
}

// Thick-wall Lamé (optional, more accurate at high p — kept for cross-check).
export function triaxialVonMises({ OD, WT, p_i, p_o = 0, F_axial = 0, smys }) {
  const od = Number(OD) || 0;
  const wt = Number(WT) || 0;
  const id = Math.max(0.01, od - 2 * wt);
  const r_i = id / 2;
  const r_o = od / 2;
  if (r_o <= r_i) return null;

  const dp = p_i - p_o;
  // Hoop at inner wall (Lamé)
  const sigma_h = (p_i * (r_i * r_i + r_o * r_o) - 2 * p_o * r_o * r_o) / (r_o * r_o - r_i * r_i);
  // Radial at inner wall = -p_i
  const sigma_r = -p_i;
  // Axial: average over wall area
  const area = Math.PI * (r_o * r_o - r_i * r_i); // in^2
  const sigma_a = (F_axial || 0) / Math.max(area, 1e-6);

  // Von Mises
  const vm = Math.sqrt(
    0.5 * (
      (sigma_h - sigma_r) ** 2 +
      (sigma_r - sigma_a) ** 2 +
      (sigma_a - sigma_h) ** 2
    )
  );
  const smys_val = Number(smys) || 90000;
  const safe = 0.8 * smys_val;
  return {
    sigma_r, sigma_h, sigma_a,
    von_mises: vm, dp,
    smys: smys_val,
    safe_limit: safe,
    utilization: vm / safe,
    utilization_smys: vm / smys_val,
  };
}

// Classic CT "egg" envelope — closed-form parametric ellipse in (σ_h, σ_a) space
// at a target VM level, mapped back to (Δp, F) via thin-wall relations.
// This produces a smooth egg (rotated ellipse) that opens correctly on both
// burst (Δp>0) and collapse (Δp<0) sides.
export function vmEnvelope({ OD, WT, smys, utilization_target = 1.0, steps = 180 }) {
  const od = Number(OD) || 0;
  const wt = Number(WT) || 0;
  const id = Math.max(0.01, od - 2 * wt);
  const r_m = (od - wt) / 2;
  const area = Math.PI * ((od / 2) ** 2 - (id / 2) ** 2);
  const K_h = r_m / Math.max(wt, 1e-6);
  const vm_target = 0.8 * (smys || 90000) * utilization_target;

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const c = Math.cos(t), s = Math.sin(t);
    // VM² = σ_h² − σ_h·σ_a + σ_a² = r² (c² − cs + s²) ⇒ r = VM / √(c²−cs+s²)
    const denom = c * c - c * s + s * s;
    const r = vm_target / Math.sqrt(denom);
    const sigma_h = r * c;
    const sigma_a = r * s;
    pts.push({ dp: sigma_h / K_h, F_axial: sigma_a * area });
  }
  return pts;
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

// Interpret damage array (0..1) into a color string green->red
export function damageColor(d) {
  if (d <= 0.3) return "#C44A08";       // green
  if (d <= 0.5) return "#4EA55F";       // light green
  if (d <= 0.7) return "#C36600";       // amber
  if (d <= 0.9) return "#D64545";       // red
  return "#8B0000";                     // dark red (retire)
}

// Locate interval at MD
export function intervalAt(reel, md_ft) {
  if (!reel || !reel.intervals) return null;
  for (const seg of reel.intervals) {
    if (md_ft >= seg.start_md_ft && md_ft <= seg.end_md_ft) return seg;
  }
  return reel.intervals[reel.intervals.length - 1];
}
