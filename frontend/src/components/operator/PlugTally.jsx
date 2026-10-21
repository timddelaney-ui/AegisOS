import React from "react";
import { FlaskConical, Square, ListPlus, Plus, X } from "lucide-react";

export function PlugTally({ plugs, depth, u, isDemo, canDelete, onManage, onAdd, onDelete, testRun, onStartTest, onStopTest }) {
  const { run, lastRun } = testRun;
  const D = (v) => `${u.show(v, "depth", 1)} ${u.label("depth")}`;
  return (
    <div className="p-3 bg-[#0D1526] border border-slate-800 rounded-xl space-y-2" data-testid="plug-tally">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Plug tally</span>
          {isDemo && <span className="text-[9px] font-mono text-slate-500 border border-slate-700 rounded px-1.5" data-testid="plug-tally-demo-badge">DEMO PLUGS</span>}
        </div>
        <div className="flex items-center gap-2">
          {run ? (
            <button onClick={onStopTest} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-500/50 bg-rose-500/15 text-rose-300 text-[11px] font-bold" data-testid="plug-test-stop-btn">
              <Square className="w-3 h-3" /> Stop test run
            </button>
          ) : (
            <button onClick={onStartTest} disabled={!plugs.length} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 text-[11px] font-bold hover:bg-cyan-500/20 disabled:opacity-40 transition-colors" data-testid="plug-test-run-btn">
              <FlaskConical className="w-3 h-3" /> Test run
            </button>
          )}
          {!isDemo && (
            <button onClick={onManage} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold transition-colors" data-testid="plug-manage-btn">
              <ListPlus className="w-3 h-3" /> Edit plugs
            </button>
          )}
        </div>
      </div>

      {run && (
        <div className="text-[10px] font-mono text-cyan-300 bg-cyan-500/5 border border-cyan-500/30 rounded-lg px-2 py-1" data-testid="plug-test-progress">
          TEST RUN {run.speed}x · bit {D(depth)} · {run.passes.length}/{plugs.length} plugs cleared
        </div>
      )}

      {plugs.length === 0 ? (
        <p className="text-xs text-slate-500 py-2" data-testid="plug-tally-empty">No plugs recorded for this well yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {plugs.map((p) => {
            const passed = depth >= p.end;
            return (
              <div key={p.id} className="flex items-stretch gap-1.5">
              <div title={p.notes || ""} className={`flex-1 min-w-0 p-2.5 bg-[#090F1C] border rounded-lg flex justify-between items-center gap-2 text-xs transition-colors ${passed ? "border-slate-800" : "border-purple-500/40"}`} data-testid={`plug-${p.id}`}>
                <div className="min-w-0">
                  <span className="font-bold text-purple-400 mr-1.5">{p.name}</span>
                  <span className="text-slate-200">{p.type}</span>
                  <div className="text-[10px] text-slate-400 font-mono">{u.show(p.start, "depth", 1)}–{u.show(p.end, "depth", 1)} {u.label("depth")}</div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-[9px] font-bold uppercase ${passed ? "text-emerald-400" : "text-amber-400"}`} data-testid={`plug-${p.id}-status`}>{passed ? "passed" : "ahead"}</span>
                  <div className="text-[11px] font-mono text-slate-300">{D(Math.abs(depth - p.start))}</div>
                </div>
              </div>
              {canDelete && (
                <button onClick={() => onDelete(p.id)} title={`Delete ${p.name}`} className="px-2 bg-[#090F1C] border border-slate-800 hover:border-rose-500/60 rounded-lg text-slate-500 hover:text-rose-400 transition-colors" data-testid={`plug-${p.id}-delete-btn`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              </div>
            );
          })}
        </div>
      )}

      {!isDemo && (
        <button onClick={onAdd} className="w-full flex items-center gap-2 px-3 py-2.5 border border-dashed border-slate-700 hover:border-orange-500/60 rounded-lg text-xs font-semibold text-slate-300 transition-colors" data-testid="plug-add-inline-btn">
          <Plus className="w-3.5 h-3.5 text-orange-500" /> Add a plug
        </button>
      )}

      {lastRun && !run && (
        <div className="text-[10px] font-mono text-slate-400 border-t border-slate-800 pt-2" data-testid="plug-last-run">
          <span className="text-slate-300 font-bold">LAST TEST RUN</span> · {lastRun.speed}x · {lastRun.duration_s}s · {lastRun.passes.length} plugs cleared
          {lastRun.passes.length > 0 && <> — {lastRun.passes.map((x) => `${x.name} @ ${x.elapsed_s}s`).join(" · ")}</>}
        </div>
      )}
    </div>
  );
}
