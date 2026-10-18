import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, Activity } from "lucide-react";
import { nextSimSample, SIM_TICK_MS, SIM_CHART_WINDOW } from "../lib/ctSimulator";
import { StripChart, LiveGauge, MiniVonMises } from "./LiveOpsPanels";

/**
 * Compact live telemetry sidebar for the Treatment split-screen view.
 * Keeps its own simulator so the user can follow the graph while writing notes
 * without having to leave the Treatment page. In Phase 2 this will be wired
 * to the shared WITS/Modbus feed so both panes read the same live stream.
 */
const LiveStripSidebar = ({ compact = false }) => {
  const [running, setRunning] = useState(true);
  const [samples, setSamples] = useState([]);
  const timerRef = useRef(null);
  const tRef = useRef(0);

  useEffect(() => {
    if (!running) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setInterval(() => {
      tRef.current += 1;
      setSamples((prev) => {
        const last = prev[prev.length - 1];
        const next = { ...nextSimSample(last, tRef.current), ts: new Date().toISOString(), source: "simulated" };
        const buf = [...prev, next];
        if (buf.length > SIM_CHART_WINDOW) buf.splice(0, buf.length - SIM_CHART_WINDOW);
        return buf;
      });
    }, SIM_TICK_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };
  }, [running]);

  const latest = samples[samples.length - 1] || {};
  const chart = samples.slice(-SIM_CHART_WINDOW);

  return (
    <div
      data-testid="live-strip-sidebar"
      className="h-full bg-[#0D1A24] text-white flex flex-col border-l border-black/40 overflow-hidden"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 flex-shrink-0"
        style={{ boxShadow: "0 1px 0 rgba(255,107,26,0.2)" }}
      >
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#FF6B1A]" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Live telemetry</span>
          <span className="text-[9px] text-white/50 tabular-nums">· {samples.length} samples</span>
        </div>
        <button
          data-testid="live-strip-run-toggle"
          onClick={() => setRunning((v) => !v)}
          className={`text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 ${running ? "bg-[#FF6B1A] text-white" : "bg-white/10 border border-white/20"}`}
        >
          {running ? <><Pause className="w-3 h-3" />Live</> : <><Play className="w-3 h-3" />Paused</>}
        </button>
      </div>

      {/* Panels */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Depth + source */}
        <div className="bg-[#111827] border border-white/10 rounded p-2">
          <div className="text-[9px] uppercase tracking-wider text-white/50 mb-0.5">Depth</div>
          <div className="text-2xl font-extrabold tabular-nums text-white">
            {Math.round(latest.depth_ft || 0).toLocaleString()}<span className="text-xs text-white/60 ml-1">ft</span>
          </div>
        </div>

        {/* Pressure + Weight gauges */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[#111827] border border-white/10 rounded p-2 h-28">
            <LiveGauge title="Pressure" unit="psi" value={latest.p_internal_psi || 0} min={0} max={10000} warnAbove={7500} criticalAbove={9000} color="#DC2626" />
          </div>
          <div className="bg-[#111827] border border-white/10 rounded p-2 h-28">
            <LiveGauge title="Weight" unit="lbf" value={latest.weight_lb || 0} min={0} max={30000} warnAbove={22000} criticalAbove={27000} color="#0056B3" />
          </div>
        </div>

        {/* Strip chart */}
        <div className="bg-[#111827] border border-white/10 rounded p-2 h-44">
          <StripChart samples={chart} series={[
            { key: "p_internal_psi", color: "#DC2626", label: "P psi" },
            { key: "weight_lb",      color: "#0056B3", label: "W lbf" },
          ]} />
        </div>

        {!compact && (
          <div className="bg-[#111827] border border-white/10 rounded p-2 h-44">
            <div className="text-[9px] uppercase tracking-wider text-white/50 mb-1">Von Mises · thin-wall rotated ellipse</div>
            <div className="h-36"><MiniVonMises sample={latest} /></div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 text-center text-[9px] text-white/40 py-1 border-t border-white/10">
        Simulated · WITS 0 / Modbus wires in Phase 2
      </div>
    </div>
  );
};

export default LiveStripSidebar;
