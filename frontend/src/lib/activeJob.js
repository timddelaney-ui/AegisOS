export const JOB_PHASES = [
  { id: "plan", title: "Plan" },
  { id: "rig-up", title: "Rig up" },
  { id: "run", title: "Run" },
  { id: "handover", title: "Handover" },
];
export const JOB_MODES = ["SIM", "STANDBY", "LIVE"];
const CHECKLISTS = {
  plan: [["program", "Review the approved job program", "workbook"], ["reel", "Confirm reel and well survey", "reels"], ["certs", "Review crew certifications", "certs"]],
  "rig-up": [["flha", "Complete FLHA and site ERP review", "emergency"], ["bop", "Record BOP function and pressure tests", "treatment"], ["offset", "Verify depth zero and correlation", "live-ops"]],
  run: [["limits", "Verify operating limits against the program", "stress"], ["monitor", "Monitor live channels and source status", "live-ops"], ["log", "Record significant treatment events", "treatment"]],
  handover: [["log-review", "Review the shift treatment log", "treatment"], ["summary", "Generate and review the handover summary", "handover"], ["crew-email", "Confirm crew recipients and send handover", "handover"]],
};

export function createActiveJob(jobId, fields = {}) {
  const job = {
    jobId, rig: "RIG1", runNumber: 1, well: { name: "", surveyId: null }, activeReel: null,
    phase: "plan", mode: "SIM",
    checklist: Object.fromEntries(JOB_PHASES.map(({ id }) => [id, CHECKLISTS[id].map(([itemId, title, toolId]) => ({ id: itemId, title, toolId, done: false }))])),
    ...fields,
  };
  validateJob(job);
  return job;
}

function validateJob(job) {
  if (!job || typeof job.jobId !== "string" || !job.jobId.trim()) throw new Error("Job ID is required");
  if (job.rig !== "YARD" && !/^RIG(?:[1-9]|1[0-9]|2[0-5])$/.test(job.rig)) throw new Error("Invalid rig");
  if (!Number.isInteger(job.runNumber) || job.runNumber < 1) throw new Error("Run number must be a positive integer");
  if (!JOB_PHASES.some(({ id }) => id === job.phase) || !JOB_MODES.includes(job.mode)) throw new Error("Invalid job phase or feed mode");
  if (typeof job.well?.name !== "string" || !(job.well.surveyId === null || typeof job.well.surveyId === "string")) throw new Error("Invalid well selection");
  if (job.activeReel !== null && (typeof job.activeReel?.reel_id !== "string" || !Array.isArray(job.activeReel?.intervals))) throw new Error("Invalid reel selection");
  for (const { id } of JOB_PHASES) {
    const items = job.checklist?.[id];
    if (!Array.isArray(items) || items.length !== CHECKLISTS[id].length || items.some((item, i) =>
      item.id !== CHECKLISTS[id][i][0] || typeof item.done !== "boolean" || typeof item.title !== "string")) throw new Error("Invalid job checklist");
  }
  return job;
}

export function restoreJobState(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.jobs) || !snapshot.jobs.length) throw new Error("Invalid active job snapshot");
  snapshot.jobs.forEach(validateJob);
  if (new Set(snapshot.jobs.map((job) => job.jobId)).size !== snapshot.jobs.length ||
    !snapshot.jobs.some((job) => job.jobId === snapshot.activeJobId)) throw new Error("Invalid active job selection");
  return snapshot;
}

export function jobReducer(state, action) {
  switch (action.type) {
    case "create": {
      if (state.jobs.some((job) => job.jobId === action.jobId)) throw new Error("Job already exists");
      const job = createActiveJob(action.jobId, action.fields);
      return { activeJobId: job.jobId, jobs: [...state.jobs, job] };
    }
    case "select":
      if (!state.jobs.some((job) => job.jobId === action.jobId)) throw new Error("Job not found");
      return state.activeJobId === action.jobId ? state : { ...state, activeJobId: action.jobId };
    case "update":
    case "check": {
      const index = state.jobs.findIndex((job) => job.jobId === state.activeJobId);
      const current = state.jobs[index];
      let next;
      if (action.type === "update") {
        const { rig, runNumber, well, activeReel, phase, mode } = { ...current, ...action.fields };
        next = validateJob({ ...current, rig, runNumber, well, activeReel, phase, mode });
        if (["rig", "runNumber", "well", "activeReel", "phase", "mode"].every((key) => next[key] === current[key])) return state;
      } else {
        const items = current.checklist[action.phase];
        if (!items?.some((item) => item.id === action.itemId) || typeof action.done !== "boolean") throw new Error("Invalid checklist action");
        next = { ...current, checklist: { ...current.checklist, [action.phase]: items.map((item) =>
          item.id === action.itemId ? { ...item, done: action.done, completedAt: action.done ? action.at : null } : item) } };
      }
      const jobs = [...state.jobs];
      jobs[index] = next;
      return { ...state, jobs };
    }
    default: throw new Error(`Unknown job action: ${action.type}`);
  }
}
