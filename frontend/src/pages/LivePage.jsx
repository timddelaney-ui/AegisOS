import React, { memo, useState } from "react";
import { Link } from "react-router-dom";
import { useOperatorTelemetry } from "../context/OperatorTelemetryContext";
import { useJobActions, useJobMode } from "../context/ActiveJobContext";
import { useOperatorUnits } from "../components/operator/useOperatorUnits";
import { JobGauge } from "../components/JobGauges";
import { FluidTotalizersPanel } from "../components/operator/FluidTotalizersPanel";
import { DepthCorrelationPanel } from "../components/operator/DepthCorrelationPanel";
import { CHANNELS } from "../lib/operatorConfig";
import { getTool } from "../config/toolRegistry";

const cockpitChannels = [
  CHANNELS.find((channel) => channel.key === "whp"),
  { key: "weight", title: "Surface weight", dim: "weight" },
  { key: "vonMises", title: "Von Mises", dim: "pct", warn: 80 },
  CHANNELS.find((channel) => channel.key === "n2Rate"),
];

function FeedControls() {
  const mode = useJobMode();
  const { updateJob } = useJobActions();
  const units = useOperatorUnits();
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <div className="flex gap-1" aria-label="Feed mode">{["SIM", "STANDBY", "LIVE"].map((value) =>
        <button key={value} className="job-secondary" aria-pressed={mode === value} onClick={() => updateJob({ mode: value })}>{value}</button>)}</div>
      <button className="job-secondary" onClick={units.toggle} aria-label="Change units">{units.isMetric ? "SI" : "IMP"}</button>
    </div>
  );
}

const LiveReadouts = memo(function LiveReadouts() {
  const { telemetry, sourceLabel, sourceFor, historyRef } = useOperatorTelemetry();
  const units = useOperatorUnits();
  const [selectedKey, setSelectedKey] = useState("whp");
  const channel = cockpitChannels.find((item) => item.key === selectedKey);
  const samples = (historyRef?.current || []).slice(-60).map((sample) => sample[selectedKey]).filter(Number.isFinite);
  const min = samples.length ? Math.min(...samples) : 0;
  const span = samples.length ? Math.max(...samples) - min || 1 : 1;
  const points = samples.map((value, i) => `${i * 300 / Math.max(samples.length - 1, 1)},${75 - (value - min) / span * 65}`).join(" ");
  const warnings = cockpitChannels.filter((item) => item.warn && telemetry?.[item.key] >= item.warn);
  const critical = warnings.some((item) => item.crit && telemetry[item.key] >= item.crit);
  return (
    <>
      <div className={`job-alarm ${critical ? "critical" : warnings.length ? "warning" : ""}`} role="status">
        <strong>{critical ? "CRITICAL" : warnings.length ? "WARNING" : "No threshold excursions"}</strong>
        <span>{warnings.map((item) => item.title).join(", ") || "Advisory channel limits"} / {sourceLabel}</span>
      </div>
      <div className="job-live-grid">
        {cockpitChannels.map((item) => <button key={item.key} className="job-gauge-select" aria-pressed={selectedKey === item.key} onClick={() => setSelectedKey(item.key)}>
          <JobGauge title={item.title} value={telemetry ? units.show(telemetry[item.key], item.dim, item.dim === "pct" ? 1 : undefined) : "--"}
            unit={units.label(item.dim)} source={sourceFor?.(item.key) || sourceLabel} testId={`live-${item.key}`} />
        </button>)}
      </div>
      <section className="job-card">
        <label className="flex items-center justify-between gap-2 text-sm">Trend
          <select className="job-input" value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)} aria-label="Trend channel">
            {cockpitChannels.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
          </select>
        </label>
        <svg viewBox="0 0 300 90" className="job-sparkline" role="img" aria-label={`${channel.title} recent samples`}>
          <path d="M0 80H300" stroke="#475569" />
          {points && <polyline points={points} fill="none" stroke="#ff9c66" strokeWidth="2" />}
        </svg>
        <p className="job-muted">{samples.length < 2 ? "Waiting for channel history. " : ""}{channel.title} / {sourceFor?.(selectedKey) || sourceLabel}</p>
      </section>
    </>
  );
});

function LiveActionPanel({ action }) {
  const feed = useOperatorTelemetry();
  const units = useOperatorUnits();
  if (!feed.telemetry) return <p role="status">No feed is available on this plan.</p>;
  if (action === "fluids") return <FluidTotalizersPanel telemetry={feed.telemetry} sourceFor={feed.sourceFor} />;
  if (action === "offset") return <DepthCorrelationPanel counterFt={feed.telemetry.depth} offsetFt={feed.corr.offsetFt} moveTarget={feed.corr.moveTarget}
    plugs={[]} log={feed.corr.log} u={units} onOffset={feed.corr.setOffset} onTarget={feed.corr.setTarget} shared={!!feed.survey} source={feed.sourceFor("depth")} />;
  return null;
}

export default function LivePage() {
  const [action, setAction] = useState(null);
  return (
    <div className="job-page" data-testid="live-cockpit">
      <h1 className="text-xl font-bold">Operator cockpit</h1>
      <FeedControls />
      <LiveReadouts />
      <Link className="job-primary" to={getTool("treatment").route}>Add a log entry</Link>
      <nav className="grid grid-cols-4 gap-2" aria-label="Live quick actions">
        <Link className="job-secondary text-center" to={getTool("treatment").route}>Log</Link>
        <button className="job-secondary" aria-pressed={action === "fluids"} onClick={() => setAction(action === "fluids" ? null : "fluids")}>Fluids</button>
        <button className="job-secondary" aria-pressed={action === "offset"} onClick={() => setAction(action === "offset" ? null : "offset")}>Offset</button>
        <Link className="job-secondary text-center" to={getTool("emergency").route}>SOP</Link>
      </nav>
      {action && <LiveActionPanel action={action} />}
      <Link className="job-secondary text-center" to="/live-ops">Full operator console / 3D / channels</Link>
    </div>
  );
}
