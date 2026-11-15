import { createActiveJob, jobReducer, restoreJobState } from "../activeJob";

const initial = () => ({ activeJobId: "job-a", jobs: [createActiveJob("job-a")] });
test("job switching preserves each job's phase, selections, and checklist", () => {
  let state = jobReducer(initial(), { type: "update", fields: { rig: "RIG2", phase: "run", mode: "LIVE", runNumber: 3, well: { name: "North", surveyId: "survey-a" } } });
  state = jobReducer(state, { type: "check", phase: "run", itemId: "monitor", done: true, at: "2026-11-15T00:00:00Z" });
  state = jobReducer(state, { type: "create", jobId: "job-b", fields: { rig: "RIG3" } });
  expect(state.jobs[1].checklist.run.every((item) => !item.done)).toBe(true);
  state = jobReducer(state, { type: "select", jobId: "job-a" });
  expect(state.jobs[0]).toMatchObject({ rig: "RIG2", phase: "run", mode: "LIVE", runNumber: 3, well: { name: "North" } });
  expect(state.jobs[0].checklist.run.find((item) => item.id === "monitor")).toMatchObject({ done: true, completedAt: "2026-11-15T00:00:00Z" });
  expect(restoreJobState(JSON.parse(JSON.stringify(state)))).toEqual(state);
});
test.each([{ mode: "BAD" }, { rig: "RIG99" }, { runNumber: 0 }, { phase: "other" }, { well: null }])("rejects invalid job fields: %j", (fields) => {
  expect(() => jobReducer(initial(), { type: "update", fields })).toThrow();
});
test("unknown jobs and checklist items cannot change state", () => {
  expect(() => jobReducer(initial(), { type: "select", jobId: "missing" })).toThrow("Job not found");
  expect(() => jobReducer(initial(), { type: "check", phase: "run", itemId: "missing", done: true })).toThrow();
  expect(() => restoreJobState({ ...initial(), activeJobId: "missing" })).toThrow();
  expect(() => restoreJobState({ ...initial(), jobs: [createActiveJob("job-a"), createActiveJob("job-a")] })).toThrow();
});
test("checklist updates do not mutate previous state or selection references", () => {
  const before = initial();
  const after = jobReducer(before, { type: "check", phase: "plan", itemId: "program", done: true, at: "now" });
  expect(before.jobs[0].checklist.plan[0].done).toBe(false);
  expect(after.jobs[0].well).toBe(before.jobs[0].well);
  expect(after.jobs[0].checklist.run).toBe(before.jobs[0].checklist.run);
});
