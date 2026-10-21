import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Layers, Box, Play, Pause, RotateCcw, Users, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { API } from "../context/AuthContext";
import { useRig } from "../context/RigContext";
import { UNIT_SYSTEMS } from "../lib/units";
import {
  SEED_TELEMETRY, CHANNELS, JOB_SETS, PLUGS, DEFAULT_CREW, DEPTH_MIN_FT, DEPTH_MAX_FT, simTick, fromDaqSample,
} from "../lib/operatorConfig";
import { stationAt, surveyTD, DLS_WARN, DLS_CRIT } from "../lib/surveyInterp";
import SurveyWellbore3D from "./operator/SurveyWellbore3D";
import { PlugTally } from "./operator/PlugTally";
import { PlugManagerModal, PLUG_TYPES } from "./operator/PlugManagerModal";
import { usePlugTestRun } from "./operator/usePlugTestRun";
import { useDepthCorrelation, useChannelLayout } from "./operator/useOperatorSync";
import { DepthCorrelationPanel } from "./operator/DepthCorrelationPanel";
import { ChannelsPanel } from "./operator/ChannelsPanel";
import { ViewerToolbar, ZoomButtons } from "./operator/ViewerToolbar";
import { useOperatorUnits } from "./operator/useOperatorUnits";
import { MetricCard } from "./operator/OperatorCards";
import { drawTrajectory, drawPens, prepCanvas, PENS } from "./operator/operatorCanvas";
import { CrewRatesModal } from "./operator/CrewRatesModal";
import { AddChannelModal } from "./operator/AddChannelModal";

const CREW_KEY = "coilaegis_crew_rates_v1";
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
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isSimRunning, setIsSimRunning] = useState(true);
  const [colorMode, setColorMode] = useState("DLS");
  const [showManageChannels, setShowManageChannels] = useState(false);
  const [showCrewSetup, setShowCrewSetup] = useState(false);
  const [crewMembers, setCrewMembers] = useState(() => loadLS(CREW_KEY, DEFAULT_CREW));
  const layout = useChannelLayout();
  const [viewCmd, setViewCmd] = useState(null);
  const [view3d, setView3d] = useState("3d");
  const [orbit, setOrbit] = useState(false);
  const sendCmd = (type) => { if (["3d", "side", "plan"].includes(type)) setView3d(type); setViewCmd({ type, n: Date.now() }); };
  const [activePens, setActivePens] = useState(() => Object.fromEntries(PENS.map((p) => [p.key, true])));
  const [telemetry, setTelemetry] = useState(SEED_TELEMETRY);
  const canvasPenRef = useRef(null);
  const canvas3DRef = useRef(null);
  const historyRef = useRef([]);
  const [surveys, setSurveys] = useState([]);
  const [surveyId, setSurveyId] = useState(null);
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    axios.get(`${API}/surveys`, { withCredentials: true })
      .then((r) => {
        const list = (r.data?.surveys || []).filter((x) => x.stations?.length > 1);
        setSurveys(list);
        const active = list.find((x) => x.survey_id === r.data?.active_survey_id) || list[0];
        if (active) setSurveyId(active.survey_id);
      })
      .catch((e) => console.debug("[Operator] survey load failed", e?.response?.status || e?.message));
  }, []);
  const survey = surveys.find((x) => x.survey_id === surveyId) || null;
  const minFt = survey ? 0 : DEPTH_MIN_FT;
  const maxFt = survey ? surveyTD(survey) : DEPTH_MAX_FT;
  const [plugRecords, setPlugRecords] = useState([]);
  const [canEditPlugs, setCanEditPlugs] = useState(false);
  const [showPlugManager, setShowPlugManager] = useState(false);
  const loadPlugs = useCallback(() => {
    if (!surveyId) { setPlugRecords([]); return; }
    axios.get(`${API}/surveys/${surveyId}/plugs`, { withCredentials: true })
      .then((r) => { setPlugRecords(r.data?.plugs || []); setCanEditPlugs(!!r.data?.can_edit); })
      .catch((e) => console.debug("[Operator] plugs load failed", e?.response?.status || e?.message));
  }, [surveyId]);
  useEffect(() => { loadPlugs(); }, [loadPlugs]);
  const corr = useDepthCorrelation(surveyId);
  const rawPlugs = useMemo(() => (survey
    ? plugRecords.map((p) => ({ id: p.plug_id, name: p.name, type: PLUG_TYPES[p.plug_type], start: p.top_md_ft, end: p.bottom_md_ft, notes: p.notes }))
    : PLUGS.map((p) => ({ ...p, name: p.id }))), [survey, plugRecords]);
  // True depth = counter + offset; "Plugs" mode shifts plugs instead of the string on screen
  const counterFt = telemetry.depth;
  const moveString = corr.moveTarget === "ct_string";
  const bitFt = moveString ? counterFt + corr.offsetFt : counterFt;
  const plugs = useMemo(() => (moveString ? rawPlugs
    : rawPlugs.map((p) => ({ ...p, start: p.start - corr.offsetFt, end: p.end - corr.offsetFt }))), [rawPlugs, moveString, corr.offsetFt]);
  const savePlug = async (plugId, body) => {
    try {
      if (plugId) await axios.put(`${API}/plugs/${plugId}`, body, { withCredentials: true });
      else await axios.post(`${API}/surveys/${surveyId}/plugs`, body, { withCredentials: true });
      toast.success(plugId ? "Plug updated" : `Plug ${body.name} added`);
      loadPlugs();
      return true;
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Could not save plug — check depths");
      return false;
    }
  };
  const deletePlug = async (plugId) => {
    try { await axios.delete(`${API}/plugs/${plugId}`, { withCredentials: true }); toast.success("Plug deleted"); loadPlugs(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not delete plug"); }
  };
  useEffect(() => {
    const onResize = () => setResizeTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const push = (next) => { historyRef.current = [...historyRef.current.slice(-99), next]; return next; };
  const startTestRun = useCallback(() => {
    setFeedMode("SIM"); setIsSimRunning(true); setPlaybackSpeed(100);
    setTelemetry((p) => ({ ...p, depth: minFt }));
    return minFt;
  }, [minFt]);
  const endTestRun = useCallback(() => setPlaybackSpeed(1), []);
  const testRun = usePlugTestRun({ depth: bitFt, plugs, maxFt: maxFt + (moveString ? corr.offsetFt : 0), surveyId: survey?.survey_id, onStart: startTestRun, onEnd: endTestRun });

  // SIM ticker (also acts as fallback when LIVE has no fresh DAQ sample)
  useEffect(() => {
    if (feedMode === "STANDBY" || !isSimRunning) return;
    if (feedMode === "LIVE" && !liveStale) return;
    const id = setInterval(() => setTelemetry((prev) => push(simTick(prev, playbackSpeed, minFt, maxFt))), 200);
    return () => clearInterval(id);
  }, [isSimRunning, feedMode, playbackSpeed, liveStale, minFt, maxFt]);

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

  const bitLabel = `BIT ${u.show(bitFt, "depth", 1)} ${u.label("depth")}`;
  const tickStepFt = useMemo(() => {
    const steps = u.isMetric ? [100, 250, 500, 1000, 2000].map((m) => m / 0.3048) : [250, 500, 1000, 2000, 5000];
    return steps.find((st) => maxFt / st <= 10) || steps[steps.length - 1];
  }, [u.isMetric, maxFt]);
  const fmtDepth = useCallback((ft) => u.show(ft, "depth", 0), [u]);
  useEffect(() => {
    if (viewStyle !== "3d-live" || survey || !canvas3DRef.current) return;
    const { ctx, w, h } = prepCanvas(canvas3DRef.current);
    drawTrajectory(ctx, w, h, { depthFt: bitFt, colorMode, plugs, bitLabel });
  }, [bitFt, viewStyle, colorMode, bitLabel, resizeTick, survey, plugs]);
  const geo = survey ? stationAt(survey.stations, bitFt) : null;
  const atBit = geo
    ? { tvd: geo.tvd_ft, inc: geo.inc_deg, dls: geo.dls_deg_per_100ft }
    : { tvd: telemetry.tvd, inc: telemetry.inclination, dls: telemetry.dls };

  useEffect(() => {
    if (viewStyle !== "pen-graph" || !canvasPenRef.current) return;
    const { ctx, w, h } = prepCanvas(canvasPenRef.current);
    drawPens(ctx, w, h, historyRef.current, activePens);
  }, [telemetry, viewStyle, activePens, resizeTick]);

  const live = feedMode === "LIVE" && !liveStale;
  const sourceLabel = feedMode === "STANDBY" ? "standby • feed held" : live ? "live DAQ" : feedMode === "LIVE" ? "DAQ stale • sim fallback" : "simulated";
  const P = (v) => u.show(v, "pressure");

  const allChannels = useMemo(() => [...CHANNELS, ...layout.custom], [layout.custom]);
  const groups = layout.custom.some((c) => c.group === "Custom") ? [...JOB_SETS, "Custom"] : JOB_SETS;
  const hiddenChannels = allChannels.filter((c) => layout.hidden.includes(c.key || c.id));

  const setDepthFromSlider = (displayVal) => {
    const ft = u.isMetric ? u.to(displayVal, "depth") : displayVal;
    setTelemetry((prev) => ({ ...prev, depth: ft }));
  };
  const saveCrew = (next) => { setCrewMembers(next); saveLS(CREW_KEY, next); setShowCrewSetup(false); toast.success("Crew rates saved"); };
  const addChannel = (ch) => { layout.addCustom(ch); toast.success(`Channel "${ch.title}" added`); };
  const restoreChannel = (id) => {
    const ch = allChannels.find((c) => (c.key || c.id) === id);
    layout.restore(id);
    if (ch && !layout.active_sets.includes(ch.group)) layout.toggleSet(ch.group);
    toast.success(`${ch?.title || "Channel"} back on screen`);
  };

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
          <button onClick={() => setIsSimRunning((r) => !r)} disabled={live} className={`flex items-center gap-1 px-3 py-1 rounded-lg border font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${live ? "bg-cyan-500/15 border-cyan-500/50 text-cyan-300" : isSimRunning ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300" : "bg-rose-500/20 border-rose-500/50 text-rose-300"}`} data-testid="sim-play-pause-btn">
            {isSimRunning && !live ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{live ? "DAQ DRIVING" : isSimRunning ? "SIM RUNNING" : "PAUSED"}</span>
          </button>
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Speed:</span>
            {[1, 5, 10, 100].map((s) => (
              <button key={s} onClick={() => setPlaybackSpeed(s)} className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${playbackSpeed === s ? "bg-orange-600 text-white" : "text-slate-400 hover:text-slate-200"}`} data-testid={`sim-speed-${s}x-btn`}>{s}x</button>
            ))}
          </div>
          <input type="range" min={Math.round(u.val(minFt, "depth"))} max={Math.round(u.val(maxFt, "depth"))} step={1}
            value={u.val(telemetry.depth, "depth")} onChange={(e) => setDepthFromSlider(parseFloat(e.target.value))}
            className="flex-1 min-w-[160px] accent-orange-500 h-1.5 cursor-pointer" data-testid="sim-depth-slider" />
          <button onClick={() => setTelemetry((p) => ({ ...p, depth: minFt }))} className="p-1 text-slate-400 hover:text-white transition-colors" title="Reset simulation depth" data-testid="sim-reset-btn">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. READOUT CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <MetricCard testId="metric-bit-depth" title="CT Bit Depth" value={u.show(counterFt + corr.offsetFt, "depth", 1)} unit={u.label("depth")} sub={`ctr ${u.show(counterFt, "depth", 1)} • off ${corr.offsetFt >= 0 ? "+" : ""}${u.show(corr.offsetFt, "depth", 1)} ${u.label("depth")}`} />
        <MetricCard testId="metric-von-mises" title="Von Mises" value={telemetry.vonMises.toFixed(1)} unit="%SMYS" sub={`${sourceLabel} • 80% alert line`} barVal={telemetry.vonMises} />
        <MetricCard testId="metric-surface-weight" title="Surface Weight" value={u.show(telemetry.weight, "weight", 0)} unit={u.label("weight")} sub={sourceLabel} />
        <MetricCard testId="metric-internal-pressure" title="Internal Pressure" value={P(telemetry.internalPress)} unit={u.label("pressure")} sub={sourceLabel} />
        <MetricCard testId="metric-wellhead-pressure" title="Wellhead Pressure" value={P(telemetry.whp)} unit={u.label("pressure")} sub={`${sourceLabel} • crit ${P(7208)}`} />
        <MetricCard testId="metric-net-dp" title="Net ΔP" value={P(telemetry.netDeltaP)} unit={u.label("pressure")} sub="internal − wellhead" />
      </div>

      {/* 3. VIEWPORT */}
      {viewStyle === "3d-live" ? (
        <div className="space-y-3" data-testid="view-3d-live">
          <div className="bg-[#0D1526] border border-slate-800 rounded-2xl p-3 md:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold tracking-wide text-slate-100 uppercase">Wellbore and plugs</h2>
            {survey && <ViewerToolbar view={view3d} orbit={orbit} onCmd={sendCmd} onOrbit={() => setOrbit((o) => !o)} />}
          </div>
          <div className={`bg-[#070C14] border border-slate-800 rounded-2xl p-3 md:p-4 relative flex flex-col gap-3 md:block ${survey ? "md:h-[30rem]" : "md:h-72"} overflow-hidden`} data-testid="trajectory-panel">
            <div className="order-2 md:absolute md:top-4 md:left-4 p-3 bg-slate-950/90 border border-slate-800 rounded-xl text-xs grid grid-cols-2 gap-1 md:block md:space-y-1 backdrop-blur z-10" data-testid="at-bit-readout">
              <div className="col-span-2 text-[10px] font-bold text-orange-400 uppercase">At bit readout</div>
              <div className="text-slate-300">MD: <span className="font-mono text-slate-100" data-testid="at-bit-md">{u.show(bitFt, "depth", 1)} {u.label("depth")}</span></div>
              <div className="text-slate-300">TVD: <span className="font-mono text-slate-100" data-testid="at-bit-tvd">{u.show(atBit.tvd, "depth", 1)} {u.label("depth")}</span></div>
              <div className="text-slate-300">Incl: <span className="font-mono text-slate-100" data-testid="at-bit-inc">{atBit.inc.toFixed(1)}°</span></div>
              <div className="text-slate-300">DLS: <span className="font-mono text-slate-100" data-testid="at-bit-dls">{u.show(atBit.dls, "dls", 2)} {u.label("dls")}</span></div>
              <div className="col-span-2 text-[10px] text-slate-500 font-mono pt-1" data-testid="trajectory-source">{survey ? `survey · ${survey.stations.length} stn · TD ${u.show(maxFt, "depth", 0)} ${u.label("depth")}` : "demo curve"}</div>
              <div className="text-slate-300">Drag: <span className="font-mono text-slate-100">{u.show(telemetry.drag, "weight", 0)} {u.label("weight")}</span></div>
            </div>
            <div className="order-1 self-end md:absolute md:top-4 md:right-4 z-10 flex flex-wrap items-center justify-end gap-2">
              {surveys.length > 0 ? (
                <select value={surveyId || ""} onChange={(e) => setSurveyId(e.target.value)} style={{ fontSize: 10 }} className="bg-slate-950/90 border border-slate-800 focus:border-cyan-500 outline-none rounded-lg px-2 py-1 font-bold leading-tight text-slate-200 max-w-[180px]" data-testid="survey-select">
                  {surveys.map((x) => <option key={x.survey_id} value={x.survey_id}>{x.well_name || x.survey_id}</option>)}
                </select>
              ) : (
                <Link to="/wellbore" className="flex items-center gap-1 px-2 py-1 rounded-lg border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 text-[10px] font-bold hover:bg-cyan-500/20 transition-colors" data-testid="upload-survey-link">
                  <Upload className="w-3 h-3" /> Upload survey
                </Link>
              )}
            <div className="flex bg-slate-950/90 p-0.5 rounded-lg border border-slate-800 text-[10px] font-bold z-10" data-testid="color-mode-toggle">
              {["DLS", "Plain"].map((m) => (
                <button key={m} onClick={() => setColorMode(m)} className={seg(colorMode === m, "bg-cyan-500 text-slate-950")} data-testid={`color-mode-${m.toLowerCase()}-btn`}>{m}</button>
              ))}
            </div>
            </div>
            <div className="order-3 md:absolute md:bottom-4 md:left-4 p-2 bg-slate-950/90 border border-slate-800 rounded-lg text-[10px] font-mono flex flex-wrap items-center gap-3 z-10">
              <span className="text-slate-400 font-bold">DLS {u.label("dls")}:</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-sm" /><span className="text-slate-300">&lt; {u.show(DLS_WARN, "dls", 1)}</span></span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 rounded-sm" /><span className="text-slate-300">{u.show(DLS_WARN, "dls", 1)}–{u.show(DLS_CRIT, "dls", 1)}</span></span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-sm" /><span className="text-slate-300">&gt; {u.show(DLS_CRIT, "dls", 1)}</span></span>
            </div>
            {survey ? (
              <div className="order-1 relative w-full h-[22rem] md:absolute md:inset-0 md:h-full" data-testid="survey-3d-view" data-plug-pins={plugs.map((p) => p.name).join(",")} data-bit-label={bitLabel} data-view={view3d} data-orbit={orbit ? "on" : "off"}>
                <SurveyWellbore3D survey={survey} depthFt={bitFt} colorMode={colorMode} plugs={plugs} bitLabel={bitLabel}
                  fmtDepth={fmtDepth} tickStepFt={tickStepFt} command={viewCmd} orbit={orbit} />
                <ZoomButtons onCmd={sendCmd} />
              </div>
            ) : (
              <canvas ref={canvas3DRef} className="order-1 w-full h-56 md:h-full block" data-testid="trajectory-canvas" />
            )}
          </div>
          </div>

          <PlugTally plugs={plugs} depth={bitFt} u={u} isDemo={!survey} canDelete={!!survey && canEditPlugs}
            onManage={() => setShowPlugManager(true)} onAdd={() => setShowPlugManager(true)} onDelete={deletePlug}
            testRun={testRun} onStartTest={() => testRun.start(100)} onStopTest={testRun.stop} />
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
            <canvas ref={canvasPenRef} className="w-full h-full block" data-testid="pen-graph-canvas" />
          </div>
        </div>
      )}

      {/* 4. DEPTH CORRELATION */}
      <DepthCorrelationPanel counterFt={counterFt} offsetFt={corr.offsetFt} moveTarget={corr.moveTarget} plugs={rawPlugs} log={corr.log}
        u={u} onOffset={corr.setOffset} onTarget={corr.setTarget} shared={!!survey} />

      {/* 5. CHANNELS */}
      <ChannelsPanel channels={allChannels} groups={groups} activeSets={layout.active_sets} hidden={layout.hidden} telemetry={telemetry}
        history={historyRef.current} u={u} sourceLabel={sourceLabel} onToggleSet={layout.toggleSet} onHide={layout.hide} onOpenAdd={() => setShowManageChannels(true)} />

      {showPlugManager && survey && (
        <PlugManagerModal plugs={plugRecords} canEdit={canEditPlugs} wellName={survey.well_name || survey.survey_id}
          depthLabel={u.label("depth")} toFt={(v) => (u.isMetric ? u.to(v, "depth") : v)} fromFt={(v) => u.val(v, "depth")}
          onSave={savePlug} onDelete={deletePlug} onClose={() => setShowPlugManager(false)} />
      )}
      {showCrewSetup && <CrewRatesModal crew={crewMembers} onSave={saveCrew} onClose={() => setShowCrewSetup(false)} />}
      {showManageChannels && (
        <AddChannelModal pressLabel={u.label("pressure")} toPsi={(v) => u.to(v, "pressure")} custom={layout.custom}
          hiddenChannels={hiddenChannels} onRestore={restoreChannel} onAdd={addChannel} onRemove={layout.removeCustom} onClose={() => setShowManageChannels(false)} />
      )}
    </div>
  );
}
