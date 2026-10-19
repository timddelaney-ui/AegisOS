/**
 * CoilAegis Pricing Tier Catalog — single source of truth.
 *
 * Three plan tiers:
 *   • `personal`  — individual field engineers, no crew
 *   • `smallmed`  — small-to-medium crew (adds timecards / payroll / crew)
 *   • `enterprise`— full ops stack (live DAQ, 3D wellbore, dossier email, …)
 *
 * The `beta_unlock` flag on the backend overrides all gating so Field Test
 * Beta users see every feature regardless of plan. Keep the matrix in sync
 * with the Pricing page and Tutorial copy — those pages derive from
 * TIER_SPECS and FEATURE_SPECS below.
 */

export const TIER_PERSONAL   = "personal";
export const TIER_SMALLMED   = "smallmed";
export const TIER_ENTERPRISE = "enterprise";

export const TIER_ORDER = [TIER_PERSONAL, TIER_SMALLMED, TIER_ENTERPRISE];

export const TIER_SPECS = {
  [TIER_PERSONAL]: {
    id: TIER_PERSONAL,
    label: "Personal",
    tagline: "Individual field engineer",
    price_monthly_usd: 9.99,
    price_yearly_usd: 79,
    seats: "1 seat",
    highlights: [
      "AI assistant",
      "Training mode & tutorials",
      "Workbooks + SOP library",
      "Daily tasks",
      "Parts orders",
      "ERP templates",
      "Equipment & assets",
    ],
    accent: "#06B6D4",     // cyan
    glow: "rgba(6,182,212,0.25)",
  },
  [TIER_SMALLMED]: {
    id: TIER_SMALLMED,
    label: "Small-Med Crew",
    tagline: "Up to 15 crew members",
    price_monthly_usd: 29.99,
    price_yearly_usd: 249,
    seats: "Up to 15 seats",
    highlights: [
      "Everything in Personal",
      "Timecards + Payroll",
      "Position Designation (RBAC)",
      "Crew schedule",
      "Crew contacts / address book",
      "Team invites",
    ],
    accent: "#F59E0B",     // gold
    glow: "rgba(245,158,11,0.3)",
    popular: true,
  },
  [TIER_ENTERPRISE]: {
    id: TIER_ENTERPRISE,
    label: "Enterprise",
    tagline: "Full ops stack",
    price_monthly_usd: null,  // custom
    price_yearly_usd: null,
    seats: "Unlimited seats",
    highlights: [
      "Everything in Small-Med",
      "Live Ops console (1 Hz telemetry)",
      "3D Wellbore + DLS color",
      "Reel Fatigue (Palmgren-Miner)",
      "Treatment log + Codes 1-69",
      "Engineering Audit Dossier + email",
      "Live DAQ ingest (Modbus / WITS / WITSML)",
      "Von Mises & CT Drilling calculators",
      "Document vault",
      "Jobs ledger",
      "Security & Compliance (TLS badge, encrypted notes, AI privacy, audit log)",
    ],
    accent: "#EF4444",     // crimson
    glow: "rgba(239,68,68,0.3)",
  },
};

/**
 * Features used throughout the app. The `visibility` field controls what
 * lower tiers see:
 *   • `teaser`  — show nav entry with a lock icon; clicking triggers upgrade
 *   • `hidden`  — enterprise-only features that lower tiers can't even see
 */
export const FEATURE_SPECS = {
  // --- Personal tier ---
  ai_panel:         { minTier: TIER_PERSONAL, visibility: "teaser",  label: "AI assistant" },
  training:         { minTier: TIER_PERSONAL, visibility: "teaser",  label: "Training mode" },
  workbooks:        { minTier: TIER_PERSONAL, visibility: "teaser",  label: "Workbooks" },
  sop_library:      { minTier: TIER_PERSONAL, visibility: "teaser",  label: "SOP library" },
  daily_tasks:      { minTier: TIER_PERSONAL, visibility: "teaser",  label: "Daily tasks" },
  parts_orders:     { minTier: TIER_PERSONAL, visibility: "teaser",  label: "Parts orders" },
  erp_templates:    { minTier: TIER_PERSONAL, visibility: "teaser",  label: "ERP templates" },
  equipment_assets: { minTier: TIER_PERSONAL, visibility: "teaser",  label: "Equipment & assets" },
  certifications:   { minTier: TIER_PERSONAL, visibility: "teaser",  label: "Certifications" },
  hub:              { minTier: TIER_PERSONAL, visibility: "teaser",  label: "Hub" },

  // --- Small-Med Crew tier (crew-y, hybrid teasers to Personal) ---
  timecards:        { minTier: TIER_SMALLMED, visibility: "teaser",  label: "Timecards & payroll" },
  rbac_admin:       { minTier: TIER_SMALLMED, visibility: "teaser",  label: "Position Designation" },
  crew_schedule:    { minTier: TIER_SMALLMED, visibility: "teaser",  label: "Crew schedule" },
  crew_contacts:    { minTier: TIER_SMALLMED, visibility: "teaser",  label: "Crew contacts" },
  team_mgmt:        { minTier: TIER_SMALLMED, visibility: "teaser",  label: "Team management" },

  // --- Enterprise tier (completely hidden from lower tiers) ---
  live_ops:           { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Live Ops console" },
  daq_ingest:         { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Live DAQ ingest" },
  wellbore_3d:        { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "3D Wellbore" },
  reel_fatigue:       { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Reel Fatigue" },
  treatment_log:      { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Treatment log" },
  dossier:            { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Audit Dossier + email" },
  von_mises:          { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Von Mises stress" },
  ct_drill_calc:      { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "CT Drilling calculator" },
  reels_mgmt:         { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Reels management" },
  documents:          { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Document vault" },
  jobs_ledger:        { minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Jobs ledger" },
  security_compliance:{ minTier: TIER_ENTERPRISE, visibility: "hidden", label: "Security & Compliance" },
};

// Routes → feature. `/pricing`, `/login`, `/auth-callback` and `/share/*` are
// never gated so we don't list them here.
export const ROUTE_FEATURES = {
  "/hub":               "hub",
  "/app":               "workbooks",
  "/team":              "team_mgmt",
  "/jobs":              "jobs_ledger",
  "/equipment":         "equipment_assets",
  "/schedule":          "crew_schedule",
  "/treatment":         "treatment_log",
  "/ctd-calculator":    "ct_drill_calc",
  "/documents":         "documents",
  "/erp-template":      "erp_templates",
  "/crew-contacts":     "crew_contacts",
  "/reels":             "reels_mgmt",
  "/stress":            "von_mises",
  "/fatigue":           "reel_fatigue",
  "/wellbore":          "wellbore_3d",
  "/certs":             "certifications",
  "/tasks":             "daily_tasks",
  "/parts-orders":      "parts_orders",
  "/timecards":         "timecards",
  "/crew-admin":        "rbac_admin",
  "/live-ops":          "live_ops",
  "/daq":               "daq_ingest",
  "/security":          "security_compliance",
};
export const tierIndex = (tier) => {
  const i = TIER_ORDER.indexOf(tier);
  return i < 0 ? 0 : i;
};

/** Does `tier` meet or exceed the minimum required for this feature? */
export const tierHasAccess = (tier, featureId) => {
  const spec = FEATURE_SPECS[featureId];
  if (!spec) return true; // unknown feature → never gate (safety)
  return tierIndex(tier) >= tierIndex(spec.minTier);
};

/** Should the feature be shown as a locked teaser to this tier? */
export const tierShowsLockedTeaser = (tier, featureId) => {
  const spec = FEATURE_SPECS[featureId];
  if (!spec) return false;
  if (tierHasAccess(tier, featureId)) return false;
  return spec.visibility === "teaser";
};

/** Should the feature be hidden ENTIRELY from this tier's navigation? */
export const tierHidesCompletely = (tier, featureId) => {
  const spec = FEATURE_SPECS[featureId];
  if (!spec) return false;
  if (tierHasAccess(tier, featureId)) return false;
  return spec.visibility === "hidden";
};

/** Returns the lowest tier that unlocks the given feature. */
export const minTierFor = (featureId) => FEATURE_SPECS[featureId]?.minTier || TIER_PERSONAL;
