import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Layers, Box, Play, Pause, RotateCcw, Plus, Users } from "lucide-react";
import { API } from "../context/AuthContext";
import { useRig } from "../context/RigContext";
import { UNIT_SYSTEMS } from "../lib/units";
import {
  SEED_TELEMETRY, CHANNELS, JOB_SETS, PLUGS, DEFAULT_CREW, DEPTH_MIN_FT, DEPTH_MAX_FT, simTick, fromDaqSample,
} from "../lib/operatorConfig";
import { useOperatorUnits } from "./operator/useOperatorUnits";
import { MetricCard, ChannelCard, levelOf } from "./operator/OperatorCards";
import { drawTrajectory, drawPens, PENS } from "./operator/operatorCanvas";
import { CrewRatesModal } from "./operator/CrewRatesModal";
import { AddChannelModal } from "./operator/AddChannelModal";

const CREW_KEY = "coilaegis_crew_rates_v1";
const CUSTOM_CH_KEY = "coilaegis_custom_channels_v1";
const loadLS = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch { return fallback; } };
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.debug("[Operator] save failed", e?.message); } };

const seg = (active, on) => `px-2.5 py-1 rounded transition-colors ${active ? on : "text-slate-400 hover:text-slate-200"}`;
const PEN_ON = {
  orange: "bg-orange-500/20 border-orange-500 text-orange-300", emerald: "bg-emerald-500/20 border-emerald-500 text-emerald-300",
  cyan: "bg-cyan-500/20 border-cyan-500 text-cyan-300", rose: "bg-rose-500/20 border-rose-500 text-rose-300",
  blue: "bg-blue-500/20 border-blue-500 text-blue-300", purple: "bg-purple-500/20 border-purple-500 text-purple-300",
};

const isFresh = (s) => {
  const ts = s?.created_at || "";
  const parsed = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`);
  return Number.isFinite(parsed) && Date.now() - parsed < 5000;
};

export default function MainOperatorScreen() {
  const u = useOperatorUnits();
  const { rigId } = useRig();
  const [viewStyle, setViewStyle] = useState("3d-live");
  const [feedMode, setFeedMode] = useState("SIM");
  const [liveStale, setLiveStale] = useState(false);
  const [activeJobSet, setActiveJobSet] = useState("Pressures");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isSimRunning, setIsSimRunning] = useState(true);
  const [colorMode, setColorMode] = useState("DLS");
  const [showManageChannels, setShowManageChannels] = useState(false);
  const [showCrewSetup, setShowCrewSetup] = useState(false);
  const [crewMembers, setCrewMembers] = useState(() => loadLS(CREW_KEY, DEFAULT_CREW));
  const [customChannels, setCustomChannels] = useState(() => loadLS(CUSTOM_CH_KEY, []));
  const [activePens, setActivePens] = useState(() => Object.fromEntries(PENS.map((p) => [p.key, true])));
  const [telemetry, setTelemetry] = useState(SEED_TELEMETRY);
  const canvasPenRef = useRef(null);
  const canvas3DRef = useRef(null);
  const historyRef = useRef([]);

  const push = (next) => { historyRef.current = [...historyRef.current.slice(-99), next]; return next; };

  // SIM ticker (also acts as fallback when LIVE has no fresh DAQ sample)
  useEffect(() => {
    if (feedMode === "STANDBY" || !isSimRunning) return;
    if (feedMode === "LIVE" && !liveStale) return;
    const id = setInterval(() => setTelemetry((prev) => push(simTick(prev, playbackSpeed))), 200);
    return () => clearInterval(id);
  }, [isSimRunning, feedMode, playbackSpeed, liveStale]);

  // LIVE DAQ poll — /api/liveops/stream @ 1 Hz
  useEffect(() => {
    if (feedMode !== "LIVE") { setLiveStale(false); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await axios.get(`${API}/liveops/stream`, { params: { limit: 1, rig_id: rigId }, withCredentials: true });
        const s = r.data?.samples?.[0];
        if (cancelled) return;
        if (s && isFresh(s)) { setLiveStale(false); setTelemetry((prev) => push(fromDaqSample(prev, s))); }
        else setLiveStale(true);
      } catch (e) {
        if (!cancelled) setLiveStale(true);
        console.debug("[Operator] live poll failed", e?.response?.status || e?.message);
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [feedMode, rigId]);

  const bitLabel = `BIT ${u.show(telemetry.depth, "depth", 1)} ${u.label("depth")}`;
  useEffect(() => {
    if (viewStyle !== "3d-live" || !canvas3DRef.current) return;
    const c = canvas3DRef.current;
    drawTrajectory(c.getContext("2d"), c.width, c.height, { depthFt: telemetry.depth, colorMode, plugs: PLUGS, bitLabel });
  }, [telemetry.depth, viewStyle, colorMode, bitLabel]);

  useEffect(() => {
    if (viewStyle !== "pen-graph" || !canvasPenRef.current) return;
    const c = canvasPenRef.current;
    drawPens(c.getContext("2d"), c.width, c.height, historyRef.current, activePens);
  }, [telemetry, viewStyle, activePens]);

  const live = feedMode === "LIVE" && !liveStale;
  const sourceLabel = feedMode === "STANDBY" ? "standby • feed held" : live ? "live DAQ" : feedMode === "LIVE" ? "DAQ stale • sim fallback" : "simulated";
  const P = (v) => u.show(v, "pressure");

  const allChannels = useMemo(() => [...CHANNELS, ...customChannels], [customChannels]);
  const alarms = allChannels.filter((c) => c.key && levelOf(telemetry[c.key], c.warn, c.crit) !== "ok").length;
  const groups = customChannels.some((c) => c.group === "Custom") ? [...JOB_SETS, "Custom"] : JOB_SETS;

  const setDepthFromSlider = (displayVal) => {
    const ft = u.isMetric ? u.to(displayVal, "depth") : displayVal;
    setTelemetry((prev) => ({ ...prev, depth: ft }));
  };
  const saveCrew = (next) => { setCrewMembers(next); saveLS(CREW_KEY, next); setShowCrewSetup(false); toast.success("Crew rates saved"); };
  const addChannel = (ch) => { const next = [...customChannels, ch]; setCustomChannels(next); saveLS(CUSTOM_CH_KEY, next); setActiveJobSet(ch.group); toast.success(`Channel "${ch.title}" added`); };
  const removeChannel = (id) => { const next = customChannels.filter((c) => c.id !== id); setCustomChannels(next); saveLS(CUSTOM_CH_KEY, next); };

  return (
    <div className="flex flex-col bg-[#070C14] text-slate-100 p-3 space-y-3" data-testid="main-operator-screen">
      {/* 1. CONTROLS + SIM SCRUBBER */}
      <div className="bg-[#0D1526] p-3 rounded-2xl border border-slate-800 space-y-3 op-fade">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs font-semibold" data-testid="unit-toggle">
              <button onClick={() => u.setSystem(UNIT_SYSTEMS.METRIC)} className={seg(u.isMetric, "bg-orange-600 text-white")} data-testid="unit-si-btn">SI</button>
              <button onClick={() => u.setSystem(UNIT_SYSTEMS.IMPERIAL)} className={seg(u.isImperial, "bg-orange-600 text-white")} data-testid="unit-imp-btn">IMP</button>
            </div>
            <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs font-semibold" data-testid="feed-mode-toggle">
              <button onClick={() => setFeedMode("SIM")} className={seg(feedMode === "SIM", "bg-orange-600 text-white")} data-testid="feed-sim-btn">SIM</button>
              <button onClick={() => setFeedMode("STANDBY")} className={seg(feedMode === "STANDBY", "bg-slate-700 text-white")} data-testid="feed-standby-btn">STANDBY</button>
              <button onClick={() => setFeedMode("LIVE")} className={seg(feedMode === "LIVE", "bg-emerald-600 text-white")} data-testid="feed-live-btn">LIVE</button>
            </div>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${live ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" : feedMode === "LIVE" ? "text-amber-300 border-amber-500/40 bg-amber-500/10" : "text-slate-400 border-slate-700"}`} data-testid="feed-status">
              {sourceLabel.toUpperCase()}
            </span>
            <button onClick={() => setShowCrewSetup(true)} className="flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-slate-800 hover:border-orange-500/60 transition-colors rounded-lg text-xs font-bold text-orange-400" data-testid="crew-rates-btn">
              <Users className="w-3.5 h-3.5" /> Crew Rates
            </button>
          </div>

          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold" data-testid="view-style-toggle">
            <button onClick={() => setViewStyle("3d-live")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${viewStyle === "3d-live" ? "bg-cyan-500 text-slate-950 font-black" : "text-slate-400 hover:text-slate-200"}`} data-testid="view-3d-live-btn">
              <Box className="w-3.5 h-3.5" /> 3D Live (Enterprise)
            </button>
            <button onClick={() => setViewStyle("pen-graph")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${viewStyle === "pen-graph" ? "bg-cyan-500 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-200"}`} data-testid="view-pen-graph-btn">
              <Layers className="w-3.5 h-3.5" /> Old Pen Graph Style
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/60 text-xs">
          <button onClick={() => setIsSimRunning((r) => !r)} className={`flex items-center gap-1 px-3 py-1 rounded-lg border font-bold transition-colors ${isSimRunning ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300" : "bg-rose-500/20 border-rose-500/50 text-rose-300"}`} data-testid="sim-play-pause-btn">
            {isSimRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isSimRunning ? "SIM RUNNING" : "PAUSED"}</span>
          </button>
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Speed:</span>
            {[1, 5, 10].map((s) => (
              <button key={s} onClick={() => setPlaybackSpeed(s)} className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${playbackSpeed === s ? "bg-orange-600 text-white" : "text-slate-400 hover:text-slate-200"}`} data-testid={`sim-speed-${s}x-btn`}>{s}x</button>
            ))}
          </div>
          <input type="range" min={Math.round(u.val(DEPTH_MIN_FT, "depth"))} max={Math.round(u.val(DEPTH_MAX_FT, "depth"))} step={1}
            value={u.val(telemetry.depth, "depth")} onChange={(e) => setDepthFromSlider(parseFloat(e.target.value))}
            className="flex-1 min-w-[160px] accent-orange-500 h-1.5 cursor-pointer" data-testid="sim-depth-slider" />
          <button onClick={() => setTelemetry((p) => ({ ...p, depth: DEPTH_MIN_FT }))} className="p-1 text-slate-400 hover:text-white transition-colors" title="Reset simulation depth" data-testid="sim-reset-btn">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. READOUT CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <MetricCard testId="metric-bit-depth" title="CT Bit Depth" value={u.show(telemetry.depth, "depth", 1)} unit={u.label("depth")} sub={`counter • offset ±0.0 ${u.label("depth")}`} />
        <MetricCard testId="metric-von-mises" title="Von Mises" value={telemetry.vonMises.toFixed(1)} unit="%SMYS" sub={`${sourceLabel} • 80% alert line`} barVal={telemetry.vonMises} />
        <MetricCard testId="metric-surface-weight" title="Surface Weight" value={u.show(telemetry.weight, "weight", 0)} unit={u.label("weight")} sub={sourceLabel} />
        <MetricCard testId="metric-internal-pressure" title="Internal Pressure" value={P(telemetry.internalPress)} unit={u.label("pressure")} sub={sourceLabel} />
        <MetricCard testId="metric-wellhead-pressure" title="Wellhead Pressure" value={P(telemetry.whp)} unit={u.label("pressure")} sub={`${sourceLabel} • crit ${P(7208)}`} />
        <MetricCard testId="metric-net-dp" title="Net ΔP" value={P(telemetry.netDeltaP)} unit={u.label("pressure")} sub="internal − wellhead" />
      </div>

      {/* 3. VIEWPORT */}
      {viewStyle === "3d-live" ? (
        <div className="space-y-3" data-testid="view-3d-live">
          <div className="bg-[#0B1120] border border-slate-800 rounded-2xl p-4 relative h-72 overflow-hidden">
            <div className="absolute top-4 left-4 p-3 bg-slate-950/90 border border-slate-800 rounded-xl text-xs space-y-1 backdrop-blur z-10" data-testid="at-bit-readout">
              <div className="text-[10px] font-bold text-orange-400 uppercase">At bit readout</div>
              <div className="text-slate-300">MD: <span className="font-mono text-slate-100">{u.show(telemetry.depth, "depth", 1)} {u.label("depth")}</span></div>
              <div className="text-slate-300">TVD: <span className="font-mono text-slate-100">{u.show(telemetry.tvd, "depth", 1)} {u.label("depth")}</span></div>
              <div className="text-slate-300">Incl: <span className="font-mono text-slate-100">{telemetry.inclination}°</span></div>
              <div className="text-slate-300">DLS: <span className="font-mono text-slate-100">{u.show(telemetry.dls, "dls", 2)} {u.label("dls")}</span></div>
              <div className="text-slate-300">Drag: <span className="font-mono text-slate-100">{u.show(telemetry.drag, "weight", 0)} {u.label("weight")}</span></div>
            </div>
            <div className="absolute top-4 right-4 flex bg-slate-950/90 p-0.5 rounded-lg border border-slate-800 text-[10px] font-bold z-10" data-testid="color-mode-toggle">
              {["DLS", "Plain"].map((m) => (
                <button key={m} onClick={() => setColorMode(m)} className={seg(colorMode === m, "bg-cyan-500 text-slate-950")} data-testid={`color-mode-${m.toLowerCase()}-btn`}>{m}</button>
              ))}
            </div>
            <div className="absolute bottom-4 left-4 p-2 bg-slate-950/90 border border-slate-800 rounded-lg text-[10px] font-mono flex flex-wrap items-center gap-3 z-10">
              <span className="text-slate-400 font-bold">DLS {u.label("dls")}:</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-sm" /><span className="text-slate-300">&lt; {u.show(0.91, "dls", 1)}</span></span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 rounded-sm" /><span className="text-slate-300">{u.show(0.91, "dls", 1)}–{u.show(1.83, "dls", 1)}</span></span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-sm" /><span className="text-slate-300">&gt; {u.show(1.83, "dls", 1)}</span></span>
            </div>
            <canvas ref={canvas3DRef} width={1100} height={280} className="w-full h-full block" data-testid="trajectory-canvas" />
          </div>

          <div className="p-3 bg-[#0D1526] border border-slate-800 rounded-xl space-y-2" data-testid="plug-tally">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Plug tally</span>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PLUGS.map((p) => {
                const passed = telemetry.depth >= p.end;
                const dist = Math.abs(telemetry.depth - p.start);
                return (
                  <div key={p.id} className={`p-2.5 bg-[#090F1C] border rounded-lg flex justify-between items-center text-xs transition-colors ${passed ? "border-slate-800" : "border-purple-500/40"}`} data-testid={`plug-${p.id}`}>
                    <div>
                      <span className="font-bold text-purple-400 mr-1.5">{p.id}</span>
                      <span className="text-slate-200">{p.type}</span>
                      <div className="text-[10px] text-slate-400 font-mono">{u.show(p.start, "depth", 1)}–{u.show(p.end, "depth", 1)} {u.label("depth")}</div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[9px] font-bold uppercase ${passed ? "text-emerald-400" : "text-amber-400"}`} data-testid={`plug-${p.id}-status`}>{passed ? "passed" : "ahead"}</span>
                      <div className="text-[11px] font-mono text-slate-300">{u.show(dist, "depth", 1)} {u.label("depth")}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#0D1526] border border-slate-800 rounded-2xl overflow-hidden flex flex-col" data-testid="view-pen-graph">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-950/80 border-b border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-400 font-bold uppercase text-[10px]">Pen traces:</span>
              {PENS.map((p) => (
                <button key={p.key} onClick={() => setActivePens((a) => ({ ...a, [p.key]: !a[p.key] }))}
                  className={`px-2 py-0.5 rounded border text-[10px] transition-opacity ${activePens[p.key] ? PEN_ON[p.cls] : "opacity-40 border-slate-800"}`} data-testid={`pen-toggle-${p.key}`}>{p.label}</button>
              ))}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">DIGITAL STRIP CHART • {sourceLabel.toUpperCase()}</span>
          </div>
          <div className="h-60 relative">
            <canvas ref={canvasPenRef} width={1200} height={240} className="w-full h-full block" data-testid="pen-graph-canvas" />
          </div>
        </div>
      )}

      {/* 4. CHANNELS */}
      <div className="bg-[#0D1526] border border-slate-800 rounded-2xl p-4 space-y-3" data-testid="channels-panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold tracking-wide text-slate-100">CHANNELS</h2>
            <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${alarms ? "bg-rose-500/10 border-rose-500/40 text-rose-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"}`} data-testid="alarm-badge">
              {alarms ? `${alarms} ALARM${alarms > 1 ? "S" : ""}` : "NO ALARMS"}
            </span>
          </div>
          <button onClick={() => setShowManageChannels(true)} className="flex items-center gap-1 px-3 py-1 bg-orange-600 hover:bg-orange-500 transition-colors text-white rounded-lg text-xs font-semibold" data-testid="add-channel-btn">
            <Plus className="w-3.5 h-3.5" /> Add channel
          </button>
        </div>
        <div className="flex gap-2 border-b border-slate-800/80 pb-2.5 text-xs font-semibold overflow-x-auto">
          {groups.map((set) => (
            <button key={set} onClick={() => setActiveJobSet(set)} className={`px-3 py-1 rounded-lg border transition-colors whitespace-nowrap ${activeJobSet === set ? "bg-orange-600 border-orange-500 text-white" : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"}`}
              data-testid={`job-set-${set.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{set}</button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {allChannels.filter((c) => c.group === activeJobSet).map((c) => {
            const raw = c.key ? telemetry[c.key] : null;
            return (
              <ChannelCard key={c.key || c.id} testId={`channel-${c.key || c.id}`} title={c.title} raw={raw}
                value={u.show(raw, c.dim, c.dim === "n2_vol" ? 0 : undefined)} unit={u.label(c.dim)} tag={c.tag} waveform={c.waveform}
                warn={c.warn} crit={c.crit} warnLabel={c.warn != null ? u.show(c.warn, c.dim) : null} critLabel={c.crit != null ? u.show(c.crit, c.dim) : null}
                sourceLabel={c.key ? sourceLabel : "no source tag"} />
            );
          })}
        </div>
      </div>

      {showCrewSetup && <CrewRatesModal crew={crewMembers} onSave={saveCrew} onClose={() => setShowCrewSetup(false)} />}
      {showManageChannels && (
        <AddChannelModal pressLabel={u.label("pressure")} toPsi={(v) => u.to(v, "pressure")} custom={customChannels}
          onAdd={addChannel} onRemove={removeChannel} onClose={() => setShowManageChannels(false)} />
      )}
    </div>
  );
}
