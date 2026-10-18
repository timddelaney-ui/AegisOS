// Shared jittered CT simulator — one source of truth for Live Ops and the
// Treatment split-screen sidebar. Replaced by real WITS/Modbus data in Phase 2.
export function nextSimSample(prev, t) {
  const base = {
    depth_ft: Math.min(10000, (prev?.depth_ft || 0) + (Math.random() > 0.3 ? 40 : -20)),
    p_internal_psi: 4500 + 2500 * Math.sin(t / 15) + (Math.random() - 0.5) * 800,
    p_external_psi: 1200 + 100 * Math.sin(t / 30),
    traction_pressure_psi: 1100 + 600 * Math.sin(t / 10 + 0.6) + (Math.random() - 0.5) * 300,
    weight_lb: 12000 + 7000 * Math.sin(t / 20 + 1.1) + (Math.random() - 0.5) * 500,
    axial_force_lbf: 8000 + 6000 * Math.sin(t / 20 + 1.1),
    pressure_psi: 4500 + 2500 * Math.sin(t / 15),
  };
  base.depth_ft = Math.max(0, Math.min(10000, base.depth_ft));
  return base;
}

export const SIM_RING = 600;      // 10 minutes @ 1 Hz
export const SIM_TICK_MS = 1000;  // 1 Hz
export const SIM_CHART_WINDOW = 180;
