import React, { useMemo, useState, useEffect } from "react";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useActiveReel } from "../context/ActiveReelContext";
import { thinWallVonMises, vmEnvelope, intervalAt } from "../lib/ctPhysics";
import { AlertTriangle, Info } from "lucide-react";

const PAD = 56;
const W = 680, H = 460;

const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export default function VonMisesPage() {
  const { activeReel, currentDepth, setCurrentDepth } = useActiveReel();
  const [depth, setDepth] = useState(currentDepth || 0);
  const [p_i, setPi] = useState(5000);
  const [p_o, setPo] = useState(0);
  const [F_axial, setF] = useState(0);

  useEffect(() => { setCurrentDepth(depth); }, [depth, setCurrentDepth]);

  const seg = useMemo(() => intervalAt(activeReel, depth) || { od_in: 2.0, wt_in: 0.175, smys_psi: 90000 }, [activeReel, depth]);

  const dp = num(p_i) - num(p_o);
  const stress = useMemo(() => thinWallVonMises({
    OD: seg.od_in, WT: seg.wt_in, dp, F_axial: num(F_axial), smys: seg.smys_psi,
  }), [seg, dp, F_axial]);

  const env80 = useMemo(() => vmEnvelope({ OD: seg.od_in, WT: seg.wt_in, smys: seg.smys_psi, utilization_target: 1.0 }), [seg]);
  const env100 = useMemo(() => vmEnvelope({ OD: seg.od_in, WT: seg.wt_in, smys: seg.smys_psi, utilization_target: 1.25 }), [seg]);

  // Compute plot ranges from envelope — symmetric around origin for a proper egg
  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    const pts = env100;
    if (!pts.length) return { xMin: -5000, xMax: 5000, yMin: -50000, yMax: 50000 };
    const xMax = Math.max(...pts.map((p) => Math.abs(p.dp))) * 1.15;
    const yMax = Math.max(...pts.map((p) => Math.abs(p.F_axial))) * 1.15;
    return { xMin: -xMax, xMax, yMin: -yMax, yMax };
  }, [env100]);

  const toSvg = (dpv, Fv) => ({
    x: PAD + ((dpv - xMin) / (xMax - xMin)) * (W - 2 * PAD),
    y: H - PAD - ((Fv - yMin) / (yMax - yMin)) * (H - 2 * PAD),
  });

  const envPath = (env) => env.map((p, i) => {
    const { x, y } = toSvg(p.dp, p.F_axial);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";

  const op = stress ? toSvg(stress.dp, num(F_axial)) : { x: PAD, y: H / 2 };
  const util = stress?.utilization || 0;
  const alert = util >= 0.95;
  const warn = util >= 0.80;

  // Nice tick marks
  const xTicks = useMemo(() => {
    const step = Math.pow(10, Math.floor(Math.log10(xMax))) / 2;
    const ticks = [];
    for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) ticks.push(v);
    return ticks;
  }, [xMin, xMax]);
  const yTicks = useMemo(() => {
    const step = Math.pow(10, Math.floor(Math.log10(yMax))) / 2;
    const ticks = [];
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) ticks.push(v);
    return ticks;
  }, [yMin, yMax]);

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="API RP 5C7 Triaxial · Von Mises Egg" subtitle="80% SMYS safe working limit · thin-wall standard formulation" />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        {!activeReel && (
          <div className="bg-[#FFF3CD] text-[#856404] text-sm rounded p-3 border border-[#FFE69C]">
            No active reel. Set one in <b>Reels</b> — stress envelope depends on OD / WT / grade.
          </div>
        )}

        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3 grid gap-2 sm:grid-cols-5 text-xs">
          <label className="flex flex-col"><span className="font-bold text-[#595959]">Depth (ft)</span>
            <input data-testid="vm-depth" type="number" value={depth} onChange={(e) => setDepth(num(e.target.value))} className="border rounded px-2 py-1" />
          </label>
          <label className="flex flex-col"><span className="font-bold text-[#595959]">P_internal (psi)</span>
            <input data-testid="vm-pi" type="number" value={p_i} onChange={(e) => setPi(e.target.value)} className="border rounded px-2 py-1" />
          </label>
          <label className="flex flex-col"><span className="font-bold text-[#595959]">P_external (psi)</span>
            <input data-testid="vm-po" type="number" value={p_o} onChange={(e) => setPo(e.target.value)} className="border rounded px-2 py-1" />
          </label>
          <label className="flex flex-col"><span className="font-bold text-[#595959]">Axial Force (lbf) tension+</span>
            <input data-testid="vm-fax" type="number" value={F_axial} onChange={(e) => setF(e.target.value)} className="border rounded px-2 py-1" />
          </label>
          <div className="flex flex-col text-[11px] text-[#595959]">
            <span className="font-bold uppercase">Pipe at depth</span>
            <span>OD {seg.od_in}" · WT {seg.wt_in}" · {seg.grade || "QT-900"} · SMYS {seg.smys_psi?.toLocaleString()} psi</span>
          </div>
        </div>

        <div className={`rounded-lg border p-3 ${alert ? "bg-[#F8D7DA] border-[#F5C6CB] animate-pulse" : warn ? "bg-[#FFF3CD] border-[#FFE69C]" : "bg-white border-[#D4D4D4]"}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {alert && <AlertTriangle className="w-5 h-5 text-[#C00000]" />}
              <div>
                <p className="text-[11px] font-bold uppercase text-[#595959]">Von Mises</p>
                <p className="text-xl font-bold tabular-nums text-[#262626]" data-testid="vm-value">{stress?.von_mises?.toFixed(0) || "—"} psi</p>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase text-[#595959]">% of 80% SMYS limit</p>
              <p className="text-xl font-bold tabular-nums text-[#262626]" data-testid="vm-util">{(util * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase text-[#595959]">Safe limit (80% SMYS)</p>
              <p className="text-xl font-bold tabular-nums text-[#262626]">{stress?.safe_limit?.toFixed(0) || "—"} psi</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase text-[#595959]">Δp · σ_hoop · σ_axial</p>
              <p className="text-[13px] tabular-nums text-[#262626]">{dp.toFixed(0)} · {stress?.sigma_h?.toFixed(0)} · {stress?.sigma_a?.toFixed(0)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#D4D4D4] rounded-lg p-2">
          <svg data-testid="vm-egg-svg" viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} fill="#FAFAFA" stroke="#E5E5E5" />
            {/* grid */}
            {xTicks.map((t, i) => (
              <g key={`x${i}`}>
                <line x1={toSvg(t, 0).x} y1={PAD} x2={toSvg(t, 0).x} y2={H - PAD} stroke="#EDEDED" />
                <text x={toSvg(t, 0).x} y={H - PAD + 14} textAnchor="middle" fontSize="9" fill="#8B8B8B">{t.toFixed(0)}</text>
              </g>
            ))}
            {yTicks.map((t, i) => (
              <g key={`y${i}`}>
                <line x1={PAD} y1={toSvg(0, t).y} x2={W - PAD} y2={toSvg(0, t).y} stroke="#EDEDED" />
                <text x={PAD - 6} y={toSvg(0, t).y + 3} textAnchor="end" fontSize="9" fill="#8B8B8B">{t >= 1000 ? (t / 1000).toFixed(0) + "k" : t.toFixed(0)}</text>
              </g>
            ))}
            {/* envelopes */}
            <path d={envPath(env100)} fill="rgba(214,69,69,0.08)" stroke="#8B0000" strokeDasharray="4 3" strokeWidth="1.5" />
            <path d={envPath(env80)}  fill="rgba(16,124,65,0.10)" stroke="#107C41" strokeWidth="2.2" />
            {/* axes */}
            <line x1={toSvg(0, yMin).x} y1={toSvg(0, yMin).y} x2={toSvg(0, yMax).x} y2={toSvg(0, yMax).y} stroke="#262626" strokeWidth="1" />
            <line x1={toSvg(xMin, 0).x} y1={toSvg(xMin, 0).y} x2={toSvg(xMax, 0).x} y2={toSvg(xMax, 0).y} stroke="#262626" strokeWidth="1" />
            {/* zero labels */}
            <text x={toSvg(0, yMin).x - 4} y={toSvg(0, yMin).y - 4} fontSize="9" fill="#262626" textAnchor="end">burst →</text>
            <text x={toSvg(0, yMin).x + 4} y={toSvg(0, yMin).y - 4} fontSize="9" fill="#262626">← collapse</text>
            <text x={toSvg(xMax, 0).x - 2} y={toSvg(xMax, 0).y - 4} fontSize="9" fill="#262626" textAnchor="end">tension ↑ · compression ↓</text>
            {/* operating point */}
            <circle cx={op.x} cy={op.y} r="7" fill={alert ? "#C00000" : warn ? "#C36600" : "#0D6535"} stroke="#fff" strokeWidth="2" />
            {/* labels */}
            <text x={W / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="#595959">Differential pressure Δp (psi)  —  burst (+) ← → collapse (−)</text>
            <text x={14} y={H / 2} transform={`rotate(-90 14 ${H / 2})`} textAnchor="middle" fontSize="11" fill="#595959">Axial force (lbf)  —  tension (+) / compression (−)</text>
            <text x={W - PAD} y={PAD - 6} textAnchor="end" fontSize="10" fill="#107C41">80% SMYS working limit</text>
            <text x={W - PAD} y={PAD + 10} textAnchor="end" fontSize="10" fill="#8B0000">100% SMYS yield</text>
          </svg>
          <p className="text-[10px] text-[#595959] flex items-center gap-1 px-2 pb-1"><Info className="w-3 h-3" />
            Thin-wall σ_h = Δp·r_m/t, σ_a = F/A, VM = √(σ_h² − σ_h·σ_a + σ_a²). 80% SMYS = API RP 5C7 safe working limit; crossing it flashes a visual alert.
          </p>
        </div>
      </div>
    </div>
  );
}
