import React, { useMemo, useState, useEffect } from "react";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useActiveReel } from "../context/ActiveReelContext";
import { thinWallVonMises, vmEnvelope, intervalAt } from "../lib/ctPhysics";
import { AlertTriangle } from "lucide-react";

const PAD = 44;
const W = 680, H = 380;

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
      <Phase1PageHeader title="API RP 5C7 Triaxial · Von Mises Egg" subtitle="80% SMYS working limit · thin-wall" />
      <div className="max-w-6xl mx-auto p-2 space-y-2">
        {!activeReel && (
          <div className="bg-[#FFF3CD] text-[#856404] text-[11px] rounded p-2 border border-[#FFE69C]">
            No active reel — using default 2" QT-900. Set one in <b>Reels</b> for your actual string.
          </div>
        )}

        {/* Combined input + metric strip */}
        <div className="bg-white border border-[#D4D4D4] rounded-lg p-2">
          <div className="grid gap-2 sm:grid-cols-8 text-[11px]">
            <label className="flex flex-col"><span className="font-bold text-[#595959] text-[10px] uppercase">Depth ft</span>
              <input data-testid="vm-depth" type="number" value={depth} onChange={(e) => setDepth(num(e.target.value))} className="border rounded px-1.5 py-0.5" />
            </label>
            <label className="flex flex-col"><span className="font-bold text-[#595959] text-[10px] uppercase">P int (psi)</span>
              <input data-testid="vm-pi" type="number" value={p_i} onChange={(e) => setPi(e.target.value)} className="border rounded px-1.5 py-0.5" />
            </label>
            <label className="flex flex-col"><span className="font-bold text-[#595959] text-[10px] uppercase">P ext (psi)</span>
              <input data-testid="vm-po" type="number" value={p_o} onChange={(e) => setPo(e.target.value)} className="border rounded px-1.5 py-0.5" />
            </label>
            <label className="flex flex-col"><span className="font-bold text-[#595959] text-[10px] uppercase">F axial (lbf)</span>
              <input data-testid="vm-fax" type="number" value={F_axial} onChange={(e) => setF(e.target.value)} className="border rounded px-1.5 py-0.5" />
            </label>
            <div className={`flex flex-col rounded px-1.5 py-0.5 ${alert ? "bg-[#F8D7DA] animate-pulse" : warn ? "bg-[#FFF3CD]" : "bg-[#F0F9F3]"}`}>
              <span className="font-bold text-[9px] uppercase text-[#595959]">Von Mises</span>
              <span className="font-bold tabular-nums text-[12px]" data-testid="vm-value">{stress?.von_mises?.toFixed(0) || "—"} psi</span>
            </div>
            <div className={`flex flex-col rounded px-1.5 py-0.5 ${alert ? "bg-[#F8D7DA]" : warn ? "bg-[#FFF3CD]" : "bg-[#F0F9F3]"}`}>
              <span className="font-bold text-[9px] uppercase text-[#595959]">% 80% SMYS</span>
              <span className="font-bold tabular-nums text-[12px]" data-testid="vm-util">{(util * 100).toFixed(1)}%</span>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-[9px] uppercase text-[#595959]">Δp · σh · σa</span>
              <span className="tabular-nums text-[11px]">{dp.toFixed(0)} · {stress?.sigma_h?.toFixed(0)} · {stress?.sigma_a?.toFixed(0)}</span>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-[9px] uppercase text-[#595959]">Pipe</span>
              <span className="text-[11px]">OD {seg.od_in}" WT {seg.wt_in}" {seg.grade || "QT-900"}</span>
            </div>
          </div>
          {alert && (
            <p className="mt-1 text-[11px] font-bold text-[#C00000] flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Operating point crossed 95% of 80% SMYS working limit.</p>
          )}
        </div>

        <div className="bg-white border border-[#D4D4D4] rounded-lg p-1">
          <svg data-testid="vm-egg-svg" viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} fill="#FAFAFA" stroke="#E5E5E5" />
            {/* grid */}
            {xTicks.map((t, i) => (
              <g key={`x${i}`}>
                <line x1={toSvg(t, 0).x} y1={PAD} x2={toSvg(t, 0).x} y2={H - PAD} stroke="#EDEDED" />
                <text x={toSvg(t, 0).x} y={H - PAD + 12} textAnchor="middle" fontSize="9" fill="#8B8B8B">{t.toFixed(0)}</text>
              </g>
            ))}
            {yTicks.map((t, i) => (
              <g key={`y${i}`}>
                <line x1={PAD} y1={toSvg(0, t).y} x2={W - PAD} y2={toSvg(0, t).y} stroke="#EDEDED" />
                <text x={PAD - 4} y={toSvg(0, t).y + 3} textAnchor="end" fontSize="9" fill="#8B8B8B">{t >= 1000 ? (t / 1000).toFixed(0) + "k" : t.toFixed(0)}</text>
              </g>
            ))}
            {/* envelopes */}
            <path d={envPath(env100)} fill="rgba(214,69,69,0.08)" stroke="#8B0000" strokeDasharray="4 3" strokeWidth="1.5" />
            <path d={envPath(env80)}  fill="rgba(16,124,65,0.10)" stroke="#107C41" strokeWidth="2.2" />
            {/* axes */}
            <line x1={toSvg(0, yMin).x} y1={toSvg(0, yMin).y} x2={toSvg(0, yMax).x} y2={toSvg(0, yMax).y} stroke="#262626" strokeWidth="1" />
            <line x1={toSvg(xMin, 0).x} y1={toSvg(xMin, 0).y} x2={toSvg(xMax, 0).x} y2={toSvg(xMax, 0).y} stroke="#262626" strokeWidth="1" />
            {/* operating point */}
            <circle cx={op.x} cy={op.y} r="7" fill={alert ? "#C00000" : warn ? "#C36600" : "#0D6535"} stroke="#fff" strokeWidth="2" />
            {/* labels */}
            <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="#595959">Δp (psi) · burst (+) → ← (−) collapse</text>
            <text x={10} y={H / 2} transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle" fontSize="10" fill="#595959">F axial (lbf) · tension ↑ / compression ↓</text>
            <text x={W - PAD} y={PAD - 4} textAnchor="end" fontSize="10" fill="#107C41">80% SMYS limit</text>
            <text x={W - PAD} y={PAD + 10} textAnchor="end" fontSize="10" fill="#8B0000">100% SMYS yield</text>
          </svg>
        </div>
      </div>
    </div>
  );
}
