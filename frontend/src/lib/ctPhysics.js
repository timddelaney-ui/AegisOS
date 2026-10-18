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

// Thick-wall cylinder (Lamé) with axial.
// Returns stresses at inner wall (worst for CT per API RP 5C7).
// Inputs:
//   p_i, p_o: inner/outer pressure, psi
//   OD, WT: in
//   F_axial: axial force (lbf), tension positive
// Returns {sigma_r, sigma_h, sigma_a, von_mises, dp, safe_limit, utilization}
export function triaxialVonMises({ OD, WT, p_i, p_o = 0, F_axial = 0, smys }) {
  const od = Number(OD) || 0;
  const wt = Number(WT) || 0;
  const id = Math.max(0.01, od - 2 * wt);
  const r_i = id / 2;
  const r_o = od / 2;
  if (r_o <= r_i) return null;

  const dp = p_i - p_o;
  // Hoop at inner wall (Lamé)
  const sigma_h = ((p_i * r_i * r_i - p_o * r_o * r_o) + (r_i * r_i * r_o * r_o * (p_i - p_o)) / (r_i * r_i)) / (r_o * r_o - r_i * r_i);
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
  const safe = 0.8 * smys_val; // 80% SMYS working limit (API RP 5C7)
  return {
    sigma_r, sigma_h, sigma_a,
    von_mises: vm, dp,
    smys: smys_val,
    safe_limit: safe,
    utilization: vm / safe, // 1.0 = at 80% SMYS boundary
    utilization_smys: vm / smys_val, // 1.0 = at 100% SMYS
  };
}

// Build Von Mises operating-envelope points for an SVG "egg".
// Parametric sweep over effective axial force; solves VM = target for each.
// Returns array of {dp, F_axial} points along the envelope at a given VM level.
export function vmEnvelope({ OD, WT, smys, utilization_target = 1.0, p_o = 0, steps = 180 }) {
  const od = Number(OD), wt = Number(WT);
  const id = Math.max(0.01, od - 2 * wt);
  const r_i = id / 2, r_o = od / 2;
  const area = Math.PI * (r_o * r_o - r_i * r_i);
  const target_vm = 0.8 * (smys || 90000) * utilization_target; // VM level

  const pts_upper = []; // positive tension branch
  const pts_lower = []; // compression branch
  // Pressure sweep
  const p_max = (smys || 90000); // bounding guess
  for (let i = 0; i <= steps; i++) {
    const dp = -p_max + (2 * p_max * i) / steps;
    const p_i = Math.max(p_o + dp, 0);
    // Hoop at inner
    const sigma_h =
      ((p_i * r_i ** 2 - p_o * r_o ** 2) + (r_i ** 2 * r_o ** 2 * (p_i - p_o)) / (r_i ** 2)) /
      (r_o ** 2 - r_i ** 2);
    const sigma_r = -p_i;
    // Solve for sigma_a such that VM = target: quadratic in sigma_a
    // VM^2 = 0.5*((sh-sr)^2 + (sr-sa)^2 + (sa-sh)^2)
    //     = sa^2 - (sh+sr)*sa + (sh^2 + sr^2 - sh*sr) ... after algebra:
    //  2*VM^2 = 2*sa^2 - 2(sh+sr)*sa + (sh^2 + sr^2 - 2*sh*sr) + 2*(sh^2 - sh*sr + sr^2 - sh*sr)
    // Simpler: expand directly
    // 2*VM^2 = (sh-sr)^2 + 2*sa^2 - 2*(sh+sr)*sa + sh^2 + sr^2
    const A = 2;
    const B = -2 * (sigma_h + sigma_r);
    const C = (sigma_h - sigma_r) ** 2 + sigma_h ** 2 + sigma_r ** 2 - 2 * target_vm ** 2;
    const disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    const sa1 = (-B + Math.sqrt(disc)) / (2 * A);
    const sa2 = (-B - Math.sqrt(disc)) / (2 * A);
    const F1 = sa1 * area;
    const F2 = sa2 * area;
    pts_upper.push({ dp, F_axial: F1 });
    pts_lower.push({ dp, F_axial: F2 });
  }
  // Return closed loop
  return pts_upper.concat(pts_lower.reverse());
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
  if (d <= 0.3) return "#0D6535";       // green
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
