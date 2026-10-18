// Central registry for Hub tile metadata. Drives order + visibility
// controlled by /api/me/prefs → hub_tiles.
import {
  Activity, AlertOctagon, Box, Calendar, CheckSquare, ClipboardList,
  DollarSign, FileSpreadsheet, FileText, Flame, Gauge, GraduationCap,
  Layers, Mail, MessageSquare, Package, ShieldCheck, Sparkles, UserCog,
  Users, Wrench, Ticket, MessageSquarePlus, Zap,
} from "lucide-react";

export const HUB_TILES = {
  "live-ops": {
    label: "Live Ops",
    Icon: Zap,
    accent: "bg-[#F0F9F3] text-[#0D6535]",
    path: "/live-ops",
    badge: "LIVE",
    subtitle: "Split-screen Von Mises + Fatigue + Weight + Pressure + chart. Click any panel to go full-screen.",
    required: true,          // always available (recommended as home default)
  },
  workbook: {
    label: "Workbook (17 Sheets)", Icon: FileSpreadsheet, accent: "bg-[#E6F4EA] text-[#107C41]",
    path: "/app", subtitle: "The classic calculation workbook — hydraulics, N2, fishing, and 14 more.",
  },
  "ctd-calculator": {
    label: "CT Drilling Calculator", Icon: Flame, accent: "bg-[#FDE8E8] text-[#C00000]",
    path: "/ctd-calculator", subtitle: "Balanced & underbalanced drilling solver. ECD, BHP, N₂ GLR, choke & UB-margin.",
  },
  reels: {
    label: "String & Reel Manager", Icon: Layers, accent: "bg-[#FEF3C7] text-[#92400E]",
    path: "/reels", subtitle: "Tapered CT reel profile — the active reel feeds every sheet, Von Mises egg, and fatigue heatmap.",
  },
  stress: {
    label: "Triaxial · Von Mises Egg", Icon: Gauge, accent: "bg-[#FDE8E8] text-[#C00000]",
    path: "/stress", subtitle: "API RP 5C7 live operating envelope. Visual alert when operating point crosses 80% SMYS.",
  },
  fatigue: {
    label: "Reel Fatigue Heatmap", Icon: Activity, accent: "bg-[#F0F9F3] text-[#0D6535]",
    path: "/fatigue", subtitle: "Palmgren-Miner damage per station. Green → red at 80% derate.",
  },
  wellbore: {
    label: "3D Wellbore Viewer", Icon: Box, accent: "bg-[#DBEAFE] text-[#0056B3]",
    path: "/wellbore", subtitle: "Minimum-curvature survey rendered in 3D. BHA tip animates with depth.",
  },
  certs: {
    label: "Crew Certifications", Icon: ShieldCheck, accent: "bg-[#DCFCE7] text-[#065F46]",
    path: "/certs", subtitle: "Lifting, iron, PCE, CT unit, snubbing, H2S, first aid — expiry traffic lights.",
  },
  tasks: {
    label: "Daily Tasks", Icon: CheckSquare, accent: "bg-[#E0E7FF] text-[#4338CA]",
    path: "/tasks", subtitle: "Supervisor-assigned tasks. Crew ticks them complete through the day.",
  },
  "parts-orders": {
    label: "Parts Orders", Icon: Package, accent: "bg-[#FCE7C0] text-[#C36600]",
    path: "/parts-orders", subtitle: "Crew submit → Supervisor approve → Procurement. Audit trail.",
  },
  timecards: {
    label: "Timecards & Payroll", Icon: DollarSign, accent: "bg-[#DCFCE7] text-[#065F46]",
    path: "/timecards", subtitle: "Multi-activity shift entry: Field / Shop / Travel / Moving Equipment at their own rates.",
  },
  "crew-admin": {
    label: "Crew Admin", Icon: UserCog, accent: "bg-[#E0E7FF] text-[#5A67D8]",
    path: "/crew-admin", subtitle: "Promote crew, set base pay rates, restrict workspace domain.",
    roleGate: "supervisor",
  },
  documents: {
    label: "Company Documents", Icon: FileText, accent: "bg-[#DBEAFE] text-[#0056B3]",
    path: "/documents", subtitle: "Upload SOPs, maintenance & checklists. AI references them alongside industry standards.",
  },
  "erp-template": {
    label: "Site-Specific ERP Template", Icon: AlertOctagon, accent: "bg-[#FDE8E8] text-[#C00000]",
    path: "/erp-template", subtitle: "1-page emergency response cover sheet — crew, muster, hospital. Fill, save, print.",
  },
  "crew-contacts": {
    label: "Crew Email Contacts", Icon: Mail, accent: "bg-[#E6F4EA] text-[#0D6535]",
    path: "/crew-contacts", subtitle: "Address book for shift-end handover emails. Mark defaults for one-click send.",
  },
  equipment: {
    label: "Equipment & Assets", Icon: Wrench, accent: "bg-[#FCE7C0] text-[#C36600]",
    path: "/equipment", subtitle: "Engine hours, injector meters, lifting certs, BOP/PCE tests, reel + iron MAWP.",
  },
  schedule: {
    label: "Crew Schedule", Icon: Calendar, accent: "bg-[#DBEAFE] text-[#0056B3]",
    path: "/schedule", subtitle: "Assign day/night shifts with 14/14, 20/10 rotations. Print or save as PDF.",
  },
  treatment: {
    label: "Treatment Log", Icon: ClipboardList, accent: "bg-[#F0F9F3] text-[#0D6535]",
    path: "/treatment", subtitle: "Timestamped job log everyone on the rig sees in real time. Perfect for handovers.",
  },
  "team-hub": {
    label: "Team Hub (chat · inventory · to-dos)", Icon: Users, accent: "bg-[#E6F4EA] text-[#0D6535]",
    path: "/team-hub", subtitle: "Rig-scoped crew chat, inventory, parts, consumables, and to-dos.",
  },
  emergency: {
    label: "Emergency SOPs", Icon: AlertOctagon, accent: "bg-[#F8D7DA] text-[#C00000]",
    path: "/app", pathState: { openEmergency: true },
    subtitle: "17 scenarios with AER/OH&S citations.",
  },
  training: {
    label: "Training Mode", Icon: GraduationCap, accent: "bg-[#E0E7FF] text-[#5A67D8]",
    path: "#training",
    subtitle: "Plain-English walk-throughs of what's happening downhole.",
  },
};

export const DEFAULT_TILE_ORDER = [
  "live-ops", "workbook", "ctd-calculator", "reels", "stress", "fatigue",
  "wellbore", "certs", "tasks", "parts-orders", "timecards",
  "treatment", "team-hub", "documents", "erp-template", "crew-contacts",
  "equipment", "schedule", "crew-admin", "emergency", "training",
];
