import React from "react";
import { useActiveJob } from "../context/ActiveJobContext";
import { useReelMetadata } from "../context/ActiveReelContext";
import { RIGS, rigLabel } from "../context/RigContext";
import { useCachedApi } from "../hooks/useCachedApi";

export default function JobDetails() {
  const job = useActiveJob();
  const { reels } = useReelMetadata();
  const surveys = useCachedApi("/surveys");
  return (
    <details className="job-card">
      <summary className="min-h-11 cursor-pointer font-bold">Job details / Run {job.runNumber}</summary>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        <label>Rig<select className="job-input w-full" value={job.rig} onChange={(e) => job.updateJob({ rig: e.target.value })}>
          {RIGS.map((rig) => <option key={rig.id} value={rig.id}>{rigLabel(rig.id)}</option>)}
        </select></label>
        <label>Run number<input type="number" min="1" step="1" className="job-input w-full" value={job.runNumber}
          onChange={(e) => { const number = Number(e.target.value); if (Number.isInteger(number) && number > 0) job.updateJob({ runNumber: number }); }} /></label>
        <label>Well name<input className="job-input w-full" value={job.well.name} onChange={(e) => job.updateJob({ well: { ...job.well, name: e.target.value } })} /></label>
        <label>Well survey<select className="job-input w-full" value={job.well.surveyId || ""} onChange={(e) => {
          const survey = surveys.data?.surveys?.find((item) => item.survey_id === e.target.value);
          job.updateJob({ well: { name: survey?.well_name || job.well.name, surveyId: survey?.survey_id || null } });
        }}>
          <option value="">No survey selected</option>
          {job.well.surveyId && !surveys.data?.surveys?.some((item) => item.survey_id === job.well.surveyId) && <option value={job.well.surveyId}>{job.well.name} (saved selection)</option>}
          {(surveys.data?.surveys || []).map((survey) => <option key={survey.survey_id} value={survey.survey_id}>{survey.well_name || survey.survey_id}</option>)}
        </select></label>
        <label>Reel for this job<select className="job-input w-full" value={job.activeReel?.reel_id || ""} onChange={(e) => job.updateJob({ activeReel: reels.find((reel) => reel.reel_id === e.target.value) || null })}>
          <option value="">No reel selected</option>
          {job.activeReel && !reels.some((reel) => reel.reel_id === job.activeReel.reel_id) && <option value={job.activeReel.reel_id}>{job.activeReel.name} (saved)</option>}
          {reels.map((reel) => <option key={reel.reel_id} value={reel.reel_id}>{reel.name}</option>)}
        </select></label>
      </div>
      {surveys.status !== "fresh" && <p className="job-muted mt-2">{surveys.data ? "Cached surveys; verify selection before field use." : "Surveys unavailable until loaded online."}</p>}
    </details>
  );
}
