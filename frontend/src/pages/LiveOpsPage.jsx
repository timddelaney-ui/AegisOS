import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { useActiveReel } from "../context/ActiveReelContext";
import { MiniVonMises, MiniFatigue, LiveGauge, StripChart } from "../components/LiveOpsPanels";
import { Play, Pause, Wifi, WifiOff, Maximize2, X, Zap, Settings } from "lucide-react";

const RING = 180;             // seconds of history
const TICK_MS = 1000;         // 1 Hz

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
  const timerRef = useRef(null);
  const feedTickRef = useRef(0);

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
      setSamples((prev) => {
        const last = prev[prev.length - 1];
        const next = { ...nextSimSample(last, t), ts: new Date().toISOString(), source: connected ? "wits" : "simulated" };
        const buf = [...prev, next];
        if (buf.length > RING) buf.splice(0, buf.length - RING);
        // live reel depth → update global context
        setCurrentDepth(Math.round(next.depth_ft));
        return buf;
      });
      // feed server-side ring buffer (fire-and-forget)
      try {
        const last = samples[samples.length - 1];
        const sample = nextSimSample(last, t);
        await axios.post(`${API}/liveops/feed`, {
          ...sample,
          reel_id: activeReel?.reel_id,
          source: connected ? "wits" : "simulated",
        }, { withCredentials: true });
      } catch { /* non-blocking */ }
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
  }, [running, connected, activeReel?.reel_id]);

  const latest = samples[samples.length - 1] || {};

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
        return <StripChart samples={samples} series={[
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

  return (
    <div className="min-h-screen bg-[#0D1A24]">
      <Phase1PageHeader title="Live Ops" subtitle={running ? `${connected ? "Connected · WITS" : "Simulated"} · ${samples.length}/${RING}s · depth ${Math.round(latest.depth_ft || 0)} ft` : "Idle"} />

      <div className="max-w-7xl mx-auto p-2 space-y-2">
        {/* Controls */}
        <div className="flex items-center gap-2 bg-[#111827] text-white rounded-lg p-2 flex-wrap">
          <button
            data-testid="liveops-run-btn"
            onClick={() => setRunning(!running)}
            className={`flex items-center gap-1 px-3 py-1 rounded font-bold text-xs ${running ? "bg-[#C00000]" : "bg-[#107C41]"}`}>
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

        {showPrefs && (
          <div data-testid="liveops-customize-panel" className="bg-[#111827] text-white rounded-lg p-2 text-xs">
            <p className="font-bold uppercase text-[10px] text-white/60 mb-1">Panels — toggle & reorder</p>
            <div className="flex flex-wrap gap-2">
              {PANELS.map((p) => {
                const on = layout.includes(p.id);
                return (
                  <div key={p.id} className={`flex items-center gap-1 rounded px-2 py-1 ${on ? "bg-[#107C41]/30 border border-[#107C41]/50" : "bg-white/5 border border-white/10"}`}>
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
    </div>
  );
}
