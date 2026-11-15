const liveFields = {
  depth: ["depth_ft", "encoder_1_depth_ft", "encoder_2_depth_ft", "encoder_3_depth_ft", "traction_wheel_depth_ft", "gooseneck_depth_ft", "levelwind_depth_ft"],
  whp: ["whp_psi", "wellhead_pressure_psi"], weight: ["weight_lb", "pipe_weight_lbs"],
  internalPress: ["p_internal_psi"], annulusPress: ["p_external_psi", "annulus_pressure_psi"],
  vonMises: ["vm_utilization"], n2Rate: ["n2Rate"],
  skatePressure: ["traction_pressure_psi", "p_skate_psi"],
};
export function operatorValueSource({ feedMode, liveStale, lastLiveSample }, key) {
  const hasLiveField = lastLiveSample && (liveFields[key] || [key]).some((field) => lastLiveSample[field] != null);
  if (feedMode === "STANDBY") return hasLiveField ? "standby / last live held" : "standby / simulated or retained value";
  if (feedMode === "SIM") return lastLiveSample ? "last live / simulation starting" : "simulated";
  if (liveStale) return "DAQ stale / simulated fallback or held value";
  if (!lastLiveSample) return "awaiting live / simulated held";
  return hasLiveField ? "live DAQ" : "no live channel / retained value";
}
