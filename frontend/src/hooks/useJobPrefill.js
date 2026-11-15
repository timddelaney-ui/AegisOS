import { useState } from "react";
import { useActiveJobSelection } from "../context/ActiveJobContext";
import { useOperatorSnapshotReader } from "../context/OperatorTelemetryContext";
import { intervalAt } from "../lib/ctPhysics";
import { stationAt } from "../lib/surveyInterp";

// Capture once on opening a calculator; feed ticks must never overwrite user inputs.
export function useJobPrefill() {
  const job = useActiveJobSelection();
  const readSnapshot = useOperatorSnapshotReader();
  const [seed] = useState(() => {
    const feed = readSnapshot();
    const depthFt = feed?.bitFt ?? null;
    const segment = job.activeReel ? intervalAt(job.activeReel, depthFt ?? 0) : null;
    return {
      depthFt, segment, telemetry: feed?.telemetry || null,
      tvdFt: feed?.survey && depthFt !== null ? stationAt(feed.survey.stations, depthFt).tvd_ft : null,
      source: feed?.sourceLabel || "no feed / job metadata only",
      sources: Object.fromEntries(["depth", "internalPress", "annulusPress", "skatePressure", "axial_force_lbf"].map((key) => [key, feed?.sourceFor?.(key) || "manual/default"])),
    };
  });
  return seed;
}
