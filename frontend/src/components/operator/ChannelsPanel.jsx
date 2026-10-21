import React from "react";
import { Plus } from "lucide-react";
import { ChannelCard, levelOf } from "./OperatorCards";

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function Sparkline({ values }) {
  if (values.length < 2) return <div className="h-5" />;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${18 - ((v - min) / span) * 14 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-5">
      <polyline points={pts} fill="none" stroke="#22D3EE" strokeWidth="1.2" vectorEffect="non-scaling-stroke" opacity="0.85" />
    </svg>
  );
}

export function ChannelsPanel({ channels, groups, activeSets, hidden, telemetry, history, u, sourceLabel, onToggleSet, onHide, onOpenAdd }) {
  const visible = channels.filter((c) => activeSets.includes(c.group) && !hidden.includes(c.key || c.id));
  const alarms = visible.filter((c) => c.key && levelOf(telemetry[c.key], c.warn, c.crit) !== "ok").length;

  return (
    <div className="bg-[#0D1526] border border-slate-800 rounded-2xl p-4 space-y-3" data-testid="channels-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold tracking-wide text-slate-100">CHANNELS</h2>
          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${alarms ? "bg-rose-500/10 border-rose-500/40 text-rose-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"}`} data-testid="alarm-badge">
            {alarms ? `${alarms} ALARM${alarms > 1 ? "S" : ""}` : "NO ALARMS"}
          </span>
        </div>
        <button onClick={onOpenAdd} className="flex items-center gap-1 px-3 py-1 bg-orange-600 hover:bg-orange-500 transition-colors text-white rounded-lg text-xs font-semibold" data-testid="add-channel-btn">
          <Plus className="w-3.5 h-3.5" /> Add channel
        </button>
      </div>
      <div className="space-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Job set</span>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          {groups.map((set) => {
            const on = activeSets.includes(set);
            return (
              <button key={set} onClick={() => onToggleSet(set)} aria-pressed={on}
                className={`px-3 py-1 rounded-lg border transition-colors whitespace-nowrap ${on ? "bg-orange-600 border-orange-500 text-white" : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"}`}
                data-testid={`job-set-${slug(set)}`}>{set}</button>
            );
          })}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-slate-500 py-3" data-testid="channels-empty">No channels on screen. Turn on a job set or use “Add channel”.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((c) => {
            const id = c.key || c.id;
            const raw = c.key ? telemetry[c.key] : null;
            return (
              <ChannelCard key={id} testId={`channel-${id}`} title={c.title} raw={raw}
                value={u.show(raw, c.dim, c.dim === "n2_vol" ? 0 : undefined)} unit={u.label(c.dim)} tag={c.tag}
                warn={c.warn} crit={c.crit} warnLabel={c.warn != null ? u.show(c.warn, c.dim) : null} critLabel={c.crit != null ? u.show(c.crit, c.dim) : null}
                sourceLabel={c.key ? sourceLabel : "no source tag"} onRemove={() => onHide(id)}
                spark={<Sparkline values={c.key ? history.slice(-60).map((h) => u.val(h[c.key], c.dim) ?? 0) : []} />} />
            );
          })}
        </div>
      )}
    </div>
  );
}
