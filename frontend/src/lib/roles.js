import React from "react";
// Three-role RBAC helpers (plan terms): guest | crew | supervisor | management
// Backend stores legacy names: crew | field_manager | ops_manager
const LEGACY_TO_PLAN = {
  guest: "guest",
  crew: "crew",
  field_manager: "supervisor",
  ops_manager: "management",
  supervisor: "supervisor",
  management: "management",
  admin: "management",
};

// 4-tier field RBAC: operator < lead_op < supervisor < management.
export const TIERS = ["operator", "lead_op", "supervisor", "management"];
const LEGACY_TO_TIER = {
  crew: "operator", operator: "operator",
  lead_op: "lead_op", lead_operator: "lead_op", lead: "lead_op",
  field_manager: "supervisor", supervisor: "supervisor",
  ops_manager: "management", management: "management", admin: "management",
};
export const TIER_LABEL = { operator: "Operator", lead_op: "Lead Operator", supervisor: "Supervisor", management: "Management" };
const TIER_TO_PLAN = { operator: "crew", lead_op: "crew", supervisor: "supervisor", management: "management" };

// Test Role View: client-side effective-role override, persisted per browser session.
const ROLE_VIEW_KEY = "aegis_test_role_view";
const roleViewListeners = new Set();
export const isBetaTestMode = () => process.env.REACT_APP_BETA_TEST_MODE === "true";
const realTier = (user) => LEGACY_TO_TIER[(user?.role || "crew").toLowerCase()] || "operator";
export const canSwitchRoleView = (user) => !!user && (realTier(user) === "management" || isBetaTestMode());
export const getRoleView = () => {
  try { const v = sessionStorage.getItem(ROLE_VIEW_KEY); return TIERS.includes(v) ? v : null; } catch { return null; }
};
export const setRoleView = (tier) => {
  try {
    if (TIERS.includes(tier)) sessionStorage.setItem(ROLE_VIEW_KEY, tier); else sessionStorage.removeItem(ROLE_VIEW_KEY);
  } catch { /* storage unavailable */ }
  roleViewListeners.forEach((fn) => fn());
};
export const subscribeRoleView = (fn) => { roleViewListeners.add(fn); return () => roleViewListeners.delete(fn); };

export function tierRole(user) {
  const raw = (user?.role || "crew").toLowerCase();
  if (raw === "guest") return "guest";
  const override = canSwitchRoleView(user) ? getRoleView() : null;
  return override || LEGACY_TO_TIER[raw] || "operator";
}
export const tierRank = (tier) => TIERS.indexOf(tier);

export function planRole(user) {
  const raw = (user?.role || "crew").toLowerCase();
  if (raw === "guest") return "guest";
  const override = canSwitchRoleView(user) ? getRoleView() : null;
  if (override) return TIER_TO_PLAN[override];
  return LEGACY_TO_PLAN[raw] || "crew";
}

const OPERATOR_VIEWS = ["cockpit", "classic", "treatment_log", "tasks", "parts", "calculators", "sop"];
const LEAD_VIEWS = [...OPERATOR_VIEWS, "task_assign", "company_docs_upload"];
const SUPERVISOR_VIEWS = [...LEAD_VIEWS, "job_setup", "job_log_admin", "approval_queue"];
const MANAGEMENT_VIEWS = [...SUPERVISOR_VIEWS, "management", "po_signoff", "audit_ledger"];
export const VIEW_MATRIX = {
  operator: new Set(OPERATOR_VIEWS),
  lead_op: new Set(LEAD_VIEWS),
  supervisor: new Set(SUPERVISOR_VIEWS),
  management: new Set(MANAGEMENT_VIEWS),
};
export const VIEWS = MANAGEMENT_VIEWS;
export const canView = (user, view) => !!user && !!VIEW_MATRIX[tierRole(user)]?.has(view);

export function useRoleView() {
  const [, bump] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => subscribeRoleView(bump), []);
  return getRoleView();
}

export const isGuest = (user) => planRole(user) === "guest";
export const isCrewOrHigher = (user) => ["crew", "supervisor", "management"].includes(planRole(user));
export const isSupervisorOrHigher = (user) => ["supervisor", "management"].includes(planRole(user));
export const isManagement = (user) => planRole(user) === "management";
export const isCrew = (user) => planRole(user) === "crew";
export const isLeadOpOrHigher = (user) => tierRank(tierRole(user)) >= 1;

// Operational routes a guest / client can still see (view-only).
// Everything NOT in this set is hidden for guests — pay, schedule, planning, crew admin.
export const GUEST_ALLOWED_PATHS = new Set([
  "/job", "/live", "/log", "/calc", "/more", "/sop",
  "/hub", "/live-ops", "/live-ops/classic", "/stress", "/fatigue", "/wellbore", "/reels",
  "/treatment", "/documents", "/erp-template", "/app", "/ctd-calculator",
]);

export const ROLE_LABEL = {
  guest: "Client · Guest",
  crew: "Crew",
  operator: "Operator",
  lead_op: "Lead Operator",
  supervisor: "Supervisor",
  management: "Management",
};
