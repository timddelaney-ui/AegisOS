import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import { toast } from "sonner";
import { useAuth } from "./AuthContext";
import { uuid, getStateSync } from "../lib/fieldStore";
import { createActiveJob, jobReducer, restoreJobState } from "../lib/activeJob";

const JobContext = createContext(null);
const SelectionContext = createContext(null);
const ActionsContext = createContext(null);
const ModeContext = createContext(null);

function loadJobs(key) {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return restoreJobState(JSON.parse(saved));
    const job = createActiveJob(uuid(), {
      rig: localStorage.getItem("ctp_active_rig_v2") || "RIG1",
      activeReel: getStateSync("active_reel_snapshot", null)?.activeReel || null,
    });
    return { activeJobId: job.jobId, jobs: [job] };
  } catch (error) {
    console.error("[ActiveJob] restore failed", error);
    toast.error("Saved job could not be restored. Review job selections before working.");
    const job = createActiveJob(uuid());
    return { activeJobId: job.jobId, jobs: [job] };
  }
}

function JobSession({ storageKey, children }) {
  const [state, dispatch] = useReducer(jobReducer, storageKey, loadJobs);
  const job = state.jobs.find((item) => item.jobId === state.activeJobId);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); }
    catch (error) {
      console.error("[ActiveJob] persistence failed", error);
      toast.error("Job changes are not saved on this device. Storage is unavailable.");
    }
  }, [state, storageKey]);
  const actions = useMemo(() => ({
    updateJob: (fields) => dispatch({ type: "update", fields }),
    selectJob: (jobId) => dispatch({ type: "select", jobId }),
    createJob: () => dispatch({ type: "create", jobId: uuid(), fields: { rig: job.rig, mode: "STANDBY" } }),
    checkItem: (phase, itemId, done) => dispatch({ type: "check", phase, itemId, done, at: new Date().toISOString() }),
  }), [job.rig]);
  const selection = useMemo(() => ({
    jobId: job.jobId, rig: job.rig, runNumber: job.runNumber, well: job.well, activeReel: job.activeReel,
  }), [job.jobId, job.rig, job.runNumber, job.well, job.activeReel]);
  const value = useMemo(() => ({ ...job, jobs: state.jobs, ...actions }), [job, state.jobs, actions]);
  return (
    <ActionsContext.Provider value={actions}>
      <SelectionContext.Provider value={selection}>
        <ModeContext.Provider value={job.mode}>
          <JobContext.Provider value={value}>{children}</JobContext.Provider>
        </ModeContext.Provider>
      </SelectionContext.Provider>
    </ActionsContext.Provider>
  );
}

export function ActiveJobProvider({ children }) {
  const { user } = useAuth();
  const storageKey = `aegis_active_jobs_v1:${user?.user_id || "anonymous"}`;
  return <JobSession key={storageKey} storageKey={storageKey}>{children}</JobSession>;
}
function useRequired(context, name) {
  const value = useContext(context);
  if (value === null) throw new Error(`${name} requires ActiveJobProvider`);
  return value;
}
export const useActiveJob = () => useRequired(JobContext, "useActiveJob");
export const useActiveJobSelection = () => useRequired(SelectionContext, "useActiveJobSelection");
export const useJobActions = () => useRequired(ActionsContext, "useJobActions");
export const useJobMode = () => useRequired(ModeContext, "useJobMode");
