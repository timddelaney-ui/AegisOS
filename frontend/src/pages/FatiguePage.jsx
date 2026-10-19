import React, { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { useActiveReel } from "../context/ActiveReelContext";
import { damageColor, injectorSkateMechanics, DEFAULT_SKATE, intervalAt } from "../lib/ctPhysics";
import { isSupervisorOrHigher } from "../lib/roles";
import { Play, Pause, RotateCcw, Zap, AlertTriangle, Gauge } from "lucide-react";
import ShareLinksButton from "../components/ShareLinksButton";

export default function FatiguePage() {
  const { user } = useAuth();
  const canReset = isSupervisorOrHigher(user);
  const { activeReel, currentDepth, setCurrentDepth } = useActiveReel();
  const [state, setState] = useState(null);
  const [pressure, setPressure] = useState(1200);
  const [simOn, setSimOn] = useState(false);
  const [depth, setDepth] = useState(currentDepth || 0);
  const timerRef = useRef(null);

  const refresh = async () => {
    if (!activeReel) return;
    try { const r = await axios.get(`${API}/fatigue/state`, { params: { reel_id: activeReel.reel_id }, withCredentials: true }); setState(r.data); } catch (e) { console.debug("[Fatigue] refresh failed", e?.response?.status || e?.message); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [activeReel?.reel_id]);
  useEffect(() => { setCurrentDepth(depth); }, [depth, setCurrentDepth]);

  const feed = async (overrides = {}) => {
    if (!activeReel) return toast.error("No active reel");
    try {
      const r = await axios.post(`${API}/fatigue/feed`, {
        reel_id: activeReel.reel_id,
        depth_ft: overrides.depth ?? depth,
        traction_pressure_psi: overrides.pressure ?? Number(pressure),
        cycle_count: 1,
        source: overrides.source || "manual",
      }, { withCredentials: true });
      setState(r.data);
      if (r.data.derate_warning) toast.warning(`Derate warning — worst node at ${(r.data.worst_damage * 100).toFixed(0)}% life used`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Feed failed");
    }
  };

  // Simulated feed (Phase 1 convenience — animates without hardware)
  useEffect(() => {
    if (!simOn) { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } return; }
    timerRef.current = setInterval(() => {
      const jitter = 400 + Math.random() * 1200;
      setPressure(Math.round(jitter));
      const d = Math.max(0, Math.min(activeReel?.total_length_ft || 10000, depth + 100));
      setDepth(d);
      feed({ pressure: Math.round(jitter), depth: d, source: "simulated" });
    }, 2000);
    return () => timerRef.current && clearInterval(timerRef.current);
    // eslint-disable-next-line
  }, [simOn, depth, activeReel?.reel_id]);

  const reset = async () => {
    if (!canReset) return;
    if (!activeReel) return;
    if (!window.confirm("Reset fatigue ledger for this reel? This marks the reel as fresh.")) return;
    try { await axios.post(`${API}/fatigue/reset`, null, { params: { reel_id: activeReel.reel_id }, withCredentials: true }); toast.success("Reel ledger reset"); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Reset failed"); }
  };

  const worst = state?.worst_damage || 0;
  const warn = worst >= 0.8;
  const nodes = state?.damage || [];
  const spacing = state?.spacing_ft || 100;

  const totalFt = useMemo(() => (nodes.length - 1) * spacing, [nodes, spacing]);

  // Injector-skate ovality + fatigue scaling (local client-side preview — Phase 2 pathway).
  const seg = useMemo(() => intervalAt(activeReel, depth) || { od_in: 2.0, wt_in: 0.175 }, [activeReel, depth]);
  const skate = useMemo(() => injectorSkateMechanics({
    skate_pressure_psi: pressure, OD: seg.od_in, WT: seg.wt_in,
  }), [pressure, seg.od_in, seg.wt_in]);

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="Reel Fatigue · Palmgren-Miner" subtitle={`Driven by live traction pressure · ${spacing} ft stations · [API RP 5C7 §6 / Palmgren-Miner · Manson-Coffin low-cycle]`} right={<ShareLinksButton scope="fatigue" compact />} />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        {!activeReel && (
          <div className="bg-[#FFF3CD] text-[#856404] text-sm rounded p-3 border border-[#FFE69C]">
            Set an active reel in <b>Reels</b> first.
          </div>
        )}

        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3 grid gap-2 sm:grid-cols-4 text-xs">
          <label className="flex flex-col"><span className="font-bold text-[#595959]">Depth (ft)</span>
            <input data-testid="fatigue-depth" type="number" value={depth} onChange={(e) => setDepth(Number(e.target.value) || 0)} className="border rounded px-2 py-1" />
          </label>
          <label className="flex flex-col"><span className="font-bold text-[#595959]">Traction pressure (psi)</span>
            <input data-testid="fatigue-pressure" type="number" value={pressure} onChange={(e) => setPressure(e.target.value)} className="border rounded px-2 py-1" />
          </label>
          <div className="flex flex-col justify-center gap-2">
            <button data-testid="fatigue-feed-btn" onClick={() => feed()} className="bg-[#FF6B1A] text-white px-3 py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1"><Zap className="w-3.5 h-3.5" />Advance 1 cycle</button>
          </div>
          <div className="flex flex-col justify-center gap-1">
            <button data-testid="fatigue-sim-btn" onClick={() => setSimOn(!simOn)} className={`${simOn ? "bg-[#C00000]" : "bg-[#0056B3]"} text-white px-3 py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1`}>
              {simOn ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {simOn ? "Pause sim" : "Simulate feed"}
            </button>
            {canReset && (
              <button data-testid="fatigue-reset-btn" onClick={reset} className="bg-[#F3F4F6] text-[#262626] px-3 py-1 text-xs font-bold rounded flex items-center justify-center gap-1 border"><RotateCcw className="w-3 h-3" />Reset reel</button>
            )}
          </div>
        </div>

        <div className={`rounded-lg border p-3 ${warn ? "bg-[#F8D7DA] border-[#F5C6CB]" : "bg-white border-[#D4D4D4]"}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase text-[#595959]">Worst node damage</p>
              <p className="text-2xl font-bold tabular-nums" data-testid="fatigue-worst" style={{ color: damageColor(worst) }}>
                {(worst * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase text-[#595959]">Nodes</p>
              <p className="text-xl font-bold tabular-nums">{nodes.length}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase text-[#595959]">Reel length</p>
              <p className="text-xl font-bold tabular-nums">{totalFt} ft</p>
            </div>
            {warn && (
              <div className="flex items-center gap-2 text-[#721C24] font-bold text-sm">
                <AlertTriangle className="w-5 h-5" /> Derate warning — worst node ≥ 80% life used
              </div>
            )}
          </div>
        </div>

        {/* Injector-skate ovality + fatigue scaling (clean-room public mechanics) */}
        <div
          data-testid="skate-panel"
          className={`rounded-lg border p-3 ${skate.over_recommended ? "bg-[#FFF3CD] border-[#FFE69C]" : "bg-white border-[#D4D4D4]"}`}
        >
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <Gauge className="w-4 h-4 text-[#FF6B1A]" />
              Injector Skate · Ovality + Fatigue Scaling
            </h3>
            <span className="text-[10px] text-[#595959]">
              Recommended cap {DEFAULT_SKATE.recommended_max_psi} psi · pipe {seg.od_in}" × {seg.wt_in}"
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[11px]">
            <div className="flex flex-col">
              <span className="font-bold text-[9px] uppercase text-[#595959]">Skate psi</span>
              <span className="font-bold tabular-nums text-[14px]" data-testid="skate-pressure-display">{Math.round(skate.skate_pressure_psi).toLocaleString()}</span>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-[9px] uppercase text-[#595959]">Clamp force</span>
              <span className="font-bold tabular-nums text-[14px]">{Math.round(skate.clamping_force_lbf).toLocaleString()} lbf</span>
            </div>
            <div className={`flex flex-col rounded px-1 ${skate.ovality_pct > 2 ? "bg-[#F8D7DA]" : ""}`}>
              <span className="font-bold text-[9px] uppercase text-[#595959]">Ovality</span>
              <span className="font-bold tabular-nums text-[14px]" data-testid="skate-ovality">{skate.ovality_pct.toFixed(2)}%</span>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-[9px] uppercase text-[#595959]">Contact σ</span>
              <span className="font-bold tabular-nums text-[14px]">{Math.round(skate.contact_stress_psi).toLocaleString()} psi</span>
            </div>
            <div className={`flex flex-col rounded px-1 ${skate.K_t > 1.5 ? "bg-[#FFF3CD]" : ""}`}>
              <span className="font-bold text-[9px] uppercase text-[#595959]">K<sub>t</sub></span>
              <span className="font-bold tabular-nums text-[14px]" data-testid="skate-kt">{skate.K_t.toFixed(2)}</span>
            </div>
            <div className={`flex flex-col rounded px-1 ${skate.fatigue_scale > 1.5 ? "bg-[#F8D7DA]" : "bg-[#FFF7EF]"}`}>
              <span className="font-bold text-[9px] uppercase text-[#595959]">Fatigue × </span>
              <span className="font-bold tabular-nums text-[14px]" data-testid="skate-fatigue-scale">{skate.fatigue_scale.toFixed(2)}×</span>
            </div>
          </div>
          {skate.over_recommended && (
            <p className="mt-2 text-[11px] font-bold text-[#856404] flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Skate pressure {Math.round(skate.skate_pressure_psi)} psi exceeds the {DEFAULT_SKATE.recommended_max_psi} psi anti-slip cap — cycle damage scaled by {skate.fatigue_scale.toFixed(2)}×.
            </p>
          )}
          <p className="text-[10px] text-[#8A8A8A] mt-1 italic">
            Clean-room public mechanics (Timoshenko ring deflection + Peterson K<sub>t</sub>). Advisory only.
          </p>
        </div>

        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
          <h3 className="font-bold text-sm mb-2">Reel Heatmap · green → red</h3>
          <div data-testid="fatigue-heatmap" className="flex flex-wrap gap-[2px]">
            {nodes.map((d, i) => (
              <div key={`fnode-${i * spacing}`} title={`MD ${i * spacing} ft · ${(d * 100).toFixed(1)}% life used`}
                className="w-[14px] h-6 rounded-[2px]"
                style={{ background: damageColor(d) }} />
            ))}
            {nodes.length === 0 && <p className="text-xs text-[#595959]">No fatigue history yet.</p>}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-[#595959] mt-2">
            <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block rounded-sm" style={{ background: damageColor(0.1) }} /> fresh</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block rounded-sm" style={{ background: damageColor(0.4) }} /> &lt;50%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block rounded-sm" style={{ background: damageColor(0.6) }} /> amber</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block rounded-sm" style={{ background: damageColor(0.85) }} /> red</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block rounded-sm" style={{ background: damageColor(0.99) }} /> retire</span>
          </div>
          <p className="text-[10px] text-[#595959] mt-2">
            Calculator sheets DO NOT emit fatigue events. Only live traction pressure (manual, simulated, or Phase 2 DAQ) advances this ledger.
          </p>
        </div>
      </div>
    </div>
  );
}
