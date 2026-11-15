import React from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { BriefcaseBusiness, Activity, ClipboardList, Calculator, Menu, AlertOctagon } from "lucide-react";
import { useRig, rigLabel } from "../context/RigContext";
import { AdvisoryStrip } from "./AdvisoryDisclaimer";

const tabs = [
  { to: "/job", label: "Job", Icon: BriefcaseBusiness },
  { to: "/live", label: "Live", Icon: Activity },
  { to: "/log", label: "Log", Icon: ClipboardList },
  { to: "/calc", label: "Calc", Icon: Calculator },
  { to: "/more", label: "More", Icon: Menu },
];

export default function AppShell() {
  const { rigId } = useRig();
  const { pathname } = useLocation();
  const section = pathname === "/app" || ["/stress", "/fatigue", "/ctd-calculator", "/wellbore"].includes(pathname)
    ? "/calc" : pathname.startsWith("/live-ops") ? "/live" : pathname === "/treatment" ? "/log" : pathname;
  return (
    <div className="job-shell" data-testid="app-shell">
      <header className="job-shell-header">
        <Link to="/job" className="job-brand">Aegis OS</Link>
        <span className="job-rig-badge">{rigLabel(rigId)}</span>
        <Link to="/sop" className="job-sop" aria-label="Emergency SOPs"><AlertOctagon size={18} /> SOP</Link>
      </header>
      <AdvisoryStrip />
      <main className="job-shell-content"><Outlet /></main>
      <nav className="job-bottom-nav" aria-label="Main navigation">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => isActive || section === to ? "job-tab active" : "job-tab"}>
            <Icon size={20} aria-hidden="true" /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
