const buildTickSample = ({ prev, t, realSample, activeReel, fatigueWorst, connected }) => {
  const last = prev?.[prev.length - 1];
  const raw = realSample || {
    ...nextSimSample(last, t),
    ts: new Date(Date.now()).toISOString(),
    source: connected ? "wits_fallback_sim" : "simulated",
  };
  const seg = intervalAt(activeReel, raw.depth_ft || 0) || { od_in: 2.0, wt_in: 0.175, smys_psi: 90000 };
  const vm = triaxialVonMises({
    OD: seg.od_in,
    WT: seg.wt_in,
    p_i: raw.p_internal_psi || 0,
    p_o: raw.p_external_psi || 0,
    F_axial: raw.axial_force_lbf || 0,
    smys: seg.smys_psi,
  });
  return {
    ...raw,
    vm_utilization: raw.vm_utilization != null ? raw.vm_utilization : (vm?.utilization || 0),
    fatigue_worst: raw.fatigue_worst != null ? raw.fatigue_worst : (fatigueWorst || 0),
  };
};

export default function LiveOpsPage() {
