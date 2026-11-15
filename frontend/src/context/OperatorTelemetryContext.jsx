import React, { createContext, useCallback, useContext, useMemo } from "react";
import { useActiveJobSelection, useJobActions, useJobMode } from "./ActiveJobContext";
import { useTier } from "./TierContext";
import { useCachedApi } from "../hooks/useCachedApi";
import { useOperatorFeed } from "../hooks/useOperatorFeed";
import { useDepthCorrelation } from "../components/operator/useOperatorSync";
import { surveyTD } from "../lib/surveyInterp";
import { DEPTH_MIN_FT, DEPTH_MAX_FT } from "../lib/operatorConfig";
import { operatorValueSource } from "../lib/operatorSources";

export const OperatorTelemetryContext = createContext({
  telemetry: null, sourceLabel: "no current feed", history: [], bitFt: null,
});
export const useOperatorTelemetry = () => useContext(OperatorTelemetryContext);

function ScopedFeed({ job, surveys, children }) {
  const feedMode = useJobMode();
  const { updateJob } = useJobActions();
  const survey = surveys.find((item) => item.survey_id === job.well.surveyId && item.stations?.length > 1) || null;
  const minFt = survey ? survey.stations[0].md_ft : DEPTH_MIN_FT;
  const maxFt = survey ? surveyTD(survey) : DEPTH_MAX_FT;
  const corr = useDepthCorrelation(job.well.surveyId);
  const feed = useOperatorFeed({ rigId: job.rig, feedMode, minFt, maxFt });
  const live = feedMode === "LIVE" && !feed.liveStale && !!feed.lastLiveSample;
  const sourceLabel = live ? "live DAQ (missing channels held)" : operatorValueSource({ feedMode, ...feed }, "depth");
  const sourceFor = useCallback((key) => operatorValueSource({ feedMode, liveStale: feed.liveStale, lastLiveSample: feed.lastLiveSample }, key),
    [feedMode, feed.liveStale, feed.lastLiveSample]);
  const setFeedMode = useCallback((mode) => updateJob({ mode }), [updateJob]);
  const value = useMemo(() => ({
    ...feed, feedMode, sourceLabel, sourceFor, live, minFt, maxFt, corr, survey, surveys,
    surveyId: job.well.surveyId,
    setSurveyId: (id) => updateJob({ well: { name: surveys.find((item) => item.survey_id === id)?.well_name || job.well.name, surveyId: id } }),
    setFeedMode,
    bitFt: corr.moveTarget === "ct_string" ? feed.telemetry.depth + corr.offsetFt : feed.telemetry.depth,
  }), [feed, feedMode, sourceLabel, sourceFor, live, minFt, maxFt, corr, survey, surveys, job.well, updateJob, setFeedMode]);
  return <OperatorTelemetryContext.Provider value={value}>{children}</OperatorTelemetryContext.Provider>;
}

export function OperatorTelemetryProvider({ children }) {
  const job = useActiveJobSelection();
  const { canAccess } = useTier();
  const available = canAccess("live_ops");
  const surveys = useCachedApi("/surveys", {}, available);
  if (!available) return children;
  return <ScopedFeed key={`${job.jobId}:${job.runNumber}:${job.rig}:${job.well.surveyId}`} job={job} surveys={surveys.data?.surveys || EMPTY_SURVEYS}>{children}</ScopedFeed>;
}
const EMPTY_SURVEYS = [];
