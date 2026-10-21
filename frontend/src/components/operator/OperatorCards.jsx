import React from "react";
import { X } from "lucide-react";
import { EditableTitle } from "./EditableTitle";

export const levelOf = (v, warn, crit) => {
  if (v == null) return "ok";
  if (crit != null && v >= crit) return "crit";
  if (warn != null && v >= warn) return "warn";
  return "ok";
};

const BAR = { ok: "bg-emerald-500", warn: "bg-amber-400", crit: "bg-rose-500" };
const BORDER = { ok: "border-slate-800", warn: "border-amber-500/60", crit: "border-rose-500/70" };

export function MetricCard({ title, value, unit, sub, barVal, testId }) {
  return (
    <div className="p-3 bg-[#0D1526] border border-slate-800 rounded-xl space-y-1 op-fade" data-testid={testId}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</span>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-black text-slate-100 font-mono tabular-nums" data-testid={`${testId}-value`}>{value}</span>
        <span className="text-xs text-slate-400 font-mono" data-testid={`${testId}-unit`}>{unit}</span>
      </div>
      {barVal != null && (
        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden relative mt-1">
          <div className={`${barVal >= 80 ? "bg-rose-500" : barVal >= 60 ? "bg-amber-400" : "bg-emerald-500"} h-full rounded-full transition-[width] duration-200`} style={{ width: `${Math.min(barVal, 100)}%` }} />
          <div className="absolute left-[80%] top-0 bottom-0 w-0.5 bg-slate-300" />
        </div>
      )}
      <div className="text-[10px] text-slate-500 font-mono break-words">{sub}</div>
    </div>
  );
}

export function ChannelCard({ title, defaultTitle, renamed, onRename, dragHandle, dragging, raw, value, unit, tag, warn, crit, warnLabel, critLabel, sourceLabel, testId, onRemove, spark }) {
  const level = levelOf(raw, warn, crit);
  const max = crit ? crit * 1.15 : null;
  const pct = max && raw != null ? Math.max(0, Math.min(100, (raw / max) * 100)) : 40;
  return (
    <div className={`p-3 bg-[#090F1C] border ${BORDER[level]} rounded-xl space-y-2 transition-[border-color,box-shadow] duration-300 ${dragging ? "shadow-2xl shadow-orange-500/20 ring-1 ring-orange-500/60" : ""}`} data-testid={testId} data-level={level}>
      <div className="flex justify-between items-center gap-2 text-[10px] font-bold">
        <span className="text-slate-300 uppercase tracking-wider truncate">{title}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-slate-500 font-mono">{tag}</span>
          {onRemove && <button onClick={onRemove} title="Remove from screen" className="p-0.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors" data-testid={`${testId}-remove-btn`}><X className="w-3 h-3" /></button>}
        </span>
      </div>
      <div className="flex items-baseline space-x-2">
        <span className="text-2xl font-black text-slate-100 font-mono tabular-nums" data-testid={`${testId}-value`}>{value}</span>
        <span className="text-xs text-slate-400 font-mono">{unit}</span>
      </div>
      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden relative">
        <div className={`${BAR[level]} h-full rounded-full transition-[width] duration-200`} style={{ width: `${pct}%` }} />
        {warn != null && max && <div className="absolute top-0 bottom-0 w-0.5 bg-amber-400" style={{ left: `${(warn / max) * 100}%` }} />}
        {crit != null && max && <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500" style={{ left: `${(crit / max) * 100}%` }} />}
      </div>
      {spark}
      <div className="text-[9px] text-slate-500 font-mono flex justify-between gap-2">
        <span>{sourceLabel}</span>
        {warnLabel && <span>warn {warnLabel} · crit {critLabel}</span>}
      </div>
    </div>
  );
}
