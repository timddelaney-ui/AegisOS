import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { useActiveReel } from "../context/ActiveReelContext";
import { MiniVonMises, MiniFatigue, LiveGauge, StripChart } from "../components/LiveOpsPanels";
import { Play, Pause, Wifi, WifiOff, Maximize2, X, Zap, Settings, Rewind, FastForward, StepBack, StepForward, History, Download, StickyNote, Cpu } from "lucide-react";
import { postSampleResilient, drainOfflineQueue, offlineQueueLength, startOfflineDrain } from "../lib/offlineQueue";
import { samplesToCSV, samplesToLAS, downloadBlob } from "../lib/playbackExport";
import ShareLinksButton from "../components/ShareLinksButton";
import { AnnotationPins, DropAnnotationModal, ViewAnnotationModal } from "../components/AnnotationLayer";
import { evaluateRules, resetRuleCooldowns } from "../lib/rigAnnotationRules";
import { isSupervisorOrHigher, isManagement } from "../lib/roles";

const RING = 600;             // seconds of history (10 min @ 1 Hz)
const TICK_MS = 1000;         // 1 Hz
const CHART_WINDOW = 180;     // how many samples the strip chart shows at once

// --- Jittered simulator — fakes a plausible CT job scenario ---
function nextSimSample(prev, t) {
  const base = {
    depth_ft: Math.min(10000, (prev?.depth_ft || 0) + (Math.random() > 0.3 ? 40 : -20)),
    p_internal_psi: 4500 + 2500 * Math.sin(t / 15) + (Math.random() - 0.5) * 800,
    p_external_psi: 1200 + 100 * Math.sin(t / 30),
    traction_pressure_psi: 1100 + 600 * Math.sin(t / 10 + 0.6) + (Math.random() - 0.5) * 300,
    weight_lb: 12000 + 7000 * Math.sin(t / 20 + 1.1) + (Math.random() - 0.5) * 500,
    axial_force_lbf: 8000 + 6000 * Math.sin(t / 20 + 1.1),
    pressure_psi: 4500 + 2500 * Math.sin(t / 15),
  };
  // keep depth in bounds
  base.depth_ft = Math.max(0, Math.min(10000, base.depth_ft));
  return base;
}

const PANELS = [
  { id: "vm",       label: "Von Mises" },
  { id: "fatigue",  label: "Reel Fatigue" },
  { id: "weight",   label: "Weight" },
  { id: "pressure", label: "Pressure" },
  { id: "chart",    label: "Live Chart" },
];

function buildDossierHtml(d) {
  const fmt = (v) => (v == null ? "—" : typeof v === "number" ? v.toFixed(1) : v);
  const spark = (name, s) => `<tr><td>${name}</td><td>${fmt(s.min)}</td><td>${fmt(s.max)}</td><td>${fmt(s.avg)}</td><td>${s.count}</td></tr>`;
  return `<!DOCTYPE html><html><head><title>Engineering Audit Dossier</title>
    <style>
      body{font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;padding:24px;max-width:900px;margin:auto}
      h1{font-size:20px;border-bottom:2px solid #FF6B1A;padding-bottom:6px}
      h2{font-size:14px;margin-top:20px;color:#FF6B1A;text-transform:uppercase;letter-spacing:0.5px}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
      th,td{border:1px solid #D4D4D4;padding:4px 6px;text-align:left}
      th{background:#F3F4F6}
      .pill{display:inline-block;padding:2px 6px;border-radius:3px;background:#F3F4F6;font-size:10px;font-weight:bold}
      .sig{margin-top:30px;display:flex;gap:40px}
      .sig div{flex:1;border-top:1px solid #262626;padding-top:4px;font-size:10px}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>Engineering Audit Dossier</h1>
    <p><b>Generated:</b> ${d.generated_at} · <b>By:</b> ${d.generated_by}</p>
    <p><b>Window:</b> ${d.window.start} → ${d.window.end}</p>

    <h2>Job Header</h2>
    <p><b>Crew lead:</b> ${d.job_header.crew_lead}</p>
    <p><b>Active reel:</b> ${d.job_header.active_reel?.name || "—"}
      ${d.job_header.active_reel ? `· ${d.job_header.active_reel.total_length_ft} ft · ${d.job_header.active_reel.intervals?.[0]?.grade || ""}` : ""}</p>
    <p><b>Worst fatigue node:</b> ${(d.job_header.fatigue_worst * 100).toFixed(1)}%</p>

    <h2>Pump Schedule / Treatments</h2>
    ${d.pump_schedule.length === 0 ? "<p>No treatments logged in window.</p>" :
      "<table><tr><th>Treatment</th><th>Started</th><th>Entries</th></tr>" +
      d.pump_schedule.map((t) => `<tr><td>${t.treatment || ""}</td><td>${t.started_at || ""}</td><td>${t.entries}</td></tr>`).join("") +
      "</table>"}

    <h2>Recorded Channels · ${d.sample_count} samples</h2>
    <table><tr><th>Channel</th><th>Min</th><th>Max</th><th>Avg</th><th>Count</th></tr>
      ${spark("Weight (lbf)", d.recorded_channels.weight_lb)}
      ${spark("P internal (psi)", d.recorded_channels.p_internal_psi)}
      ${spark("P external (psi)", d.recorded_channels.p_external_psi)}
      ${spark("Traction pressure (psi)", d.recorded_channels.traction_pressure_psi)}
      ${spark("Axial force (lbf)", d.recorded_channels.axial_force_lbf)}
      ${spark("Depth (ft)", d.recorded_channels.depth_ft)}
    </table>

    <h2>Von Mises Alerts · ${d.vm_alert_count} total</h2>
    ${d.vm_alerts.length === 0 ? "<p>None.</p>" :
      "<table><tr><th>Time</th><th>VM (psi)</th><th>% of 80% SMYS</th></tr>" +
      d.vm_alerts.map((a) => `<tr><td>${a.ts}</td><td>${a.vm}</td><td class="pill">${a.pct_of_safe}%</td></tr>`).join("") +
      "</table>"}

    <h2>Fatigue Delta</h2>
    <p><b>Worst damage now:</b> ${(d.fatigue_delta.worst_damage_now * 100).toFixed(1)}% · <b>Nodes:</b> ${d.fatigue_delta.node_count}</p>

    <h2>Crew Hours (${d.crew_hours.length} lines)</h2>
    ${d.crew_hours.length === 0 ? "<p>No timecard entries in window.</p>" :
      "<table><tr><th>User</th><th>Hours</th><th>Pay code</th><th>Job #</th><th>Description</th></tr>" +
      d.crew_hours.map((h) => `<tr><td>${h.user_name || ""}</td><td>${h.hours}</td><td>${h.pay_code || ""}</td><td>${h.job_number || ""}</td><td>${h.description || ""}</td></tr>`).join("") +
      "</table>"}

    <h2>Crew Signatures</h2>
    <div class="sig"><div>Crew lead</div><div>Supervisor</div><div>Management</div></div>
  </body></html>`;
}


export default function LiveOpsPage() {
  const { user } = useAuth();
  const { activeReel, currentDepth, setCurrentDepth } = useActiveReel();
  const [samples, setSamples] = useState([]);         // ring buffer of recent samples
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false); // "connected to unit" toggle (DAQ)
  const [enlarged, setEnlarged] = useState(null);     // panel id for full-screen
  const [fatigue, setFatigue] = useState({ damage: [], spacing: 100, worst_damage: 0 });
  const [layout, setLayout] = useState(["vm", "fatigue", "weight", "pressure", "chart"]);
  const [showPrefs, setShowPrefs] = useState(false);
  // Playback mode: scrub backwards through the recorded buffer.
  const [mode, setMode] = useState("live");           // 'live' | 'playback'
  const [playbackIdx, setPlaybackIdx] = useState(0);  // index into samples[]
  const [playbackPlaying, setPlaybackPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);  // 1x, 2x, 5x
  const timerRef = useRef(null);
  const feedTickRef = useRef(0);
  const playbackTimerRef = useRef(null);

  // -------- Annotations (manual + rig-computer) --------
  const canAnnotate = isSupervisorOrHigher(user);
  const canDeleteAny = isManagement(user);
  const [annotations, setAnnotations] = useState([]);
  const [rigRules, setRigRules] = useState([]);
  const [rigAutoEnabled, setRigAutoEnabled] = useState(false);  // off by default — awaits user approval before firing against live data
  const [dropOpen, setDropOpen] = useState(false);
  const [viewAnnot, setViewAnnot] = useState(null);
  const annotPollRef = useRef(null);
  const pendingIngestRef = useRef([]);  // batched rig-computer annotations

  const refreshAnnotations = async () => {
    try {
      const r = await axios.get(`${API}/liveops/annotations`, { params: { limit: 500 }, withCredentials: true });
      setAnnotations(r.data?.annotations || []);
    } catch { /* silent */ }
  };

  useEffect(() => {
    refreshAnnotations();
    axios.get(`${API}/liveops/annotations/rules`, { withCredentials: true })
      .then((r) => setRigRules(r.data?.rules || []))
      .catch(() => {});
    annotPollRef.current = setInterval(refreshAnnotations, 15000);
    return () => { if (annotPollRef.current) clearInterval(annotPollRef.current); };
  }, []);

  // Flush any rig-computer annotations we've queued up (every 5 s while feed runs).
  useEffect(() => {
    if (!rigAutoEnabled) return;
    const t = setInterval(async () => {
      const batch = pendingIngestRef.current.splice(0, pendingIngestRef.current.length);
      if (!batch.length) return;
      try {
        await axios.post(`${API}/liveops/annotations/ingest`, {
          items: batch,
          source: connected ? "wits0" : "simulated",
        }, { withCredentials: true });
        await refreshAnnotations();
      } catch (e) {
        // Re-queue on failure (bounded to 100)
        pendingIngestRef.current = [...batch, ...pendingIngestRef.current].slice(0, 100);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [rigAutoEnabled, connected]);

  useEffect(() => { startOfflineDrain(); }, []);

  const downloadDossier = async () => {
    try {
      const r = await axios.get(`${API}/dossier`, { withCredentials: true });
      const html = buildDossierHtml(r.data);
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
        setTimeout(() => w.print(), 500);
      } else {
        toast.error("Pop-up blocked — allow pop-ups to print the dossier.");
      }
      toast.success(`Dossier ready · ${r.data.sample_count} samples · ${r.data.vm_alert_count} alerts`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Dossier failed");
    }
  };

  // Load prefs (liveops layout)
  useEffect(() => {
    axios.get(`${API}/me/prefs`, { withCredentials: true })
      .then((r) => {
        if (r.data?.liveops_layout?.length) setLayout(r.data.liveops_layout.filter((id) => PANELS.find((p) => p.id === id)));
      }).catch(() => {});
  }, []);

  const savePrefs = async (nextLayout) => {
    try { await axios.patch(`${API}/me/prefs`, { liveops_layout: nextLayout }, { withCredentials: true }); }
    catch { /* non-blocking */ }
  };

  // Refresh fatigue state
  const refreshFatigue = async () => {
    if (!activeReel?.reel_id) return;
    try {
      const r = await axios.get(`${API}/fatigue/state`, { params: { reel_id: activeReel.reel_id }, withCredentials: true });
      setFatigue(r.data);
    } catch {}
  };
  useEffect(() => { refreshFatigue(); }, [activeReel?.reel_id]); // eslint-disable-line

  // Simulator / connected feed tick
  useEffect(() => {
    if (!running) { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; return; }
    timerRef.current = setInterval(async () => {
      feedTickRef.current += 1;
      const t = feedTickRef.current;
      const nowMs = Date.now();
      let evalSample = null;
      setSamples((prev) => {
        const last = prev[prev.length - 1];
        const next = { ...nextSimSample(last, t), ts: new Date(nowMs).toISOString(), source: connected ? "wits" : "simulated" };
        evalSample = next;
        const buf = [...prev, next];
        if (buf.length > RING) buf.splice(0, buf.length - RING);
        // live reel depth → update global context
        setCurrentDepth(Math.round(next.depth_ft));
        return buf;
      });
      // Rig-computer rule evaluator (Phase 2 pathway — off by default; user approves).
      if (rigAutoEnabled && evalSample && rigRules.length) {
        const fired = evaluateRules(evalSample, rigRules, nowMs);
        if (fired.length) pendingIngestRef.current.push(...fired);
      }
      // feed server-side ring buffer (resilient — queues offline if network drops)
      try {
        const last = samples[samples.length - 1];
        const sample = nextSimSample(last, t);
        await postSampleResilient({
          ...sample,
          reel_id: activeReel?.reel_id,
          source: connected ? "wits" : "simulated",
        });
      } catch { /* already handled by resilient wrapper */ }
      // Every 3 seconds, advance the fatigue engine with the latest traction pressure
      if (t % 3 === 0 && activeReel?.reel_id) {
        try {
          const last = samples[samples.length - 1];
          const sample = nextSimSample(last, t);
          const r = await axios.post(`${API}/fatigue/feed`, {
            reel_id: activeReel.reel_id,
            depth_ft: sample.depth_ft,
            traction_pressure_psi: sample.traction_pressure_psi,
            cycle_count: 1,
            source: connected ? "wits" : "simulated",
          }, { withCredentials: true });
          setFatigue(r.data);
        } catch {}
      }
    }, TICK_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };
    // eslint-disable-next-line
  }, [running, connected, activeReel?.reel_id, rigAutoEnabled, rigRules.length]);

  // Mode-aware "current sample": in playback, we read from the scrubber;
  // in live, we read the newest.
  const latest = mode === "playback"
    ? (samples[Math.min(playbackIdx, samples.length - 1)] || {})
    : (samples[samples.length - 1] || {});

  // What the strip chart shows: live = all samples; playback = window ending at scrubber.
  const chartSamples = useMemo(() => {
    if (mode !== "playback") return samples;
    const end = Math.min(playbackIdx + 1, samples.length);
    const start = Math.max(0, end - CHART_WINDOW);
    return samples.slice(start, end);
  }, [mode, samples, playbackIdx]);

  // Playback tick loop
  useEffect(() => {
    if (!playbackPlaying || mode !== "playback") {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
      return;
    }
    playbackTimerRef.current = setInterval(() => {
      setPlaybackIdx((prev) => {
        const next = prev + 1;
        if (next >= samples.length - 1) {
          setPlaybackPlaying(false);
          return samples.length - 1;
        }
        return next;
      });
    }, Math.max(100, TICK_MS / playbackSpeed));
    return () => { if (playbackTimerRef.current) clearInterval(playbackTimerRef.current); playbackTimerRef.current = null; };
  }, [playbackPlaying, playbackSpeed, mode, samples.length]);

  const loadHistory = async () => {
    try {
      const r = await axios.get(`${API}/liveops/stream`, { params: { limit: RING }, withCredentials: true });
      const srv = r.data?.samples || [];
      if (srv.length === 0) {
        toast.info("No recorded samples yet — start the feed first.");
        return;
      }
      // Normalize server samples to same shape as live buffer
      const normalized = srv.map((s) => ({
        depth_ft: s.depth_ft, p_internal_psi: s.p_internal_psi, p_external_psi: s.p_external_psi,
        traction_pressure_psi: s.traction_pressure_psi, weight_lb: s.weight_lb,
        axial_force_lbf: s.axial_force_lbf, pressure_psi: s.pressure_psi,
        ts: s.created_at, source: s.source,
      }));
      setSamples(normalized);
      setMode("playback");
      setPlaybackIdx(normalized.length - 1);
      setPlaybackPlaying(false);
      setRunning(false); // pause live feed while scrubbing
      toast.success(`Loaded ${normalized.length} samples for playback`);
    } catch (e) {
      toast.error("Failed to load history");
    }
  };

  const enterPlayback = () => {
    if (samples.length === 0) { loadHistory(); return; }
    setMode("playback");
    setPlaybackIdx(samples.length - 1);
    setPlaybackPlaying(false);
    setRunning(false);
  };

  const exitPlayback = () => {
    setMode("live");
    setPlaybackPlaying(false);
  };

  // ---- Annotation CRUD handlers ----
  const dropNoteTimestamp = () => {
    // In playback mode, drop at the scrubber position; in live, at "now".
    if (mode === "playback" && samples[playbackIdx]?.ts) {
      return Date.parse(samples[playbackIdx].ts);
    }
    return Date.now();
  };

  const submitDrop = async ({ note, severity, timestamp_ms, depth_ft }) => {
    try {
      await axios.post(`${API}/liveops/annotations`, {
        timestamp_ms, note, severity, depth_ft,
      }, { withCredentials: true });
      toast.success("Note dropped on timeline");
      await refreshAnnotations();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to drop note");
    }
  };

  const editAnnotation = async (patch) => {
    if (!viewAnnot) return;
    try {
      await axios.patch(`${API}/liveops/annotations/${viewAnnot.annot_id}`, patch, { withCredentials: true });
      toast.success("Note updated");
      await refreshAnnotations();
      setViewAnnot(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update");
    }
  };

  const deleteAnnotation = async () => {
    if (!viewAnnot) return;
    try {
      await axios.delete(`${API}/liveops/annotations/${viewAnnot.annot_id}`, { withCredentials: true });
      toast.success("Note deleted");
      await refreshAnnotations();
      setViewAnnot(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to delete");
    }
  };

  const canEditView = viewAnnot && viewAnnot.source === "manual" && (viewAnnot.author_user_id === user?.user_id || canDeleteAny);
  const canDeleteView = viewAnnot && (viewAnnot.source === "manual" ? (viewAnnot.author_user_id === user?.user_id || canDeleteAny) : canDeleteAny);

  const scrubRelativeSec = (idx) => (idx - (samples.length - 1)); // negative = seconds ago

  const renderPanel = (id, large = false) => {
    switch (id) {
      case "vm":
        return <MiniVonMises reel={activeReel} sample={latest} large={large} />;
      case "fatigue":
        return <MiniFatigue damage={fatigue.damage} spacing={fatigue.spacing_ft || fatigue.spacing || 100} worst={fatigue.worst_damage || 0} large={large} />;
      case "weight":
        return <LiveGauge title="Weight" unit="lbf" value={latest.weight_lb || 0} min={0} max={30000} warnAbove={22000} criticalAbove={27000} large={large} color="#0056B3" />;
      case "pressure":
        return <LiveGauge title="Pressure" unit="psi" value={latest.pressure_psi || latest.p_internal_psi || 0} min={0} max={10000} warnAbove={7500} criticalAbove={9000} large={large} color="#C00000" />;
      case "chart":
        return <StripChart samples={chartSamples} series={[
          { key: "weight_lb", color: "#0056B3", label: "Weight" },
          { key: "p_internal_psi", color: "#C00000", label: "P int" },
          { key: "traction_pressure_psi", color: "#C36600", label: "Traction" },
        ]} large={large} />;
      default:
        return null;
    }
  };

  const movePanel = (id, dir) => {
    const idx = layout.indexOf(id);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= layout.length) return;
    const next = [...layout];
    [next[idx], next[to]] = [next[to], next[idx]];
    setLayout(next);
    savePrefs(next);
  };

  const togglePanel = (id) => {
    const next = layout.includes(id) ? layout.filter((x) => x !== id) : [...layout, id];
    setLayout(next);
    savePrefs(next);
  };

  const subtitle = mode === "playback"
    ? `PLAYBACK · T${scrubRelativeSec(playbackIdx) >= 0 ? "+" : ""}${scrubRelativeSec(playbackIdx)}s · ${samples.length}s buffered`
    : running
      ? `${connected ? "Connected · WITS" : "Simulated"} · ${samples.length}/${RING}s · depth ${Math.round(latest.depth_ft || 0)} ft`
      : "Idle";

  return (
    <div className="min-h-screen bg-[#0D1A24]">
      <Phase1PageHeader title="Live Ops" subtitle={subtitle} />

      <div className="max-w-7xl mx-auto p-2 space-y-2">
        {/* Controls */}
        <div className="flex items-center gap-2 bg-[#111827] text-white rounded-lg p-2 flex-wrap">
          <button
            data-testid="liveops-run-btn"
            onClick={() => setRunning(!running)}
            className={`flex items-center gap-1 px-3 py-1 rounded font-bold text-xs ${running ? "bg-[#C00000]" : "bg-[#FF6B1A]"}`}>
            {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {running ? "Pause feed" : "Start feed"}
          </button>
          <button
            data-testid="liveops-connect-btn"
            onClick={() => setConnected(!connected)}
            className={`flex items-center gap-1 px-3 py-1 rounded font-bold text-xs ${connected ? "bg-[#0056B3]" : "bg-white/10 border border-white/20"}`}>
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connected ? "Connected to unit" : "Not connected"}
          </button>
          <button
            data-testid="liveops-playback-btn"
            onClick={mode === "playback" ? exitPlayback : enterPlayback}
            className={`flex items-center gap-1 px-3 py-1 rounded font-bold text-xs ${mode === "playback" ? "bg-amber-500 text-black" : "bg-white/10 border border-white/20"}`}>
            <History className="w-3.5 h-3.5" />
            {mode === "playback" ? "Exit playback" : "Playback"}
          </button>
          <button
            data-testid="liveops-dossier-btn"
            onClick={downloadDossier}
            className="flex items-center gap-1 px-3 py-1 rounded font-bold text-xs bg-white/10 border border-white/20">
            <Download className="w-3.5 h-3.5" />Dossier
          </button>
          <ShareLinksButton />
          {canAnnotate && (
            <button
              data-testid="liveops-drop-note-btn"
              onClick={() => setDropOpen(true)}
              className="flex items-center gap-1 px-3 py-1 rounded font-bold text-xs bg-amber-500 text-black hover:bg-amber-400">
              <StickyNote className="w-3.5 h-3.5" />Drop note
            </button>
          )}
          {canAnnotate && (
            <button
              data-testid="liveops-rig-auto-btn"
              onClick={() => { resetRuleCooldowns(); setRigAutoEnabled((v) => !v); }}
              title="Let the rig computer drop annotations automatically when threshold rules fire"
              className={`flex items-center gap-1 px-3 py-1 rounded font-bold text-xs ${rigAutoEnabled ? "bg-[#0056B3] text-white" : "bg-white/10 border border-white/20"}`}>
              <Cpu className="w-3.5 h-3.5" />
              Rig auto {rigAutoEnabled ? "ON" : "OFF"}
            </button>
          )}
          <button
            data-testid="liveops-customize-btn"
            onClick={() => setShowPrefs(!showPrefs)}
            className="flex items-center gap-1 px-3 py-1 rounded font-bold text-xs bg-white/10 border border-white/20">
            <Settings className="w-3.5 h-3.5" />Customize
          </button>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-white/70">
            {activeReel ? (
              <>
                <span>Reel: <b className="text-white">{activeReel.name}</b></span>
                <span>Depth: <b className="text-white tabular-nums">{Math.round(currentDepth)} ft</b></span>
                <span>Grade: <b className="text-white">{activeReel.intervals?.[0]?.grade || "—"}</b></span>
              </>
            ) : <span className="text-amber-300">No active reel · set one in Reels</span>}
          </div>
        </div>

        {/* Playback scrubber */}
        {mode === "playback" && (
          <div data-testid="liveops-scrubber" className="bg-amber-500/15 border border-amber-500/40 text-white rounded-lg p-2 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Playback</span>
            <button
              data-testid="playback-step-back"
              onClick={() => setPlaybackIdx((i) => Math.max(0, i - 1))}
              className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center"
              aria-label="step back">
              <StepBack className="w-3.5 h-3.5" />
            </button>
            <button
              data-testid="playback-play"
              onClick={() => setPlaybackPlaying(!playbackPlaying)}
              className={`w-8 h-8 rounded flex items-center justify-center font-bold ${playbackPlaying ? "bg-amber-500 text-black" : "bg-white/10"}`}
              aria-label="play">
              {playbackPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              data-testid="playback-step-forward"
              onClick={() => setPlaybackIdx((i) => Math.min(samples.length - 1, i + 1))}
              className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center"
              aria-label="step forward">
              <StepForward className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1">
              {[1, 2, 5].map((s) => (
                <button
                  key={s}
                  data-testid={`playback-speed-${s}x`}
                  onClick={() => setPlaybackSpeed(s)}
                  className={`text-[10px] font-bold px-2 py-1 rounded ${playbackSpeed === s ? "bg-amber-500 text-black" : "bg-white/10"}`}>
                  {s}×
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[160px]">
              <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ zIndex: 5 }}>
                <AnnotationPins
                  annotations={annotations}
                  samples={samples}
                  onPinClick={(p) => setViewAnnot(p)}
                />
              </div>
              <input
                data-testid="playback-scrubber"
                type="range"
                min={0}
                max={Math.max(0, samples.length - 1)}
                value={playbackIdx}
                onChange={(e) => { setPlaybackIdx(Number(e.target.value)); setPlaybackPlaying(false); }}
                className="w-full h-1.5 accent-amber-400"
              />
            </div>
            <span className="text-[11px] tabular-nums text-amber-200 font-bold">
              T{scrubRelativeSec(playbackIdx) >= 0 ? "+" : ""}{scrubRelativeSec(playbackIdx)}s
            </span>
            <span className="text-[10px] text-white/60">
              {playbackIdx + 1} / {samples.length}
            </span>
            <button
              data-testid="playback-jump-latest"
              onClick={() => { setPlaybackIdx(samples.length - 1); setPlaybackPlaying(false); }}
              className="text-[10px] font-bold text-amber-300 hover:text-white px-2 py-1 rounded border border-amber-500/50">
              Jump to latest
            </button>
            <button
              data-testid="playback-reload"
              onClick={loadHistory}
              className="text-[10px] font-bold text-white/80 hover:text-white px-2 py-1 rounded border border-white/20">
              Reload history
            </button>
            <button
              data-testid="playback-export-csv"
              onClick={() => {
                const win = chartSamples.length ? chartSamples : samples;
                if (win.length === 0) return toast.error("No samples in window");
                downloadBlob(`liveops_playback_${Date.now()}.csv`, samplesToCSV(win, annotations), "text/csv");
                const inWin = annotations.filter((a) => {
                  const lo = Date.parse(win[0]?.ts || 0), hi = Date.parse(win[win.length-1]?.ts || 0);
                  return a.timestamp_ms >= Math.min(lo,hi) && a.timestamp_ms <= Math.max(lo,hi);
                }).length;
                toast.success(`Exported ${win.length} samples · ${inWin} notes as CSV`);
              }}
              className="text-[10px] font-bold text-amber-300 hover:text-white px-2 py-1 rounded border border-amber-500/50">
              CSV
            </button>
            <button
              data-testid="playback-export-las"
              onClick={() => {
                const win = chartSamples.length ? chartSamples : samples;
                if (win.length === 0) return toast.error("No samples in window");
                downloadBlob(`liveops_playback_${Date.now()}.las`, samplesToLAS(win, {
                  reel_name: activeReel?.name,
                  generated_by: user?.email,
                  well: "Live Ops Playback",
                }, annotations), "text/plain");
                const inWin = annotations.filter((a) => {
                  const lo = Date.parse(win[0]?.ts || 0), hi = Date.parse(win[win.length-1]?.ts || 0);
                  return a.timestamp_ms >= Math.min(lo,hi) && a.timestamp_ms <= Math.max(lo,hi);
                }).length;
                toast.success(`Exported ${win.length} samples · ${inWin} notes as LAS 2.0`);
              }}
              className="text-[10px] font-bold text-amber-300 hover:text-white px-2 py-1 rounded border border-amber-500/50">
              LAS
            </button>
          </div>
        )}

        {showPrefs && (
          <div data-testid="liveops-customize-panel" className="bg-[#111827] text-white rounded-lg p-2 text-xs">
            <p className="font-bold uppercase text-[10px] text-white/60 mb-1">Panels — toggle & reorder</p>
            <div className="flex flex-wrap gap-2">
              {PANELS.map((p) => {
                const on = layout.includes(p.id);
                return (
                  <div key={p.id} className={`flex items-center gap-1 rounded px-2 py-1 ${on ? "bg-[#FF6B1A]/30 border border-[#FF6B1A]/50" : "bg-white/5 border border-white/10"}`}>
                    <input data-testid={`toggle-${p.id}`} type="checkbox" checked={on} onChange={() => togglePanel(p.id)} />
                    <span className="font-bold">{p.label}</span>
                    {on && (
                      <>
                        <button data-testid={`up-${p.id}`} onClick={() => movePanel(p.id, -1)} className="text-white/70 hover:text-white font-bold">↑</button>
                        <button data-testid={`down-${p.id}`} onClick={() => movePanel(p.id, 1)} className="text-white/70 hover:text-white font-bold">↓</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Grid */}
        <div className={`grid gap-2 ${layout.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : layout.length <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
          {layout.map((id) => (
            <div
              key={id}
              data-testid={`panel-${id}`}
              onClick={() => setEnlarged(id)}
              className="group relative cursor-pointer bg-[#111827] rounded-lg overflow-hidden hover:ring-2 hover:ring-amber-300 transition-all h-[260px]">
              <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded p-1">
                <Maximize2 className="w-3.5 h-3.5 text-white" />
              </div>
              {renderPanel(id, false)}
            </div>
          ))}
          {layout.length === 0 && (
            <div className="col-span-full text-center py-16 text-white/60 text-sm">
              No panels enabled. Open <b>Customize</b> to turn panels on.
            </div>
          )}
        </div>

        {!running && samples.length === 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-lg p-3 flex items-center gap-2 text-xs">
            <Zap className="w-4 h-4" />
            Click <b>Start feed</b> to animate the dashboard. In Phase 1 the feed is a jittered simulator; in Phase 2, flip <b>Connected to unit</b> to pull WITS 0 / Modbus TCP from the live CT unit.
          </div>
        )}
      </div>

      {/* Full-screen enlarge modal */}
      {enlarged && (
        <div
          data-testid="liveops-fullscreen"
          onClick={() => setEnlarged(null)}
          className="fixed inset-0 bg-black/85 z-50 p-3 sm:p-6 flex flex-col"
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-white text-sm sm:text-base font-bold uppercase tracking-wider">
              {PANELS.find((p) => p.id === enlarged)?.label}
            </h2>
            <button data-testid="liveops-close-fullscreen" onClick={() => setEnlarged(null)} className="bg-white/10 hover:bg-white/20 rounded p-1.5 text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div onClick={(e) => e.stopPropagation()} className="flex-1 min-h-0">
            {renderPanel(enlarged, true)}
          </div>
        </div>
      )}

      {/* Annotation drop modal */}
      <DropAnnotationModal
        open={dropOpen}
        onClose={() => setDropOpen(false)}
        onSubmit={submitDrop}
        timestampMs={dropNoteTimestamp()}
        snapshot={latest}
      />

      {/* Annotation view / edit modal */}
      {viewAnnot && (
        <ViewAnnotationModal
          annotation={viewAnnot}
          canEdit={canEditView}
          canDelete={canDeleteView}
          onClose={() => setViewAnnot(null)}
          onEdit={editAnnotation}
          onDelete={deleteAnnotation}
        />
      )}
    </div>
  );
}
