import React from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { BriefcaseBusiness, Activity, ClipboardList, Calculator, Menu, AlertOctagon } from "lucide-react";
import ErrorBoundary from "./ErrorBoundary";
import RoleViewSwitcher from "./RoleViewSwitcher";
import BetaFeedbackDrawer from "./BetaFeedbackDrawer";
import { canView, tierRole, useRoleView } from "../lib/roles";
import { useRig, rigLabel } from "../context/RigContext";
import { AdvisoryStrip } from "./AdvisoryDisclaimer";
import { useActiveJob } from "../context/ActiveJobContext";
import { OperatorTelemetryProvider } from "../context/OperatorTelemetryContext";
import { useAuth } from "../context/AuthContext";
import FieldToolsBar from "./FieldToolsBar";

const tabs = [
  { to: "/job", label: "Job", Icon: BriefcaseBusiness },
  { to: "/live", label: "Live", Icon: Activity },
  { to: "/log", label: "Log", Icon: ClipboardList },
  { to: "/calc", label: "Calc", Icon: Calculator },
  { to: "/more", label: "More", Icon: Menu },
];

const navLinks = [
  { to: "/cockpit", label: "Operator Cockpit", view: "cockpit" },
  { to: "/classic", label: "Classic Mode", view: "classic" },
  { to: "/log", label: "Treatment Log / Notes", view: "treatment_log" },
  { to: "/wellbore", label: "3D Wellbore", view: "calculators" },
  { to: "/sop", label: "17 CT Calculators & SOPs", view: "sop" },
  { to: "/approvals", label: "Approvals & Docs", view: "parts" },
  { to: "/audit", label: "Audit Ledger", view: "audit_ledger" },
];

export default function AppShell() {
  useRoleView();
  const { rigId } = useRig();
  const job = useActiveJob();
  const { user, offlineWorkspace } = useAuth();
  const visibleTabs = tabs.filter(({ to }) => to !== "/live" || user?.effective_plan === "aegis_fleet");
  const { pathname } = useLocation();
  const role = tierRole(user);
  const links = navLinks.filter((l) => canView(user, l.view));
  const section = pathname === "/app" || ["/stress", "/fatigue", "/ctd-calculator", "/wellbore"].includes(pathname)
    ? "/calc" : pathname.startsWith("/live-ops") ? "/live" : pathname === "/treatment" ? "/log" : pathname;
  return (
    <div className="job-shell" data-testid="app-shell">
      <header className="job-shell-header">
        <Link to="/job" className="job-brand">Aegis OS</Link>
        <select aria-label="Active job" className="job-switcher" value={job.jobId} onChange={(event) => event.target.value === "new" ? job.createJob() : job.selectJob(event.target.value)}>
          {job.jobs.map((item, index) => <option key={item.jobId} value={item.jobId}>{item.well.name || `Job ${index + 1}`} / Run {item.runNumber}</option>)}
          <option value="new">New job</option>
        </select>
        <span className="job-rig-badge">{rigLabel(rigId)}</span>
        <RoleViewSwitcher />
        <Link to="/sop" className="job-sop" aria-label="Emergency SOPs"><AlertOctagon size={18} /> SOP</Link>
      </header>
      <nav aria-label="Primary links" data-testid="persistent-nav" data-role={role} style={{ display: "flex", gap: 8, overflowX: "auto", padding: "6px 12px" }}>
        {links.map((l) => <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? "job-tab active" : "job-tab")} style={{ whiteSpace: "nowrap", flex: "0 0 auto" }}>{l.label}</NavLink>)}
      </nav>
      <div className="job-status-row"><span className="job-muted">{offlineWorkspace ? "Offline workspace / last verified access" : "Job-first field workspace"}</span><FieldToolsBar inline /></div>
      <AdvisoryStrip />
      <main className="job-shell-content"><OperatorTelemetryProvider><ErrorBoundary name="app-shell-content" resetKey={pathname}><Outlet key={`${job.jobId}:${job.rig}:${job.runNumber}:${role}`} /></ErrorBoundary></OperatorTelemetryProvider></main>
      <nav className="job-bottom-nav" aria-label="Main navigation">
        {visibleTabs.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => isActive || section === to ? "job-tab active" : "job-tab"}>
            <Icon size={20} aria-hidden="true" /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <BetaFeedbackDrawer />
    </div>
  );
}
