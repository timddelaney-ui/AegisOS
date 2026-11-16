import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { API, useAuth } from "../context/AuthContext";
import { useActiveJob } from "../context/ActiveJobContext";
import { RIGS, useRig } from "../context/RigContext";
import { useTier } from "../context/TierContext";
import { planRole } from "../lib/roles";
import { OPERATION_CODE_BY_NUM } from "../lib/operationCodes";
import { useCachedApi } from "../hooks/useCachedApi";
import JobGauges from "./JobGauges";

const ENVIRONMENTS = [
  { id: "operator", label: "Operator", description: "Rig floor" },
  { id: "supervisor", label: "Supervisor", description: "Mission control" },
  { id: "management", label: "Management", description: "Fleet dispatch" },
];

function FleetAssignments() {
  const { labels, statuses } = useRig();
  const [members, setMembers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingRig, setSavingRig] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [memberResponse, assignmentResponse] = await Promise.all([
        api.get(`${API}/rbac/members`),
        api.get(`${API}/rigs/lead-assignments`),
      ]);
      setMembers(memberResponse.data.members);
      setAssignments(Object.fromEntries(assignmentResponse.data.assignments.map((item) => [item.rig_id, item.user_id])));
    } catch (err) {
      setError(err.response?.data?.detail || "Unable to load engineer assignments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const assign = async (rigId, userId) => {
    setSavingRig(rigId);
    setError("");
    setNotice("");
    try {
      const { data } = await api.put(`${API}/rigs/${encodeURIComponent(rigId)}/lead-assignment`, { user_id: userId || null });
      setAssignments((current) => ({ ...current, [rigId]: data.user_id }));
      setNotice(`Lead assignment saved for ${labels[rigId] || rigId}.`);
    } catch (err) {
      setError(err.response?.data?.detail || "Unable to save engineer assignment.");
    } finally {
      setSavingRig(null);
    }
  };

  return (
    <section className="job-card" aria-labelledby="fleet-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="fleet-heading" className="font-bold">Rig lead assignments</h2>
          <p className="job-muted">Assign an existing team member. Assignments do not change rig status.</p>
        </div>
        <button type="button" className="job-secondary" onClick={load} disabled={loading || savingRig !== null}>Refresh</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
      {loading ? <p className="job-muted mt-3">Loading assignments…</p> : !error || members.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[460px] text-left text-sm">
            <thead><tr className="border-b border-slate-700 text-slate-300"><th className="p-2">Rig</th><th className="p-2">Status</th><th className="p-2">Lead engineer</th></tr></thead>
            <tbody>
              {RIGS.map((rig) => {
                const assigned = assignments[rig.id] || "";
                const formerMember = assigned && !members.some((member) => member.user_id === assigned);
                return (
                  <tr key={rig.id} className="border-b border-slate-800">
                    <td className="p-2">{labels[rig.id] || rig.label}</td>
                    <td className="p-2 capitalize">{statuses[rig.id]?.status || "Not set"}</td>
                    <td className="p-2">
                      <select aria-label={`Lead engineer for ${rig.id}`} className="job-input w-full" value={assigned} disabled={savingRig !== null}
                        onChange={(event) => assign(rig.id, event.target.value)}>
                        <option value="">Unassigned</option>
                        {formerMember && <option value={assigned}>Former team member</option>}
                        {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.name || member.email || member.user_id}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function TreatmentTimeline({ rigId, enabled }) {
  const active = useCachedApi("/treatments/active", { rig_id: rigId }, enabled);
  const treatment = active.data?.treatment;
  const entries = useCachedApi(
    treatment ? `/treatments/${treatment.treatment_id}/entries` : null,
    {},
    enabled && !!treatment,
  );
  const { refresh: refreshActive } = active;
  const { refresh: refreshEntries } = entries;
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      refreshActive();
      refreshEntries();
    }, 15000);
    return () => clearInterval(timer);
  }, [enabled, refreshActive, refreshEntries]);
  const events = (entries.data?.entries || []).slice().reverse().slice(0, 12);

  return (
    <section className="job-card" aria-labelledby="job-timeline-heading">
      <h2 id="job-timeline-heading" className="font-bold">Treatment timeline</h2>
      <p className="job-muted mt-1">Events from the shared treatment log for {rigId}.</p>
      {!enabled ? <p className="job-muted mt-3">Treatment log is unavailable on this plan.</p>
        : active.status === "loading" && !active.data ? <p className="job-muted mt-3">Loading active treatment…</p>
          : active.error && !active.data ? <p role="alert" className="mt-3 text-sm text-rose-300">{active.error}</p>
            : !treatment ? <p className="job-muted mt-3">{active.status === "cached" ? "No active treatment in the saved snapshot." : "No active treatment for this rig."}</p>
              : entries.status === "loading" && !entries.data ? <p className="job-muted mt-3">Loading treatment events…</p>
                : entries.error && !entries.data ? <p role="alert" className="mt-3 text-sm text-rose-300">{entries.error}</p>
                  : events.length === 0 ? <p className="job-muted mt-3">No entries have been logged for this treatment.</p>
                    : (
                      <>
                        <p className="job-muted mt-2">{treatment.name}{entries.status === "cached" ? " · cached entries" : ""}</p>
                        <ol className="mt-3 space-y-3 border-l border-slate-600 pl-4">
                          {events.map((entry) => {
                            const operation = OPERATION_CODE_BY_NUM[entry.operation_code];
                            const timestamp = entry.event_at || entry.created_at;
                            const date = timestamp ? new Date(timestamp) : null;
                            const depth = entry.telemetry_snapshot?.depth_ft;
                            return (
                              <li key={entry.entry_id} className="relative">
                                <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${entry.kind === "npt" ? "bg-rose-400" : entry.kind === "event" ? "bg-emerald-400" : "bg-slate-400"}`} aria-hidden="true" />
                                <p className="text-sm font-medium">{operation ? `${operation.label}: ` : ""}{entry.text}</p>
                                <p className="mt-1 text-xs text-slate-400">
                                  {date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "Time unavailable"}
                                  {entry.kind && ` · ${entry.kind.toUpperCase()}`}
                                  {Number.isFinite(Number(depth)) && ` · ${Number(depth).toLocaleString()} ft`}
                                  {entry.npt_minutes && ` · ${entry.npt_minutes} min NPT`}
                                </p>
                              </li>
                            );
                          })}
                        </ol>
                      </>
                    )}
    </section>
  );
}

export default function UnifiedAegisPlatform() {
  const { user } = useAuth();
  const job = useActiveJob();
  const { labels } = useRig();
  const tier = useTier();
  const role = planRole(user);
  const available = ENVIRONMENTS.filter((item) => item.id === "operator" || role === "management" || (item.id === "supervisor" && role === "supervisor"));
  const defaultEnvironment = role === "management" ? "management" : role === "supervisor" ? "supervisor" : "operator";
  const [selected, setSelected] = useState(defaultEnvironment);
  const active = available.some((item) => item.id === selected) ? selected : defaultEnvironment;

  return (
    <div className="job-page max-w-6xl" data-testid="unified-platform">
      <header>
        <h1 className="text-xl font-bold">Unified Aegis Platform</h1>
        <p className="job-muted">Active job: {job.well.name || "Unnamed well"} · {labels[job.rig] || job.rig} · {job.mode} mode</p>
      </header>
      <nav aria-label="Available environments" className="flex flex-wrap gap-2">
        {available.map((item) => (
          <button key={item.id} type="button" className="job-secondary" aria-pressed={active === item.id} onClick={() => setSelected(item.id)}>
            {item.label} · {item.description}
          </button>
        ))}
      </nav>

      {active === "operator" && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Rig floor</h2>
          <JobGauges />
          <p className="job-muted">Readings show their source and may be simulated or unavailable. Verify current feed status before use.</p>
          <div className="flex flex-wrap gap-2">
            {tier.canAccess("live_ops") && <Link className="job-secondary" to="/live">Open operator cockpit</Link>}
            <Link className="job-secondary" to="/log">Open treatment log</Link>
            <Link className="job-secondary" to="/job">Open active job</Link>
          </div>
        </section>
      )}
      {active === "supervisor" && (
        <>
          <section className="job-card space-y-3">
            <h2 className="text-lg font-bold">Mission control</h2>
            <p className="job-muted">Open the existing cockpit for strip charts, encoder status, the yield envelope and the job workbook.</p>
            <div className="flex flex-wrap gap-2">
              {tier.canAccess("live_ops") && <Link className="job-secondary" to="/live">Open mission control</Link>}
              <Link className="job-secondary" to="/approvals">Open approvals</Link>
              <Link className="job-secondary" to="/log">Open treatment log</Link>
            </div>
          </section>
          <TreatmentTimeline rigId={job.rig} enabled={tier.canAccess("treatment_log")} />
        </>
      )}
      {active === "management" && (
        <>
          <FleetAssignments />
          <section className="job-card space-y-3">
            <h2 className="font-bold">Management tools</h2>
            <div className="flex flex-wrap gap-2">
              <Link className="job-secondary" to="/manager">Manager dashboard</Link>
              <Link className="job-secondary" to="/audit">Audit ledger</Link>
              {tier.canAccess("exec_dashboard") && <Link className="job-secondary" to="/executive">Executive dashboard</Link>}
            </div>
            <p className="job-muted">Fleet billing and invoice generation are not available here.</p>
          </section>
        </>
      )}
    </div>
  );
}
