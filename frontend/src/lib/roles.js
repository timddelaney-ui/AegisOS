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

export function planRole(user) {
  const raw = (user?.role || "crew").toLowerCase();
  return LEGACY_TO_PLAN[raw] || "crew";
}

export const isGuest = (user) => planRole(user) === "guest";
export const isCrewOrHigher = (user) => ["crew", "supervisor", "management"].includes(planRole(user));
export const isSupervisorOrHigher = (user) => ["supervisor", "management"].includes(planRole(user));
export const isManagement = (user) => planRole(user) === "management";
export const isCrew = (user) => planRole(user) === "crew";

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
  supervisor: "Supervisor",
  management: "Management",
};
