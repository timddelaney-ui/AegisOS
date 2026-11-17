/** Commercial entitlements for Aegis OS. Keep prices aligned with backend billing. */
export const TIER_FREE = "free";
export const TIER_PRO = "pro";
export const TIER_FIELD_PILOT = "field_pilot";
export const TIER_FLEET = "fleet";

// Legacy names remain aliases for callers that still use the original catalog.
export const TIER_PERSONAL = TIER_FREE;
export const TIER_SMALLMED = TIER_PRO;
export const TIER_ENTERPRISE = TIER_FLEET;
export const TIER_ORDER = [TIER_FREE, TIER_PRO, TIER_FIELD_PILOT, TIER_FLEET];

export const normalizeTier = (tier) => ({
  personal: TIER_FREE,
  smallmed: TIER_PRO,
  workbook_pro: TIER_PRO,
  enterprise: TIER_FLEET,
  aegis_fleet: TIER_FLEET,
  trial: TIER_FREE,
}[tier] || (TIER_ORDER.includes(tier) ? tier : TIER_FREE));

export const TIER_SPECS = {
  [TIER_FREE]: {
    id: TIER_FREE,
    label: "Free Basic",
    tagline: "Individual field user",
    price_monthly_cad: 0,
    seats: "1 user",
    highlights: ["17 offline physics calculators", "Public AER / IWCF emergency SOPs"],
    accent: "#06B6D4",
    glow: "rgba(6,182,212,0.25)",
  },
  [TIER_PRO]: {
    id: TIER_PRO,
    label: "CT Field Workbook Pro",
    tagline: "Individual field engineer",
    price_monthly_cad: 69,
    seats: "Per user",
    highlights: ["Everything in Free", "Advanced offline notes and personal field logs", "Multi-device sync", "Team and crew collaboration"],
    accent: "#F59E0B",
    glow: "rgba(245,158,11,0.3)",
    popular: true,
  },
  [TIER_FIELD_PILOT]: {
    id: TIER_FIELD_PILOT,
    label: "Field Pilot",
    tagline: "Authenticated pilot units",
    price_monthly_cad: null,
    price_active_monthly_cad: 2150,
    price_standby_monthly_cad: 715,
    seats: "Target rig units only",
    highlights: ["Rig telemetry: Modbus TCP, OPC UA, WITS0, WITSML", "Mission Control cockpit and multi-pen strip charts", "Von Mises fatigue tracking", "5-channel fluid totalizers"],
    accent: "#8B5CF6",
    glow: "rgba(139,92,246,0.3)",
  },
  [TIER_FLEET]: {
    id: TIER_FLEET,
    label: "Fleet Enterprise",
    tagline: "Multi-rig operations",
    price_monthly_cad: null,
    seats: "5+ units",
    highlights: ["Everything in Field Pilot", "Multi-tenant RBAC and audit logs", "Rig provisioning and engineer assignments", "Fleet dashboards"],
    accent: "#EF4444",
    glow: "rgba(239,68,68,0.3)",
  },
};
TIER_SPECS.enterprise = TIER_SPECS[TIER_FLEET];

export const FEATURE_SPECS = {
  workbooks: { minTier: TIER_FREE, visibility: "teaser", label: "17 offline calculators" },
  sop_library: { minTier: TIER_FREE, visibility: "teaser", label: "Emergency SOPs" },
  hub: { minTier: TIER_FREE, visibility: "teaser", label: "Hub" },

  ai_panel: { minTier: TIER_PRO, visibility: "teaser", label: "AI assistant" },
  training: { minTier: TIER_PRO, visibility: "teaser", label: "Training mode" },
  daily_tasks: { minTier: TIER_PRO, visibility: "teaser", label: "Daily tasks" },
  parts_orders: { minTier: TIER_PRO, visibility: "teaser", label: "Parts orders" },
  erp_templates: { minTier: TIER_PRO, visibility: "teaser", label: "ERP templates" },
  equipment_assets: { minTier: TIER_PRO, visibility: "teaser", label: "Equipment & assets" },
  certifications: { minTier: TIER_PRO, visibility: "teaser", label: "Certifications" },
  timecards: { minTier: TIER_PRO, visibility: "teaser", label: "Timecards & payroll" },
  crew_schedule: { minTier: TIER_PRO, visibility: "teaser", label: "Crew schedule" },
  crew_contacts: { minTier: TIER_PRO, visibility: "teaser", label: "Crew contacts" },
  team_mgmt: { minTier: TIER_PRO, visibility: "teaser", label: "Team and crew collaboration" },
  jobs_ledger: { minTier: TIER_PRO, visibility: "teaser", label: "Personal field logs and saved jobs" },
  handover: { minTier: TIER_PRO, visibility: "teaser", label: "Field handovers" },

  live_ops: { minTier: TIER_FIELD_PILOT, visibility: "hidden", label: "Mission Control cockpit" },
  daq_ingest: { minTier: TIER_FIELD_PILOT, visibility: "hidden", label: "Rig telemetry and DAQ" },
  wellbore_3d: { minTier: TIER_FIELD_PILOT, visibility: "hidden", label: "3D Wellbore" },
  reel_fatigue: { minTier: TIER_FIELD_PILOT, visibility: "hidden", label: "Von Mises fatigue tracking" },
  treatment_log: { minTier: TIER_FIELD_PILOT, visibility: "hidden", label: "Treatment log" },
  von_mises: { minTier: TIER_FIELD_PILOT, visibility: "hidden", label: "Von Mises stress" },
  ct_drill_calc: { minTier: TIER_FIELD_PILOT, visibility: "hidden", label: "CT Drilling calculator" },
  reels_mgmt: { minTier: TIER_FIELD_PILOT, visibility: "hidden", label: "Reels management" },
  fluid_totalizers: { minTier: TIER_FIELD_PILOT, visibility: "hidden", label: "Fluid totalizers" },

  rbac_admin: { minTier: TIER_FLEET, visibility: "hidden", label: "Management controls" },
  documents: { minTier: TIER_FLEET, visibility: "hidden", label: "Organization document vault" },
  security_compliance: { minTier: TIER_FLEET, visibility: "hidden", label: "Security & Compliance" },
  shadow_mode: { minTier: TIER_FLEET, visibility: "hidden", label: "Shadow Mode verification" },
  exec_dashboard: { minTier: TIER_FLEET, visibility: "hidden", label: "Executive dashboard" },
  manager_dashboard: { minTier: TIER_FLEET, visibility: "hidden", label: "Management dashboard" },
  fleet_assignments: { minTier: TIER_FLEET, visibility: "hidden", label: "Fleet & Engineer Assignment Portal" },
};

export const ROUTE_FEATURES = {
  "/hub": "hub",
  "/app": "workbooks",
  "/sop": "sop_library",
  "/team": "team_mgmt",
  "/jobs": "jobs_ledger",
  "/equipment": "equipment_assets",
  "/schedule": "crew_schedule",
  "/treatment": "treatment_log",
  "/ctd-calculator": "ct_drill_calc",
  "/documents": "documents",
  "/erp-template": "erp_templates",
  "/crew-contacts": "crew_contacts",
  "/reels": "reels_mgmt",
  "/stress": "von_mises",
  "/fatigue": "reel_fatigue",
  "/wellbore": "wellbore_3d",
  "/certs": "certifications",
  "/tasks": "daily_tasks",
  "/parts-orders": "parts_orders",
  "/timecards": "timecards",
  "/crew-admin": "rbac_admin",
  "/live": "live_ops",
  "/live-ops": "live_ops",
  "/daq": "daq_ingest",
  "/security": "security_compliance",
  "/shadow": "shadow_mode",
  "/executive": "exec_dashboard",
  "/manager": "manager_dashboard",
  "/unified-platform": "fleet_assignments",
};

export const tierIndex = (tier) => Math.max(0, TIER_ORDER.indexOf(normalizeTier(tier)));
export const tierHasAccess = (tier, featureId) => {
  const spec = FEATURE_SPECS[featureId];
  return Boolean(spec && tierIndex(tier) >= tierIndex(spec.minTier));
};
export const tierShowsLockedTeaser = (tier, featureId) => {
  const spec = FEATURE_SPECS[featureId];
  return Boolean(spec && !tierHasAccess(tier, featureId) && spec.visibility === "teaser");
};
export const tierHidesCompletely = (tier, featureId) => {
  const spec = FEATURE_SPECS[featureId];
  return Boolean(spec && !tierHasAccess(tier, featureId) && spec.visibility === "hidden");
};
export const minTierFor = (featureId) => FEATURE_SPECS[featureId]?.minTier || TIER_PRO;
