// Three-role RBAC helpers (plan terms): crew | supervisor | management
// Backend stores legacy names: crew | field_manager | ops_manager
const LEGACY_TO_PLAN = {
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

export const isSupervisorOrHigher = (user) => ["supervisor", "management"].includes(planRole(user));
export const isManagement = (user) => planRole(user) === "management";
export const isCrew = (user) => planRole(user) === "crew";

export const ROLE_LABEL = {
  crew: "Crew",
  supervisor: "Supervisor",
  management: "Management",
};
