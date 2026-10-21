import React, { useEffect, useState } from "react";
import { Crosshair, RotateCcw } from "lucide-react";

const btn = "px-3 py-2 rounded-lg border border-slate-800 bg-slate-900 hover:border-orange-500/60 text-xs font-bold text-slate-200 transition-colors";
const REASON = { manual: "typed", nudge: "nudge", reset: "reset", tag: "tag", target: "move" };

// True depth = counter + offset. All props canonical ft; UI in display units.
export function DepthCorrelationPanel({ counterFt, offsetFt, moveTarget, plugs, log, u, onOffset, onTarget, shared }) {
  const L = u.label("depth");
  const disp = (ft) => u.val(ft, "depth");
  const toFt = (v) => (u.isMetric ? u.to(v, "depth") : v);
  const [offsetText, setOffsetText] = useState("");
  const [tagPlug, setTagPlug] = useState("");
  const [tagCounter, setTagCounter] = useState("");

  useEffect(() => { setOffsetText(disp(offsetFt).toFixed(1)); }, [offsetFt, u.isMetric]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!plugs.some((p) => p.id === tagPlug)) setTagPlug(plugs[0]?.id || ""); }, [plugs, tagPlug]);

  const plug = plugs.find((p) => p.id === tagPlug);
  const counterAtTag = tagCounter === "" ? counterFt : toFt(parseFloat(tagCounter));
  const tagOffset = plug && Number.isFinite(counterAtTag) ? plug.start - counterAtTag : null;
  const commitText = () => {
    const v = parseFloat(offsetText);
    if (Number.isFinite(v) && Math.abs(toFt(v) - offsetFt) > 0.01) onOffset(toFt(v), "manual");
  };

  return (
    <div className="bg-[#0D1526] border border-slate-800 rounded-2xl p-4 space-y-3" data-testid="depth-correlation-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold tracking-wide text-slate-100 uppercase">Depth correlation</h2>
        <span className="text-[9px] font-mono text-slate-500">{shared ? "shared with crew · per well" : "local only · no survey"}</span>
      </div>
      <p className="text-xs text-slate-400">True depth is the counter reading plus the offset. Use it when the string and the plugs do not line up.</p>

      <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Counter</div>
          <div className="text-xl font-black font-mono tabular-nums" data-testid="correlation-counter">{u.show(counterFt, "depth", 1)} <span className="text-xs text-slate-400">{L}</span></div>
        </div>
        <div className="p-3 bg-slate-950 border border-orange-500/30 rounded-xl">
          <div className="text-[10px] font-bold uppercase tracking-wider text-orange-400">True depth</div>
          <div className="text-xl font-black font-mono tabular-nums" data-testid="correlation-true-depth">{u.show(counterFt + offsetFt, "depth", 1)} <span className="text-xs text-slate-400">{L}</span></div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Offset {L}</label>
        <div className="flex gap-2">
          <input type="number" step="0.1" value={offsetText} onChange={(e) => setOffsetText(e.target.value)} onBlur={commitText} onKeyDown={(e) => e.key === "Enter" && commitText()}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-orange-500 outline-none rounded-lg px-3 py-2 text-sm font-mono text-slate-100" data-testid="correlation-offset-input" />
          <button onClick={() => onOffset(0, "reset")} className={`${btn} flex items-center gap-1`} data-testid="correlation-reset-btn"><RotateCcw className="w-3.5 h-3.5" /> Reset to 0</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[-5, -0.5, 0.5, 5].map((d) => (
            <button key={d} onClick={() => onOffset(offsetFt + toFt(d), "nudge")} className={btn} data-testid={`correlation-nudge-${d}`}>{d > 0 ? `+${d}` : d}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Move on screen</span>
        <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs font-semibold" data-testid="correlation-move-toggle">
          {[["ct_string", "CT string"], ["plugs", "Plugs"]].map(([k, l]) => (
            <button key={k} onClick={() => k !== moveTarget && onTarget(k)} className={`px-3 py-1 rounded transition-colors ${moveTarget === k ? "bg-orange-600 text-white" : "text-slate-400 hover:text-slate-200"}`} data-testid={`correlation-move-${k}`}>{l}</button>
          ))}
        </div>
      </div>
      </div>
      <div className="space-y-3">
      <div className="p-3 bg-[#090F1C] border border-slate-800 rounded-xl space-y-2" data-testid="tag-plug-section">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-200">Tag a plug</div>
        {plugs.length === 0 ? <p className="text-xs text-slate-500">Add plugs first to correlate against them.</p> : (
          <>
            <label className="block text-[10px] font-bold uppercase text-slate-400">Plug tagged
              <select value={tagPlug} onChange={(e) => setTagPlug(e.target.value)} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100" data-testid="tag-plug-select">
                {plugs.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.type} · {u.show(p.start, "depth", 1)} {L}</option>)}
              </select>
            </label>
            <label className="block text-[10px] font-bold uppercase text-slate-400">Counter at tag (blank = current counter)
              <input type="number" value={tagCounter} onChange={(e) => setTagCounter(e.target.value)} placeholder="current counter"
                className="mt-1 w-full bg-slate-950 border border-slate-800 focus:border-orange-500 outline-none rounded-lg px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600" data-testid="tag-counter-input" />
            </label>
            {tagOffset != null && (
              <p className="text-[11px] font-mono text-slate-400" data-testid="tag-offset-preview">
                Plug {u.show(plug.start, "depth", 1)} − counter {u.show(counterAtTag, "depth", 1)} = offset {disp(tagOffset) >= 0 ? "+" : ""}{u.show(tagOffset, "depth", 1)} {L}
              </p>
            )}
            <button disabled={tagOffset == null} onClick={() => { onOffset(tagOffset, "tag", { plug_id: plug.id, plug_name: plug.name, plug_md_ft: plug.start, counter_ft: counterAtTag }); setTagCounter(""); }}
              className="w-full flex items-center justify-center gap-1.5 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white font-bold text-xs rounded-lg transition-colors" data-testid="tag-set-offset-btn">
              <Crosshair className="w-3.5 h-3.5" /> Set offset from tag
            </button>
          </>
        )}
      </div>

      <div className="space-y-1" data-testid="correlation-log">
        {log.length === 0 ? <p className="text-xs text-slate-500">No correlations logged yet.</p> : log.slice(0, 6).map((e) => (
          <div key={e.entry_id} className="flex justify-between gap-2 text-[10px] font-mono text-slate-400 border-b border-slate-800/60 py-1">
            <span className="truncate">{(e.by_name || e.by || "").split("@")[0]} · {REASON[e.reason] || e.reason}{e.plug_name ? ` ${e.plug_name}` : ""} · {u.show(e.prev_offset_ft, "depth", 1)} → <span className="text-orange-300">{u.show(e.offset_ft, "depth", 1)} {L}</span></span>
            <span className="shrink-0">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        ))}
      </div>
      </div>
      </div>
    </div>
  );
}
