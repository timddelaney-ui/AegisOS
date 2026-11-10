import React, { useMemo, useState } from "react";
import { CATEGORIES, pctDelta, classifyDelta } from "../../lib/shadow/variance";
import DeltaBadge from "./DeltaBadge";
import DeltaGauge from "./DeltaGauge";

/**
 * One comparison input card. `fields` drive the Aegis-side calculation; the user
 * enters the legacy/measured reference and sees the live delta before logging it.
 */
export default function ShadowCalcCard({ category, fields, compute, unit, onRecord, disabled }) {
  const cfg = CATEGORIES[category];
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.default])));
  const [metric, setMetric] = useState(cfg.metrics[0]);
  const [override, setOverride] = useState("");
  const [reference, setReference] = useState("");

  const auto = useMemo(() => {
    try { return compute(vals); } catch { return null; }
  }, [compute, vals]);
  const aegis = override !== "" ? Number(override) : auto;
  const delta = pctDelta(aegis, reference);
  const status = classifyDelta(delta);
  const ready = delta != null && Number.isFinite(aegis);

  return (
    <section className="cab-card p-4" data-testid={`shadow-card-${category}`}>
      <h3 className="text-sm font-bold text-white">{cfg.label}</h3>
      <p className="mb-3 text-xs text-slate-400">vs {cfg.reference}</p>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="cab-label">{f.label}</span>
            <input className="cab-input" type="number" inputMode="decimal" step={f.step || "any"} value={vals[f.key]}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} data-testid={`${category}-${f.key}`} />
          </label>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="cab-label">Metric</span>
        <select className="cab-input" value={metric} onChange={(e) => setMetric(e.target.value)}>
          {cfg.metrics.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="cab-label">Aegis ({unit}){override === "" ? " · auto" : ""}</span>
          <input className="cab-input" type="number" inputMode="decimal" placeholder={auto == null ? "—" : auto.toFixed(3)} value={override}
            onChange={(e) => setOverride(e.target.value)} data-testid={`${category}-override`} />
        </label>
        <label className="block">
          <span className="cab-label">Reference ({unit})</span>
          <input className="cab-input" type="number" inputMode="decimal" value={reference} onChange={(e) => setReference(e.target.value)} data-testid={`${category}-reference`} />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <DeltaBadge delta={delta} status={status} />
        <button type="button" className="cab-btn disabled:opacity-40" disabled={disabled || !ready}
          onClick={() => { onRecord({ category, metric, aegis, reference, unit }); setReference(""); }} data-testid={`${category}-record`}>
          Log comparison
        </button>
      </div>
      <div className="mt-2"><DeltaGauge delta={delta} status={status} /></div>
    </section>
  );
}
