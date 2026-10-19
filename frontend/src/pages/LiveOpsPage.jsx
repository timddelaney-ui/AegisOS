import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { useActiveReel } from "../context/ActiveReelContext";
import { MiniVonMises, MiniFatigue, LiveGauge, StripChart, RollingTrends, MiniWellbore } from "../components/LiveOpsPanels";
import { Play, Pause, Wifi, WifiOff, Maximize2, X, Zap, Settings, Rewind, FastForward, StepBack, StepForward, History, Download, StickyNote, Clock, Star } from "lucide-react";
import { postSampleResilient, drainOfflineQueue, offlineQueueLength, startOfflineDrain } from "../lib/offlineQueue";
import { samplesToCSV, samplesToLAS, downloadBlob } from "../lib/playbackExport";
import { triaxialVonMises, intervalAt } from "../lib/ctPhysics";
import ShareLinksButton from "../components/ShareLinksButton";
import JobLogPlayback from "../components/JobLogPlayback";
import { AnnotationPins, DropAnnotationModal, ViewAnnotationModal } from "../components/AnnotationLayer";
import { isSupervisorOrHigher, isManagement } from "../lib/roles";
import { useRig } from "../context/RigContext";
import { useUnits } from "../context/UnitContext";

const RING = 3600;            // seconds of history (1 hr @ 1 Hz) — scrub back to the sticky-pipe tick
const TICK_MS = 1000;         // 1 Hz
const CHART_WINDOW = 300;     // how many samples the strip chart shows at once (5 min window)

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
  { id: "pressure", label: "P Internal" },
  { id: "whp",      label: "Wellhead · P_whp" },
  { id: "dpnet",    label: "Net ΔP" },
  { id: "skate",    label: "Injector Skate · K_t" },
  { id: "wellbore", label: "Mini Wellbore · DLS/Drag" },
  { id: "chart",    label: "Rolling Trends · 5-pen" },
];

// Skate penalty + stress-concentration from hydraulic clamping pressure.
// K_t = 1 + α · ((p_skate - p_ref) / p_ref)^β, clipped to [1.0, 1.5]
// [API RP 5C7 §8 / Tipton 1994 · open-domain injector-ovality scaler].
const skateMetrics = (p_skate, p_ref = 1200) => {
  const ratio = Math.max(0, (p_skate - p_ref) / p_ref);
  const kt = Math.min(1.5, 1 + 0.35 * Math.pow(ratio, 1.1));
  return {
    kt,
    penalty: kt,  // damage-rate multiplier
    label: kt < 1.05 ? "NORMAL" : kt < 1.2 ? "ELEVATED" : "EXCESSIVE",
    severity: kt < 1.05 ? "ok" : kt < 1.2 ? "warn" : "crit",
  };
};

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
  const u = useUnits();
  const [samples, setSamples] = useState([]);         // ring buffer of recent samples
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false); // "connected to unit" toggle (DAQ)
  const [enlarged, setEnlarged] = useState(null);     // panel id for full-screen
  const [fatigue, setFatigue] = useState({ damage: [], spacing: 100, worst_damage: 0 });
  const [layout, setLayout] = useState(["vm", "fatigue", "weight", "pressure", "whp", "dpnet", "skate", "wellbore", "chart"]);
  const [showPrefs, setShowPrefs] = useState(false);
  // Mini-wellbore state
  const [miniSurvey, setMiniSurvey] = useState(null);
  const [wbColorMode, setWbColorMode] = useState(() => {
    try { return localStorage.getItem("coilaegis_wellbore_colormode") || "dls"; } catch { return "dls"; }
  });
  const cycleWbMode = () => {
    const order = ["dls", "drag", "combined"];
    const next = order[(order.indexOf(wbColorMode) + 1) % order.length];
    setWbColorMode(next);
    try { localStorage.setItem("coilaegis_wellbore_colormode", next); } catch (e) { console.debug("[LiveOps] wb mode persist failed", e?.message); }
  };

  // ── Job-log replay state ──
  // When a CSV / LAS / WITS file is loaded, `replaySample` becomes the
  // dashboard's `latest` sample override and `replaySamples` becomes the
  // samples that drive the strip chart. Playback transport lives inside
  // the floating JobLogPlayback bar.
  const [replaySample, setReplaySample] = useState(null);
  const [replaySamples, setReplaySamples] = useState([]);
  const [replayCursor, setReplayCursor] = useState(0);
  // Playback mode: scrub backwards through the recorded buffer.
  const [mode, setMode] = useState("live");           // 'live' | 'playback'
  const [playbackIdx, setPlaybackIdx] = useState(0);  // index into samples[]
  const [playbackPlaying, setPlaybackPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);  // 1x, 2x, 5x
  const timerRef = useRef(null);
  const feedTickRef = useRef(0);
  const playbackTimerRef = useRef(null);

  // -------- Annotations (manual only — supervisor+) --------
  const canAnnotate = isSupervisorOrHigher(user);
  const canDeleteAny = isManagement(user);
  const [annotations, setAnnotations] = useState([]);
  const [dropOpen, setDropOpen] = useState(false);
  const [viewAnnot, setViewAnnot] = useState(null);
  const annotPollRef = useRef(null);

  // -------- Treatment events (significant events + NPT pins) --------
  const { rigId } = useRig();
  const navigate = useNavigate();
  const [tEvents, setTEvents] = useState([]);  // merged treatment "event" + "npt" entries for pinning
  const tEventsPollRef = useRef(null);

  const refreshAnnotations = async () => {
    try {
      const r = await axios.get(`${API}/liveops/annotations`, { params: { limit: 500 }, withCredentials: true });
      setAnnotations(r.data?.annotations || []);
    } catch (e) { console.debug("[LiveOps] refreshAnnotations failed", e?.response?.status || e?.message); }
  };

  const refreshTreatmentEvents = async () => {
    try {
      const r = await axios.get(`${API}/treatments/events-timeline`, { params: { rig_id: rigId, limit: 500 }, withCredentials: true });
      setTEvents(r.data?.events || []);
    } catch (e) { console.debug("[LiveOps] refreshTreatmentEvents failed", e?.response?.status || e?.message); }
  };

  useEffect(() => {
    refreshAnnotations();
    refreshTreatmentEvents();
    annotPollRef.current = setInterval(refreshAnnotations, 15000);
    tEventsPollRef.current = setInterval(refreshTreatmentEvents, 10000);
    return () => {
      if (annotPollRef.current) clearInterval(annotPollRef.current);
      if (tEventsPollRef.current) clearInterval(tEventsPollRef.current);
    };
    // eslint-disable-next-line
  }, [rigId]);

  useEffect(() => { startOfflineDrain(); }, []);

  // Load active directional survey for the Mini Wellbore panel
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/surveys`, { withCredentials: true })
      .then((r) => {
        if (!alive) return;
        const list = r.data?.surveys || [];
        const activeId = r.data?.active_survey_id;
        const survey = list.find((s) => s.survey_id === activeId) || list[0] || null;
        setMiniSurvey(survey);
      })
      .catch((e) => console.debug("[LiveOps] mini-wellbore survey load failed", e?.response?.status || e?.message));
    return () => { alive = false; };
  }, []);

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

  // Load prefs (liveops layout) — merge any new panel ids from PANELS so
  // we don't drop newly-added gauges (skate / whp / dpnet) for users with
  // saved layouts from earlier builds.
  useEffect(() => {
    axios.get(`${API}/me/prefs`, { withCredentials: true })
      .then((r) => {
        const saved = r.data?.liveops_layout;
        if (saved?.length) {
          const kept = saved.filter((id) => PANELS.find((p) => p.id === id));
          const missing = PANELS.map((p) => p.id).filter((id) => !kept.includes(id));
          setLayout([...kept, ...missing]);
        }
      }).catch(() => {});
  }, []);

  const savePrefs = async (nextLayout) => {
    try { await axios.patch(`${API}/me/prefs`, { liveops_layout: nextLayout }, { withCredentials: true }); }
    catch (e) { console.debug("[LiveOps] savePrefs non-blocking failure", e?.response?.status || e?.message); }
  };

  // Refresh fatigue state
  const refreshFatigue = async () => {
    if (!activeReel?.reel_id) return;
    try {
      const r = await axios.get(`${API}/fatigue/state`, { params: { reel_id: activeReel.reel_id }, withCredentials: true });
      setFatigue(r.data);
    } catch (e) { console.debug("[LiveOps] refreshFatigue failed", e?.response?.status || e?.message); }
  };
  useEffect(() => { refreshFatigue(); }, [activeReel?.reel_id]); // eslint-disable-line

  // Simulator / connected feed tick. When `connected` is ON, we poll the server
  // for the newest sample (populated by a real WITS 0 / Modbus / WITSML listener)
  // instead of running the local simulator. Falls back to the simulator if the
  // server has no fresh sample within the last 5 seconds.
  useEffect(() => {
    if (!running) { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; return; }
    timerRef.current = setInterval(async () => {
      feedTickRef.current += 1;
      const t = feedTickRef.current;
      const nowMs = Date.now();
      let realSample = null;
      if (connected) {
        try {
          const r = await axios.get(`${API}/liveops/stream`, { params: { limit: 1, rig_id: rigId }, withCredentials: true });
          const srv = r.data?.samples?.[0];
          if (srv) {
            const srvTs = Date.parse(srv.created_at || 0);
            if (nowMs - srvTs < 5000) {
              realSample = {
                depth_ft: srv.depth_ft, p_internal_psi: srv.p_internal_psi, p_external_psi: srv.p_external_psi,
                traction_pressure_psi: srv.traction_pressure_psi, weight_lb: srv.weight_lb,
                axial_force_lbf: srv.axial_force_lbf, pressure_psi: srv.pressure_psi,
                vm_utilization: srv.vm_utilization, fatigue_worst: srv.fatigue_worst,
                ts: srv.created_at, source: srv.source || "wits",
              };
            }
          }
        } catch (e) { console.debug("[LiveOps] live stream fetch failed, falling through to simulator", e?.response?.status || e?.message); }
      }
      setSamples((prev) => {
        const last = prev[prev.length - 1];
        const raw = realSample || { ...nextSimSample(last, t), ts: new Date(nowMs).toISOString(), source: connected ? "wits_fallback_sim" : "simulated" };
        // Compute Von Mises utilization snapshot for this tick (persists even
        // when the user hasn't opened the Von Mises page). Uses active reel's
        // interval at current depth, falls back to a default 2" QT-900.
        const seg = intervalAt(activeReel, raw.depth_ft || 0) || { od_in: 2.0, wt_in: 0.175, smys_psi: 90000 };
        const vm = triaxialVonMises({
          OD: seg.od_in, WT: seg.wt_in,
          p_i: raw.p_internal_psi || 0,
          p_o: raw.p_external_psi || 0,
          F_axial: raw.axial_force_lbf || 0,
          smys: seg.smys_psi,
        });
        const next = {
          ...raw,
          vm_utilization: raw.vm_utilization != null ? raw.vm_utilization : (vm?.utilization || 0),
          fatigue_worst: raw.fatigue_worst != null ? raw.fatigue_worst : (fatigue.worst_damage || 0),
        };
        const buf = [...prev, next];
        if (buf.length > RING) buf.splice(0, buf.length - RING);
        setCurrentDepth(Math.round(next.depth_ft || 0));
        return buf;
      });
      // Only post simulator samples to the ring buffer — real DAQ already stored by the server listener.
      if (!realSample) {
        try {
          const last = samples[samples.length - 1];
          const sample = nextSimSample(last, t);
          const seg = intervalAt(activeReel, sample.depth_ft || 0) || { od_in: 2.0, wt_in: 0.175, smys_psi: 90000 };
          const vm = triaxialVonMises({
            OD: seg.od_in, WT: seg.wt_in,
            p_i: sample.p_internal_psi || 0, p_o: sample.p_external_psi || 0,
            F_axial: sample.axial_force_lbf || 0, smys: seg.smys_psi,
          });
          await postSampleResilient({
            ...sample,
            rig_id: rigId,
            reel_id: activeReel?.reel_id,
            vm_utilization: vm?.utilization || 0,
            fatigue_worst: fatigue.worst_damage || 0,
            source: "simulated",
          });
        } catch (e) { console.debug("[LiveOps] postSampleResilient inner failure", e?.message); }
      }
      // Every 3 seconds, advance the fatigue engine with the latest traction pressure
      if (t % 3 === 0 && activeReel?.reel_id) {
        try {
          const src = realSample || nextSimSample(samples[samples.length - 1], t);
          const r = await axios.post(`${API}/fatigue/feed`, {
            reel_id: activeReel.reel_id,
            depth_ft: src.depth_ft,
            traction_pressure_psi: src.traction_pressure_psi,
            cycle_count: 1,
            source: realSample ? (realSample.source || "wits") : "simulated",
          }, { withCredentials: true });
          setFatigue(r.data);
        } catch (e) { console.debug("[LiveOps] fatigue feed failed", e?.response?.status || e?.message); }
      }
    }, TICK_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };
    // eslint-disable-next-line
  }, [running, connected, activeReel?.reel_id]);

  // Mode-aware "current sample": in replay (job-log playback), that
  // sample fully overrides; otherwise playback = scrubbed sample; live =
  // newest sample from the ring.
  const latest = replaySample
    ? replaySample
    : mode === "playback"
      ? (samples[Math.min(playbackIdx, samples.length - 1)] || {})
      : (samples[samples.length - 1] || {});

  // What the strip chart shows: replay = all replay samples up to cursor;
  // live = all live samples; playback = window ending at scrubber.
  const chartSamples = useMemo(() => {
    if (replaySamples.length > 0) {
      const end = Math.min(replayCursor + 1, replaySamples.length);
      const start = Math.max(0, end - CHART_WINDOW);
      return replaySamples.slice(start, end);
    }
    if (mode !== "playback") return samples;
    const end = Math.min(playbackIdx + 1, samples.length);
    const start = Math.max(0, end - CHART_WINDOW);
    return samples.slice(start, end);
  }, [mode, samples, playbackIdx, replaySamples, replayCursor]);

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
      const r = await axios.get(`${API}/liveops/stream`, { params: { limit: RING, rig_id: rigId }, withCredentials: true });
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

  const submitDrop = async ({ note, severity, timestamp_ms, depth_ft, operation_code, telemetry_snapshot, kind, npt_category }) => {
    try {
      // 1) Timeline annotation — always
      await axios.post(`${API}/liveops/annotations`, {
        timestamp_ms, note, severity, depth_ft,
      }, { withCredentials: true });

      // 2) Treatment-log entry — only when an operation code is picked AND
      //    there's an active treatment on this rig. The treatment entry
      //    stores the full telemetry snapshot so it's auditable later.
      let treatmentLogged = false;
      if (operation_code) {
        try {
          const r = await axios.get(`${API}/treatments/active`, {
            params: { rig_id: rigId }, withCredentials: true,
          });
          const trt = r.data?.treatment;
          if (trt?.treatment_id) {
            await axios.post(`${API}/treatments/${trt.treatment_id}/entries`, {
              text: note,
              operation_code,
              telemetry_snapshot,
              kind: kind || "event",
              npt_category: npt_category || null,
              event_at: new Date(timestamp_ms).toISOString(),
            }, { withCredentials: true });
            treatmentLogged = true;
          }
        } catch (e) {
          console.debug("[LiveOps] dual-write treatment entry failed", e?.response?.status || e?.message);
        }
      }

      toast.success(treatmentLogged
        ? `#${operation_code} logged to treatment + timeline`
        : operation_code
          ? "Note dropped on timeline (start a treatment to also log it)"
          : "Note dropped on timeline"
      );
      await refreshAnnotations();
      if (treatmentLogged) await refreshTreatmentEvents();
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

  // Snap the scrubber to the sample nearest a given epoch-ms timestamp.
  // If currently live, auto-enter playback. Loads server history first if
  // the ring buffer is empty.
  const jumpToAnnotation = async (annot) => {
    if (!annot?.timestamp_ms) { setViewAnnot(annot); return; }
    let buf = samples;
    if (buf.length === 0) {
      // Fetch history then re-run the jump against the fresh buffer.
      try {
        const r = await axios.get(`${API}/liveops/stream`, { params: { limit: RING, rig_id: rigId }, withCredentials: true });
        const srv = r.data?.samples || [];
        if (srv.length === 0) { toast.info("No samples recorded for playback yet."); setViewAnnot(annot); return; }
        buf = srv.map((s) => ({
          depth_ft: s.depth_ft, p_internal_psi: s.p_internal_psi, p_external_psi: s.p_external_psi,
          traction_pressure_psi: s.traction_pressure_psi, weight_lb: s.weight_lb,
          axial_force_lbf: s.axial_force_lbf, pressure_psi: s.pressure_psi,
          ts: s.created_at, source: s.source,
        }));
        setSamples(buf);
      } catch { toast.error("Couldn't load history"); setViewAnnot(annot); return; }
    }
    if (buf.length === 0) { setViewAnnot(annot); return; }
    // Find the nearest sample to the annotation's timestamp
    let best = 0, bestDelta = Infinity;
    for (let i = 0; i < buf.length; i++) {
      const t = Date.parse(buf[i].ts || buf[i].created_at || 0);
      const d = Math.abs(t - annot.timestamp_ms);
      if (d < bestDelta) { bestDelta = d; best = i; }
    }
    setMode("playback");
    setPlaybackIdx(best);
    setPlaybackPlaying(false);
    setRunning(false);
    setViewAnnot(annot);
    const label = annot.kind === "event" ? "event"
                : annot.kind === "npt" ? "NPT"
                : "note";
    toast.success(`Jumped to ${label} at ${new Date(annot.timestamp_ms).toLocaleTimeString()}`);
  };

  const scrubRelativeSec = (idx) => (idx - (samples.length - 1)); // negative = seconds ago

  const renderPanel = (id, large = false) => {
    switch (id) {
      case "vm":
        return <MiniVonMises reel={activeReel} sample={latest} large={large} />;
      case "fatigue":
        return <MiniFatigue damage={fatigue.damage} spacing={fatigue.spacing_ft || fatigue.spacing || 100} worst={fatigue.worst_damage || 0} large={large} />;
      case "weight":
        return <LiveGauge title="Weight" unit={u.label("weight")}
          value={u.from(latest.weight_lb || 0, "weight")}
          min={0}
          max={u.from(30000, "weight")}
          warnAbove={u.from(22000, "weight")}
          criticalAbove={u.from(27000, "weight")}
          large={large} color="#06B6D4" />;
      case "pressure":
        return <LiveGauge title="P Internal" unit={u.label("pressure")}
          value={u.from(latest.pressure_psi || latest.p_internal_psi || 0, "pressure")}
          min={0}
          max={u.from(10000, "pressure")}
          warnAbove={u.from(7500, "pressure")}
          criticalAbove={u.from(9000, "pressure")}
          large={large} color="#EF4444" />;
      case "whp":
        return <LiveGauge title="Wellhead · P_whp [API RP 5C7]" unit={u.label("pressure")}
          value={u.from(latest.p_external_psi || 0, "pressure")}
          min={0}
          max={u.from(8000, "pressure")}
          warnAbove={u.from(5500, "pressure")}
          criticalAbove={u.from(7000, "pressure")}
          large={large} color="#06B6D4" />;
      case "dpnet": {
        const dp = (latest.p_internal_psi || 0) - (latest.p_external_psi || 0);
        return <LiveGauge title="Net ΔP [ISO 13628-7]" unit={u.label("pressure")}
          value={u.from(dp, "pressure")}
          min={u.from(-2000, "pressure")}
          max={u.from(10000, "pressure")}
          warnAbove={u.from(7500, "pressure")}
          criticalAbove={u.from(9000, "pressure")}
          large={large} color="#F59E0B" />;
      }
      case "skate": {
        const ps = latest.traction_pressure_psi || 0;
        const sm = skateMetrics(ps);
        return <LiveGauge
          title={`Skate · K_t ${sm.kt.toFixed(2)} · ${sm.label}`}
          unit={u.label("pressure")}
          value={u.from(ps, "pressure")}
          min={0}
          max={u.from(2500, "pressure")}
          warnAbove={u.from(1500, "pressure")}
          criticalAbove={u.from(2000, "pressure")}
          large={large}
          color={sm.severity === "crit" ? "#EF4444" : sm.severity === "warn" ? "#F59E0B" : "#10B981"} />;
      }
      case "wellbore":
        return <MiniWellbore
          survey={miniSurvey}
          depth={latest.depth_ft || currentDepth || 0}
          colorMode={wbColorMode}
          onCycleMode={cycleWbMode}
          large={large} />;
      case "chart": {
        // Project each sample into display-unit space so pens respect Imp/SI
        const projected = chartSamples.map((s) => ({
          ...s,
          _depth:    u.from(s.depth_ft || 0, "depth"),
          _weight:   u.from(s.weight_lb || 0, "weight"),
          _pint:     u.from(s.p_internal_psi || s.pressure_psi || 0, "pressure"),
          _skate:    u.from(s.traction_pressure_psi || 0, "pressure"),
          _vm_pct:   (s.vm_utilization || 0) * 100 * 0.8,  // % of SMYS (0..100)
          _fat_pct:  (s.fatigue_worst || 0) * 100,         // worst-node damage %
        }));
        const series = [
          { key: "_depth",   color: "#06B6D4", label: `Depth · ${u.label("depth")}`,     suffix: u.label("depth"),  format: (v) => v.toFixed(0) },
          { key: "_weight",  color: "#FF6B1A", label: `Weight · ${u.label("weight")}`,   suffix: u.label("weight"), format: (v) => v.toFixed(u.isMetric ? 1 : 0) },
          { key: "_pint",    color: "#EF4444", label: `P int · ${u.label("pressure")}`,  suffix: u.label("pressure"), format: (v) => v.toFixed(0) },
          { key: "_skate",   color: "#F59E0B", label: `Skate · ${u.label("pressure")}`,  suffix: u.label("pressure"), format: (v) => v.toFixed(0) },
          { key: "_vm_pct",  color: "#A78BFA", label: "VM % of 80% SMYS",                suffix: "%",             format: (v) => v.toFixed(1) },
          { key: "_fat_pct", color: "#10B981", label: "Fatigue · worst node",            suffix: "%",             format: (v) => v.toFixed(2) },
        ];
        // Compute cursor index relative to chart window
        const start = Math.max(0, Math.min(samples.length, samples.length - projected.length));
        const cursorInWindow = mode === "playback" ? Math.max(0, playbackIdx - start) : null;
        const onCursorClick = (idx) => {
          const absolute = start + idx;
          setMode("playback");
          setPlaybackIdx(absolute);
          setPlaybackPlaying(false);
          setRunning(false);
        };
        return <RollingTrends
          samples={projected}
          series={series}
          cursorIndex={cursorInWindow}
          onCursor={onCursorClick}
          large={large}
          title={`Rolling Trends · 1 Hz · ${u.isMetric ? "SI" : "Imperial"}`}
        />;
      }
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

  // If a real DAQ listener is writing samples, show its source in the subtitle
  const liveSource = useMemo(() => {
    const srcCounts = {};
    for (const s of samples.slice(-30)) srcCounts[s.source || "simulated"] = (srcCounts[s.source || "simulated"] || 0) + 1;
    const real = ["wits0", "wits", "modbus", "witsml"].find((k) => srcCounts[k]);
    return real || "simulated";
  }, [samples]);

  const subtitle = mode === "playback"
    ? `PLAYBACK · T${scrubRelativeSec(playbackIdx) >= 0 ? "+" : ""}${scrubRelativeSec(playbackIdx)}s · ${samples.length}s buffered`
    : running
      ? `${liveSource === "simulated" ? "Simulated" : `LIVE · ${liveSource.toUpperCase()}`} · ${samples.length}/${RING}s · depth ${u.fmt(latest.depth_ft || 0, "depth", { digits: 0 })}`
      : "Idle";

  return (
    <div className="min-h-screen ca-console-shell relative">
      <Phase1PageHeader title="Live Ops" subtitle={subtitle} />

      <div className="relative z-10 max-w-7xl mx-auto p-3 space-y-3">
        {/* Operations status strip */}
        <div className="ca-glass px-3 py-2 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className={`ca-dot ${running ? (connected ? "ca-dot-telem" : "ca-dot-live") : "ca-dot-standby"}`} />
            <div className="flex flex-col">
              <span className="ca-eyebrow ca-eyebrow-orange">Live Ops Console</span>
              <span className="ca-telemetry text-[11px] text-slate-300">{subtitle}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="ca-chip ca-chip-cyan">{liveSource === "simulated" ? "SIM" : liveSource.toUpperCase()}</span>
            <span className="ca-chip">{replaySamples.length > 0 ? "REPLAY" : mode === "playback" ? "PLAYBACK" : running ? "LIVE" : "STANDBY"}</span>
            {activeReel?.intervals?.[0]?.grade && <span className="ca-chip ca-chip-amber">{activeReel.intervals[0].grade}</span>}
          </div>
        </div>

        {/* Job-log playback — CSV / LAS / WITS drag-and-drop replay bar */}
        <JobLogPlayback
          onLoad={({ samples: parsed }) => {
            setReplaySamples(parsed);
            setReplayCursor(0);
            // Pause live feed so replay drives the dashboard cleanly
            setRunning(false);
            setMode("live");
          }}
          onSampleTick={(sample, i) => {
            setReplaySample(sample);
            setReplayCursor(i);
            if (sample?.depth_ft != null) setCurrentDepth(Math.round(sample.depth_ft));
          }}
          onClose={() => {
            setReplaySample(null);
            setReplaySamples([]);
            setReplayCursor(0);
          }}
        />

        {/* Controls */}
        <div className="ca-glass flex items-center gap-2 p-2 flex-wrap">
          <button
            data-testid="liveops-run-btn"
            onClick={() => setRunning(!running)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded font-bold text-xs transition-all ${running ? "bg-[#EF4444] hover:bg-[#DC2626] text-white shadow-[0_0_0_1px_rgba(239,68,68,0.5)]" : "bg-[#FF6B1A] hover:bg-[#E55A0F] text-white shadow-[0_0_0_1px_rgba(255,107,26,0.5)]"}`}>
            {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {running ? "Pause feed" : "Start feed"}
          </button>
          <button
            data-testid="liveops-connect-btn"
            onClick={() => setConnected(!connected)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded font-bold text-xs transition-all ${connected ? "bg-[#06B6D4] text-white shadow-[0_0_0_1px_rgba(6,182,212,0.5)]" : "bg-white/5 border border-white/15 text-slate-300 hover:bg-white/10"}`}>
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connected ? "Unit connected" : "Not connected"}
          </button>
          <button
            data-testid="liveops-playback-btn"
            onClick={mode === "playback" ? exitPlayback : enterPlayback}
            className={`flex items-center gap-1 px-3 py-1.5 rounded font-bold text-xs transition-all ${mode === "playback" ? "bg-[#F59E0B] text-black shadow-[0_0_0_1px_rgba(245,158,11,0.5)]" : "bg-white/5 border border-white/15 text-slate-300 hover:bg-white/10"}`}>
            <History className="w-3.5 h-3.5" />
            {mode === "playback" ? "Exit playback" : "Playback"}
          </button>
          <button
            data-testid="liveops-dossier-btn"
            onClick={downloadDossier}
            className="flex items-center gap-1 px-3 py-1.5 rounded font-bold text-xs bg-white/5 border border-white/15 text-slate-300 hover:bg-white/10">
            <Download className="w-3.5 h-3.5" />Dossier
          </button>
          <ShareLinksButton />
          {canAnnotate && (
            <button
              data-testid="liveops-drop-note-btn"
              onClick={() => setDropOpen(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded font-bold text-xs bg-[#F59E0B] text-black hover:bg-[#FBBF24] shadow-[0_0_0_1px_rgba(245,158,11,0.5)]">
              <StickyNote className="w-3.5 h-3.5" />Drop note
            </button>
          )}
          <button
            data-testid="liveops-customize-btn"
            onClick={() => setShowPrefs(!showPrefs)}
            className="flex items-center gap-1 px-3 py-1.5 rounded font-bold text-xs bg-white/5 border border-white/15 text-slate-300 hover:bg-white/10">
            <Settings className="w-3.5 h-3.5" />Customize
          </button>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-400 ca-telemetry">
            {activeReel ? (
              <>
                <span>Reel · <b className="text-white">{activeReel.name}</b></span>
                <span className="text-[#06B6D4]">Depth · <b className="tabular-nums text-[#06B6D4]">{u.fmt(currentDepth, "depth", { digits: 0 })}</b></span>
                <span className="text-[#F59E0B]">Grade · <b className="text-[#F59E0B]">{activeReel.intervals?.[0]?.grade || "—"}</b></span>
              </>
            ) : <span className="text-[#F59E0B]">No active reel · set one in Reels</span>}
          </div>
        </div>

        {/* Playback scrubber */}
        {mode === "playback" && (
          <div data-testid="liveops-scrubber" className="ca-glass ca-glass-amber text-white p-2.5 flex items-center gap-2 flex-wrap">
            <span className="ca-eyebrow ca-eyebrow-amber">Playback</span>
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
                  annotations={[...annotations, ...tEvents]}
                  samples={samples}
                  onPinClick={(p) => jumpToAnnotation(p)}
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
          <div data-testid="liveops-customize-panel" className="ca-glass p-2.5 text-xs">
            <p className="ca-eyebrow mb-1.5">Panels — toggle & reorder</p>
            <div className="flex flex-wrap gap-2">
              {PANELS.map((p) => {
                const on = layout.includes(p.id);
                return (
                  <div key={p.id} className={`flex items-center gap-1.5 rounded px-2 py-1 transition-all ${on ? "bg-[#FF6B1A]/20 border border-[#FF6B1A]/60 shadow-[0_0_0_1px_rgba(255,107,26,0.3)]" : "bg-white/5 border border-white/10"}`}>
                    <input data-testid={`toggle-${p.id}`} type="checkbox" checked={on} onChange={() => togglePanel(p.id)} />
                    <span className="font-bold text-slate-200">{p.label}</span>
                    {on && (
                      <>
                        <button data-testid={`up-${p.id}`} onClick={() => movePanel(p.id, -1)} className="text-slate-400 hover:text-white font-bold">↑</button>
                        <button data-testid={`down-${p.id}`} onClick={() => movePanel(p.id, 1)} className="text-slate-400 hover:text-white font-bold">↓</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Grid */}
        <div className={`grid gap-3 ${layout.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : layout.length <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
          {layout.map((id) => (
            <div
              key={id}
              data-testid={`panel-${id}`}
              onClick={() => setEnlarged(id)}
              className={`group relative cursor-pointer ca-glass overflow-hidden hover:ca-glass-orange transition-all ${id === "chart" ? "sm:col-span-2 lg:col-span-3 h-[360px]" : id === "wellbore" ? "h-[320px]" : "h-[260px]"}`}>
              <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded p-1 backdrop-blur">
                <Maximize2 className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="ca-scanline" />
              {renderPanel(id, false)}
            </div>
          ))}
          {layout.length === 0 && (
            <div className="col-span-full text-center py-16 text-slate-400 text-sm ca-glass">
              No panels enabled. Open <b className="text-[#FF6B1A]">Customize</b> to turn panels on.
            </div>
          )}
        </div>

        {!running && samples.length === 0 && (
          <div className="ca-glass ca-glass-amber text-amber-100 p-3 flex items-center gap-2 text-xs">
            <Zap className="w-4 h-4 text-[#F59E0B]" />
            Click <b className="text-[#F59E0B]">Start feed</b> to animate the dashboard. In Phase 1 the feed is a jittered simulator; in Phase 2, flip <b className="text-[#06B6D4]">Unit connected</b> to pull WITS 0 / Modbus TCP from the live CT unit.
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
          onOpenTreatment={() => { setViewAnnot(null); navigate("/treatment"); }}
        />
      )}
    </div>
  );
}
