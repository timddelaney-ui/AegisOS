import { useEffect, useMemo, useRef, useState } from "react";
import { useOperatorTelemetry } from "../context/OperatorTelemetryContext";
import { diffPressure, encoderConsensus, injectorDirection } from "../lib/cockpitTelemetry";

const MAX_SAMPLES = 30000;
const first = (t, keys) => {
  for (const k of keys) if (t[k] !== undefined && t[k] !== null && t[k] !== "") return Number(t[k]);
  return null;
};

// Derives cockpit/classic signals from the shared operator telemetry feed (real DAQ or sim).
export function useCockpitSignals() {
  const ctx = useOperatorTelemetry();
  const t = ctx.telemetry || {};
  const samplesRef = useRef([]);
  const prevDepthRef = useRef(null);
  const [dirState, setDirState] = useState("STOPPED");
  const [version, setVersion] = useState(0);

  const pInt = first(t, ["internalPress"]);
  const pWh = first(t, ["whp"]);
  const weight = first(t, ["weight"]);
  const depth = first(t, ["depth"]);
  const pump = first(t, ["slurryRate", "pump_rate_bpm"]);
  const dp = diffPressure(pInt, pWh);
  const simulated = ctx.feedMode !== "LIVE";
  const encoders = [
    first(t, ["encoder_1_depth_ft", "traction_wheel_depth_ft"]),
    first(t, ["encoder_2_depth_ft", "gooseneck_depth_ft"]),
    first(t, ["encoder_3_depth_ft", "levelwind_depth_ft"]),
  ].map((v) => (v === null && simulated ? depth : v));
  const consensus = encoderConsensus(encoders);

  useEffect(() => {
    if (depth === null) return;
    const delta = prevDepthRef.current === null ? 0 : depth - prevDepthRef.current;
    prevDepthRef.current = depth;
    if (delta !== 0) setDirState(injectorDirection(0, delta));
    else if (t.direction === "stationary") setDirState("STOPPED");
    samplesRef.current.push({ ts: Date.now(), pInt, pWh, dp, weight, depth, pump });
    if (samplesRef.current.length > MAX_SAMPLES) samplesRef.current.splice(0, samplesRef.current.length - MAX_SAMPLES);
    setVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.telemetry]);

  const mag = first(t, ["speedFtPerMin"]);
  const speed = mag === null ? null : dirState === "POOH" ? -Math.abs(mag) : Math.abs(mag);
  const live = !!ctx.live;
  const connection = ctx.feedMode === "LIVE" ? (ctx.liveStale ? "STALE" : "CONNECTED · LIVE") : ctx.feedMode === "STANDBY" ? "STANDBY" : "SIMULATED";

  return useMemo(() => ({
    telemetry: t, pInt, pWh, dp, weight, depth, pump, encoders, consensus, speed,
    direction: dirState, live, connection, feedMode: ctx.feedMode,
    samples: samplesRef.current, version,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ctx.telemetry, dirState, version, ctx.feedMode, ctx.liveStale]);
}
