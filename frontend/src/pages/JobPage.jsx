import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useActiveJob } from "../context/ActiveJobContext";
import { useAuth } from "../context/AuthContext";
import { useTier } from "../context/TierContext";
import { JOB_PHASES } from "../lib/activeJob";
import { isSupervisorOrHigher, isCrewOrHigher } from "../lib/roles";
import { filterTools, getTool } from "../config/toolRegistry";
import { useCachedApi } from "../hooks/useCachedApi";
import JobGauges from "../components/JobGauges";
import JobDetails from "../components/JobDetails";
import HandoverModal from "../components/HandoverModal";

function TodayStrip() {
  const { rig } = useActiveJob();
  const { user } = useAuth();
  const tier = useTier();
  const tasks = useCachedApi("/tasks", { status: "open" }, isCrewOrHigher(user) && tier.canAccess("daily_tasks"));
  const certs = useCachedApi("/certifications", { user_id: user?.user_id }, isCrewOrHigher(user) && tier.canAccess("certifications"));
  const treatment = useCachedApi("/treatments/active", { rig_id: rig }, tier.canAccess("treatment_log"));
  const entries = useCachedApi(treatment.data?.treatment ? `/treatments/${treatment.data.treatment.treatment_id}/entries` : null, {}, !!treatment.data?.treatment);
  const last = entries.data?.entries?.at(-1);
  const label = (resource, count) => resource.status === "disabled" ? "Not available on this plan" : resource.data === null ? "Unavailable" : `${count}${resource.status === "cached" ? " (cached)" : ""}`;
  return (
    <section className="job-card" aria-label="Today">
      <h2 className="font-bold mb-2">Today</h2>
      <div className="job-today">
        <Link to={getTool("tasks").route}><strong>{label(tasks, tasks.data?.tasks?.length || 0)}</strong><span>Open tasks</span></Link>
        <Link to={getTool("certs").route}><strong>{label(certs, certs.data?.certifications?.filter((cert) => ["amber", "expired"].includes(cert.status)).length || 0)}</strong><span>Certs expiring / expired</span></Link>
        <Link to={getTool("treatment").route}><strong>{last ? new Date(last.event_at || last.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : treatment.status === "fresh" && !treatment.data?.treatment ? "No active log" : "Unavailable"}</strong><span>{last?.text || "Last log entry"}</span></Link>
      </div>
      <p className="job-muted mt-2">Tasks/certifications are account-scoped; log is rig-scoped.</p>
    </section>
  );
}

export default function JobPage() {
  const job = useActiveJob();
  const { user } = useAuth();
  const tier = useTier();
  const navigate = useNavigate();
  const location = useLocation();
  const [handoverOpen, setHandoverOpen] = useState(false);
  const items = job.checklist[job.phase];
  const next = items.find((item) => !item.done);
  const phaseIndex = JOB_PHASES.findIndex((phase) => phase.id === job.phase);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("handover")) setHandoverOpen(true);
  }, [location.search]);
  useEffect(() => { setHandoverOpen(false); }, [job.jobId]);
  const openNext = () => {
    if (!next) {
      if (phaseIndex < JOB_PHASES.length - 1) job.updateJob({ phase: JOB_PHASES[phaseIndex + 1].id });
      else setHandoverOpen(true);
      return;
    }
    const tool = getTool(next.toolId);
    if (tool.feature && !tier.canAccess(tool.feature)) { tier.promptUpgrade(tool.feature); return; }
    if (next.toolId === "handover") setHandoverOpen(true); else navigate(tool.route);
  };
  const shortcuts = filterTools({ phase: job.phase, user, ...tier }).filter((tool) => items.some((item) => item.toolId === tool.id));
  return (
    <div className="job-page" data-testid="job-home">
      <div><h1 className="text-xl font-bold">{job.well.name || "Active job"}</h1><p className="job-muted">Run {job.runNumber} / {JOB_PHASES[phaseIndex].title}</p></div>
      <nav aria-label="Job phase" className="job-phases">
        {JOB_PHASES.map((phase) => <button key={phase.id} className="job-secondary" aria-pressed={phase.id === job.phase} onClick={() => job.updateJob({ phase: phase.id })}>{phase.title}</button>)}
      </nav>
      <section className="job-card">
        <h2 className="job-muted">Next step</h2><p className="text-lg font-bold mt-1">{next?.title || (phaseIndex < 3 ? "Phase checklist complete" : "Handover checklist complete")}</p>
        <p className="job-muted mt-2">{items.filter((item) => item.done).length} / {items.length} complete. Verify against the approved job program.</p>
      </section>
      <JobGauges />
      <TodayStrip />
      <section className="job-card">
        <h2 className="font-bold">Phase checklist</h2>
        {items.map((item) => <label key={item.id} className="job-checklist-item">
          <input type="checkbox" checked={item.done} onChange={(e) => job.checkItem(job.phase, item.id, e.target.checked)} /><span>{item.title}</span>
        </label>)}
      </section>
      <button className="job-primary" onClick={openNext}>{next ? `Continue: ${next.title}` : phaseIndex < 3 ? `Advance to ${JOB_PHASES[phaseIndex + 1].title}` : "Review handover"}</button>
      <div className="grid grid-cols-2 gap-2">{shortcuts.map((tool) => <Link key={tool.id} to={tool.route} className="job-secondary">{tool.title}</Link>)}</div>
      {isSupervisorOrHigher(user) && <section className="job-card"><h2 className="font-bold">Supervisor approvals</h2>
        {filterTools({ user, ...tier }).filter((tool) => ["parts-orders", "timecards"].includes(tool.id)).map((tool) => <Link key={tool.id} className="job-secondary inline-flex items-center mr-2 mt-2" to={tool.route}>{tool.title}</Link>)}
      </section>}
      <JobDetails />
      {isCrewOrHigher(user) && <HandoverModal key={job.jobId} open={handoverOpen} onClose={() => { setHandoverOpen(false); navigate("/job", { replace: true }); }} />}
    </div>
  );
}
