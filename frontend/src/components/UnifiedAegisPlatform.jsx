import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { API, useAuth } from "../context/AuthContext";
import { useActiveJob } from "../context/ActiveJobContext";
import { useRig } from "../context/RigContext";
import { useTier } from "../context/TierContext";
import { planRole } from "../lib/roles";
import { OPERATION_CODE_BY_NUM } from "../lib/operationCodes";
import { useCachedApi } from "../hooks/useCachedApi";
import MainOperatorScreen from "./MainOperatorScreen";
import OperatorCockpit from "../pages/OperatorCockpit";

const ENVIRONMENTS = [
  { id: "operator", label: "Operator", description: "Rig floor" },
  { id: "supervisor", label: "Supervisor", description: "Mission control" },
  { id: "management", label: "Management", description: "Fleet dispatch" },
];
const MANAGEMENT_RIGS = Array.from({ length: 4 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return { id: `CT-UNIT-${number}`, label: `CT Unit ${number}` };
});

function FleetAssignments() {
  const { labels, statuses } = useRig();
  const [members, setMembers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [provisionedRigs, setProvisionedRigs] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingRig, setSavingRig] = useState(null);
  const [notice, setNotice] = useState("");
  const provisionedUnitIds = MANAGEMENT_RIGS.filter((rig) => provisionedRigs.has(rig.id)).map((rig) => rig.id);
  const assignedCount = provisionedUnitIds.filter((rigId) => assignments[rigId]).length;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [memberResponse, assignmentResponse, rigResponse] = await Promise.all([
        api.get(`${API}/rbac/members`),
        api.get(`${API}/rigs/lead-assignments`),
        api.get(`${API}/org/rigs`),
      ]);
      setMembers(memberResponse.data.members);
      setAssignments(Object.fromEntries(assignmentResponse.data.assignments.map((item) => [item.rig_id, item.user_id])));
      setProvisionedRigs(new Set(rigResponse.data.map((rig) => rig.rig_id)));
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

  const provision = async (rig) => {
    setSavingRig(rig.id);
    setError("");
    setNotice("");
    try {
      await api.post(`${API}/org/rigs`, { rig_id: rig.id, name: rig.label });
      setProvisionedRigs((current) => new Set([...current, rig.id]));
      setNotice(`${rig.label} provisioned.`);
    } catch (err) {
      setError(err.response?.data?.detail || "Unable to provision rig unit.");
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
      {!loading && (
        <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded border border-slate-700 bg-slate-950/60 p-3">
            <dt className="text-xs text-slate-400">Provisioned CT units</dt>
            <dd className="mt-1 font-mono text-xl font-bold">{provisionedUnitIds.length} / {MANAGEMENT_RIGS.length}</dd>
          </div>
          <div className="rounded border border-slate-700 bg-slate-950/60 p-3">
            <dt className="text-xs text-slate-400">Lead assignments</dt>
            <dd className="mt-1 font-mono text-xl font-bold">{assignedCount}</dd>
          </div>
          <div className="rounded border border-slate-700 bg-slate-950/60 p-3">
            <dt className="text-xs text-slate-400">Provisioned units without a lead</dt>
            <dd className="mt-1 font-mono text-xl font-bold">{provisionedUnitIds.length - assignedCount}</dd>
          </div>
        </dl>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
      {loading ? <p className="job-muted mt-3">Loading assignments…</p> : !error || members.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[460px] text-left text-sm">
            <thead><tr className="border-b border-slate-700 text-slate-300"><th className="p-2">Rig</th><th className="p-2">Status</th><th className="p-2">Lead engineer</th></tr></thead>
            <tbody>
              {MANAGEMENT_RIGS.map((rig) => {
                const assigned = assignments[rig.id] || "";
                const formerMember = assigned && !members.some((member) => member.user_id === assigned);
                return (
                  <tr key={rig.id} className="border-b border-slate-800">
                    <td className="p-2">{labels[rig.id] || rig.label}</td>
                    <td className="p-2 capitalize">{provisionedRigs.has(rig.id) ? statuses[rig.id]?.status || "Provisioned" : "Not provisioned"}</td>
                    <td className="p-2">
                      {provisionedRigs.has(rig.id) ? (
                        <select aria-label={`Lead engineer for ${rig.id}`} className="job-input w-full" value={assigned} disabled={savingRig !== null}
                          onChange={(event) => assign(rig.id, event.target.value)}>
                          <option value="">Unassigned</option>
                          {formerMember && <option value={assigned}>Former team member</option>}
                          {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.name || member.email || member.user_id}</option>)}
                        </select>
                      ) : (
                        <button type="button" className="job-secondary w-full" disabled={savingRig !== null} onClick={() => provision(rig)}>
                          {savingRig === rig.id ? "Provisioning…" : "Provision unit"}
                        </button>
                      )}
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
  const [scrubIndex, setScrubIndex] = useState(0);
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
  const events = (entries.data?.entries || []).slice()
    .sort((a, b) => new Date(a.event_at || a.created_at || 0) - new Date(b.event_at || b.created_at || 0))
    .slice(-12);
  const selectedIndex = Math.min(scrubIndex, Math.max(0, events.length - 1));
  const selectedEvent = events[selectedIndex];

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
                        <label className="mt-3 flex items-center gap-3 text-xs text-slate-400">
                          <span>Scrub event {selectedIndex + 1} of {events.length}</span>
                          <input type="range" min="0" max={events.length - 1} value={selectedIndex}
                            aria-label="Scrub treatment timeline"
                            onChange={(event) => setScrubIndex(Number(event.target.value))}
                            className="min-w-0 flex-1 accent-emerald-400" />
                        </label>
                        {selectedEvent && (
                          <p className="mt-2 rounded border border-slate-700 bg-slate-950/60 p-2 text-sm" data-testid="selected-timeline-event">
                            {selectedEvent.text}
                          </p>
                        )}
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

function AuditVerificationCard() {
  const [verification, setVerification] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const verify = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`${API}/approvals/audit/verify`);
      setVerification(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Unable to verify this organization's audit chain.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { verify(); }, [verify]);
  const valid = verification?.valid;

  return (
    <section className="job-card" aria-labelledby="audit-verification-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="audit-verification-heading" className="font-bold">HITL audit-chain verification</h2>
          <p className="job-muted mt-1">Read-only SHA-256 integrity check for this organization.</p>
        </div>
        <button type="button" className="job-secondary" onClick={verify} disabled={loading}>
          {loading ? "Verifying…" : "Verify chain"}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {verification && !error && (
        <>
          <p className={`mt-3 text-sm font-semibold ${valid ? "text-emerald-300" : "text-rose-300"}`} role="status">
            {valid ? `Verified · ${verification.entries} entries` : `Verification failed at entry ${verification.broken_at_seq}: ${verification.reason || "Hash chain mismatch"}`}
          </p>
          {verification.head_hash && (
            <p className="mt-1 break-all font-mono text-xs text-slate-400" data-testid="audit-head-hash">
              Chain head: {verification.head_hash}
            </p>
          )}
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
  const environmentStorageKey = user?.user_id ? `aegis_environment:${user.user_id}` : null;
  const availableIds = available.map((item) => item.id).join(",");
  const [selected, setSelected] = useState(defaultEnvironment);
  useEffect(() => {
    let restored = defaultEnvironment;
    try {
      const saved = environmentStorageKey && window.localStorage.getItem(environmentStorageKey);
      if (saved && availableIds.split(",").includes(saved)) restored = saved;
    } catch (error) {
      console.warn("Could not restore the last Aegis environment:", error?.message);
    }
    setSelected(restored);
  }, [environmentStorageKey, defaultEnvironment, availableIds]);

  const selectEnvironment = (environmentId) => {
    setSelected(environmentId);
    if (!environmentStorageKey) return;
    try {
      window.localStorage.setItem(environmentStorageKey, environmentId);
    } catch (error) {
      console.warn("Could not save the selected Aegis environment:", error?.message);
    }
  };
  const active = available.some((item) => item.id === selected) ? selected : defaultEnvironment;

  return (
    <div className="job-page mx-auto max-w-7xl bg-[#020617] p-3 text-slate-100" data-testid="unified-platform">
      <header>
        <h1 className="text-xl font-bold">Unified Aegis Platform</h1>
        <p className="text-sm text-slate-400">Active job: {job.well.name || "Unnamed well"} · {labels[job.rig] || job.rig} · {job.mode} mode</p>
      </header>
      <nav aria-label="Available environments" className="flex flex-wrap gap-2">
        {available.map((item) => (
          <button key={item.id} type="button" className="job-secondary" aria-pressed={active === item.id} onClick={() => selectEnvironment(item.id)}>
            {item.label} · {item.description}
          </button>
        ))}
      </nav>

      {active === "operator" && (
        <section className="space-y-3">
          <MainOperatorScreen />
        </section>
      )}
      {active === "supervisor" && (
        <>
          <OperatorCockpit embedded />
          <TreatmentTimeline rigId={job.rig} enabled={tier.canAccess("treatment_log")} />
          <AuditVerificationCard />
        </>
      )}
      {active === "management" && (
        <>
          <FleetAssignments />
          <section className="job-card space-y-3">
            <h2 className="font-bold">Management tools</h2>
            <div className="flex flex-wrap gap-2">
              <Link className="job-secondary" to="/manager">Manager dashboard</Link>
              <Link className="job-secondary" to="/audit">Full audit ledger</Link>
              {tier.canAccess("exec_dashboard") && <Link className="job-secondary" to="/executive">Executive dashboard</Link>}
            </div>
            <p className="job-muted">Fleet billing, CAD ARR/MRR reporting, and invoice generation are not connected in this portal. Do not treat operational counts as financial reporting.</p>
          </section>
        </>
      )}
    </div>
  );
}
