import {
  Activity, AlertOctagon, Box, Calendar, CheckSquare, ClipboardList, DollarSign,
  FileSpreadsheet, FileText, Flame, Gauge, GraduationCap, Layers, Mail, Package,
  ShieldCheck, UserCog, Users, Wrench, Ticket, MessageSquarePlus, Zap, LayoutDashboard,
  ScanEye, FolderOpen,
} from "lucide-react";
import { planRole } from "../lib/roles";

const allRoles = ["guest", "crew", "supervisor", "management"];
const crewRoles = ["crew", "supervisor", "management"];
const leaders = ["supervisor", "management"];
const allPhases = ["plan", "rig-up", "run", "handover"];
function tool(id, title, route, category, icon, options = {}) {
  return { id, title, route, category, icon, phases: allPhases, roles: allRoles, badge: null, legacyHub: true, ...options };
}
export const TOOL_REGISTRY = [
  tool("live-ops", "Live Ops", "/live", "operations", Zap, { feature: "live_ops", aliases: ["/live-ops", "/live-ops/classic"], phases: ["rig-up", "run"], badge: "LIVE", required: true, fleetOnly: true }),
  tool("workbook", "Workbook (17 Sheets)", "/app", "engineering", FileSpreadsheet, { feature: "workbooks", legacyHub: false }),
  tool("ctd-calculator", "CT Drilling Calculator", "/ctd-calculator", "engineering", Flame, { feature: "ct_drill_calc", phases: ["plan", "run"] }),
  tool("reels", "String & Reel Manager", "/reels", "engineering", Layers, { feature: "reels_mgmt", phases: ["plan", "rig-up", "handover"], fleetOnly: true }),
  tool("stress", "Triaxial / Von Mises Egg", "/stress", "engineering", Gauge, { feature: "von_mises", phases: ["plan", "run"] }),
  tool("fatigue", "Reel Fatigue Heatmap", "/fatigue", "engineering", Activity, { feature: "reel_fatigue", phases: ["plan", "run", "handover"], fleetOnly: true }),
  tool("wellbore", "3D Wellbore Viewer", "/wellbore", "engineering", Box, { feature: "wellbore_3d", phases: ["plan", "rig-up", "run"] }),
  tool("daq", "DAQ Listeners", "/daq", "operations", Activity, { feature: "daq_ingest", roles: crewRoles, phases: ["rig-up", "run"], fleetOnly: true }),
  tool("equipment", "Equipment & Assets", "/equipment", "operations", Wrench, { feature: "equipment_assets", roles: crewRoles, phases: ["plan", "rig-up", "handover"] }),
  tool("treatment", "Treatment Log", "/log", "operations", ClipboardList, { feature: "treatment_log", aliases: ["/treatment"], phases: ["rig-up", "run", "handover"] }),
  tool("certs", "Crew Certifications", "/certs", "crew", ShieldCheck, { feature: "certifications", roles: crewRoles, phases: ["plan", "rig-up"] }),
  tool("tasks", "Daily Tasks", "/tasks", "crew", CheckSquare, { feature: "daily_tasks", roles: crewRoles }),
  tool("parts-orders", "Parts Orders", "/parts-orders", "crew", Package, { feature: "parts_orders", roles: crewRoles }),
  tool("timecards", "Timecards & Payroll", "/timecards", "crew", DollarSign, { feature: "timecards", roles: crewRoles, phases: ["handover"] }),
  tool("crew-admin", "Crew Admin", "/crew-admin", "crew", UserCog, { feature: "rbac_admin", roles: ["management"], phases: ["plan"], fleetOnly: true }),
  tool("schedule", "Crew Schedule", "/schedule", "crew", Calendar, { feature: "crew_schedule", roles: crewRoles, phases: ["plan", "handover"] }),
  tool("crew-contacts", "Crew Email Contacts", "/crew-contacts", "crew", Mail, { feature: "crew_contacts", phases: ["plan", "handover"] }),
  tool("team-hub", "Team Hub", "/team", "crew", Users, { feature: "team_mgmt", roles: crewRoles, legacyHub: false }),
  tool("jobs", "Saved Calculations", "/jobs", "engineering", FolderOpen, { feature: "jobs_ledger", roles: crewRoles, legacyHub: false }),
  tool("documents", "Company Documents", "/documents", "resources", FileText, { feature: "documents" }),
  tool("erp-template", "Site-Specific ERP Template", "/erp-template", "resources", AlertOctagon, { feature: "erp_templates", phases: ["plan", "rig-up"] }),
  tool("emergency", "Emergency SOPs", "/sop", "resources", AlertOctagon, { feature: "workbooks", pinned: true, required: true, badge: "SAFETY" }),
  tool("security", "Security & Compliance", "/security", "resources", ShieldCheck, { feature: "security_compliance", roles: crewRoles }),
  tool("manager", "Manager Dashboard", "/manager", "crew", LayoutDashboard, { roles: leaders, legacyHub: false, fleetOnly: true }),
  tool("executive", "Executive Dashboard", "/executive", "operations", LayoutDashboard, { feature: "exec_dashboard", roles: leaders, legacyHub: false, fleetOnly: true }),
  tool("shadow", "Shadow Mode Verification", "/shadow", "engineering", ScanEye, { feature: "shadow_mode", roles: crewRoles, legacyHub: false }),
  tool("handover", "Shift-end Handover", "/job?handover=1", "operations", Mail, { roles: crewRoles, phases: ["handover"], legacyHub: false }),
  tool("training", "Training Mode", "#training", "resources", GraduationCap),
  tool("redeem", "Redeem Access Code", "#redeem", "resources", Ticket),
  tool("feedback", "Send Feedback", "#feedback", "resources", MessageSquarePlus),
];
export const TOOL_CATEGORIES = [
  { id: "operations", title: "Rig operations" },
  { id: "engineering", title: "Engineering & calculations" },
  { id: "crew", title: "Crew & planning" },
  { id: "resources", title: "Documents, safety & support" },
];
export const getTool = (id) => TOOL_REGISTRY.find((item) => item.id === id);
export const toolForPath = (pathname) => TOOL_REGISTRY.find((item) =>
  item.route.split("?")[0] === pathname || item.aliases?.includes(pathname) || (item.id === "erp-template" && pathname.startsWith("/erp-template/")));
export function filterTools({ query = "", phase = "all", user, hidden = [], canAccess = () => true, hidesCompletely = () => false } = {}) {
  const search = query.trim().toLowerCase();
  const role = planRole(user);
  const hiddenIds = new Set(hidden);
  return TOOL_REGISTRY.filter((item) =>
    item.roles.includes(role) &&
    (!hiddenIds.has(item.id) || item.required) &&
    (phase === "all" || item.phases.includes(phase) || item.pinned) &&
    (!search || `${item.title} ${item.category} ${item.id}`.toLowerCase().includes(search)) &&
    (!item.fleetOnly || user?.effective_plan === "aegis_fleet") &&
    (!item.feature || canAccess(item.feature) || !hidesCompletely(item.feature)));
}
