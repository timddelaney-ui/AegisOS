// Surface-element stress for a CT segment bent over a guide arch.
// All inputs/outputs are SI (MPa, kN, m, mm) — callers convert via lib/units.js.
//   hoop            = p · r_i / t                    (thin-wall, ID basis)
//   pressure axial  = p · A_i / A_steel              (closed-end load)
//   tension axial   = F / A_steel
//   bending         = ± E · r_o / R
//   max axial       = pressure + tension + |bending|
// Von Mises uses the plane-stress surface state (σ_r = 0).

export const CT90_SEGMENT = Object.freeze({
  od_mm: 50.8,
  wt_mm: 4.0,
  youngs_mpa: 200000,
  smys_mpa: 620.5, // 90 ksi
});

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function segmentStress({
  pressure_mpa,
  tension_kn,
  bend_radius_m,
  od_mm = CT90_SEGMENT.od_mm,
  wt_mm = CT90_SEGMENT.wt_mm,
  youngs_mpa = CT90_SEGMENT.youngs_mpa,
  smys_mpa = CT90_SEGMENT.smys_mpa,
} = {}) {
  const p = Math.max(0, num(pressure_mpa));
  const tension = num(tension_kn);
  const od = num(od_mm);
  const wt = num(wt_mm);
  const r_o = od / 2;
  const r_i = r_o - wt;
  if (!(od > 0) || !(wt > 0) || r_i <= 0) return null;
  const smys = num(smys_mpa);
  if (!(smys > 0)) return null;

  const area_steel = Math.PI * (r_o * r_o - r_i * r_i); // mm²
  const area_bore = Math.PI * r_i * r_i;
  const R = num(bend_radius_m);
  // R <= 0 or non-finite means "straight": no bending contribution.
  const bending = R > 0 ? (num(youngs_mpa) * r_o) / (R * 1000) : 0;

  const hoop = (p * r_i) / wt;
  const pressure_axial = (p * area_bore) / area_steel;
  const tension_axial = (tension * 1000) / area_steel;
  const axialCenter = pressure_axial + tension_axial;
  const max_axial = axialCenter + Math.abs(bending);
  const axialFibers = [axialCenter + bending, axialCenter - bending];
  const vmAtAxial = (axial) => Math.sqrt(0.5 * ((hoop - axial) ** 2 + axial ** 2 + hoop ** 2));
  const governing_axial = axialFibers.reduce((governing, axial) => (
    vmAtAxial(axial) > vmAtAxial(governing) ? axial : governing
  ));
  const vm = vmAtAxial(governing_axial);

  return {
    hoop,
    bending,
    pressure_axial,
    tension_axial,
    max_axial,
    governing_axial,
    von_mises: vm,
    yield_pct: (vm / smys) * 100,
    smys_mpa: smys,
  };
}
