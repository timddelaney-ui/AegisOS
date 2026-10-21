import React from "react";
import { Box, ArrowRightLeft, Map, Maximize2, Crosshair, Orbit, Plus, Minus } from "lucide-react";

const b = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors";
const off = "bg-slate-900 border-slate-800 text-slate-300 hover:border-orange-500/60";

export function ViewerToolbar({ view, orbit, onCmd, onOrbit }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="viewer-toolbar">
      <div className="flex rounded-lg border border-slate-800 overflow-hidden text-xs font-semibold">
        {[["3d", "3D", Box], ["side", "Side", ArrowRightLeft], ["plan", "Plan", Map]].map(([k, l, I]) => (
          <button key={k} onClick={() => onCmd(k)} className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${view === k ? "bg-orange-600 text-white" : "bg-slate-900 text-slate-300 hover:text-white"}`} data-testid={`viewer-${k}-btn`}>
            <I className="w-3.5 h-3.5" /> {l}
          </button>
        ))}
      </div>
      <button onClick={() => onCmd("fit")} className={`${b} ${off}`} data-testid="viewer-fit-btn"><Maximize2 className="w-3.5 h-3.5" /> Fit</button>
      <button onClick={() => onCmd("bit")} className={`${b} ${off}`} data-testid="viewer-zoom-bit-btn"><Crosshair className="w-3.5 h-3.5" /> Zoom to bit</button>
      <button onClick={onOrbit} aria-pressed={orbit} className={`${b} ${orbit ? "bg-cyan-500/15 border-cyan-500/60 text-cyan-300" : off}`} data-testid="viewer-orbit-btn"><Orbit className="w-3.5 h-3.5" /> Orbit</button>
    </div>
  );
}

export function ZoomButtons({ onCmd }) {
  return (
    <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-2">
      <button onClick={() => onCmd("in")} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-950/90 border border-slate-800 hover:border-orange-500/60 text-slate-200 transition-colors" data-testid="viewer-zoom-in-btn"><Plus className="w-4 h-4" /></button>
      <button onClick={() => onCmd("out")} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-950/90 border border-slate-800 hover:border-orange-500/60 text-slate-200 transition-colors" data-testid="viewer-zoom-out-btn"><Minus className="w-4 h-4" /></button>
    </div>
  );
}
