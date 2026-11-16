import React, { useMemo } from "react";
import { triaxialVonMises, vmEnvelope, calculateBucklingThresholds, E_STEEL_PSI, intervalAt } from "../../lib/ctPhysics";
import { useActiveReel } from "../../context/ActiveReelContext";
import { useUnits } from "../../context/UnitContext";

const STEEL_LB_PER_IN3 = 0.2836;
const DEFAULT_CASING_ID_IN = 4.0; // assumed hole size when no wellbore data is wired

export function operatingState({ pInt, pWh, weight, inclination, seg }) {
  const { od_in: OD, wt_in: WT, smys_psi: smys } = seg;
  const vm = triaxialVonMises({ OD, WT, p_i: pInt ?? 0, p_o: pWh ?? 0, F_axial: weight ?? 0, smys });
  const id = OD - 2 * WT;
  const area = Math.PI * ((OD / 2) ** 2 - (id / 2) ** 2);
  const I = (Math.PI / 64) * (OD ** 4 - id ** 4);
  let buckling = null;
  try {
    buckling = calculateBucklingThresholds({
      E: E_STEEL_PSI, I, w: area * STEEL_LB_PER_IN3, r: (DEFAULT_CASING_ID_IN - OD) / 2,
      thetaDeg: Math.min(90, Math.max(0, Number(inclination) || 0)),
    });
  } catch { /* geometry invalid: skip buckling lines */ }
  const compression = (weight ?? 0) < 0;
  const comp = compression ? -weight : 0;
  const bucklingState = !buckling || !compression ? "none" : comp >= buckling.fCritHel ? "helical" : comp >= buckling.fCritSin ? "sinusoidal" : "none";
  return { vm, buckling, compression, bucklingState };
}

export default function EnvelopePanel({ signals }) {
  const units = useUnits();
  const { activeReel } = useActiveReel();
  const seg = useMemo(() => {
    const s = intervalAt(activeReel, signals.depth || 0);
    return { od_in: Number(s?.od_in) || 1.75, wt_in: Number(s?.wt_in) || 0.134, smys_psi: Number(s?.smys_psi) || 90000 };
  }, [activeReel, signals.depth]);
  const env = useMemo(() => vmEnvelope({ OD: seg.od_in, WT: seg.wt_in, smys: seg.smys_psi, p_o: signals.pWh || 0 }), [seg, signals.pWh]);
  const op = operatingState({ pInt: signals.pInt, pWh: signals.pWh, weight: signals.weight, inclination: signals.telemetry.inclination, seg });

  const W = 300, H = 220, M = 26;
  const xs = env.map((p) => p.dp); const ys = env.map((p) => p.F_axial);
  const dpOp = signals.dp ?? 0; const fOp = signals.weight ?? 0;
  const minX = Math.min(...xs, dpOp), maxX = Math.max(...xs, dpOp);
  const minY = Math.min(...ys, fOp, Number.isFinite(op.buckling?.fCritHel) ? -op.buckling.fCritHel : 0), maxY = Math.max(...ys, fOp);
  const sx = (v) => M + ((v - minX) / (maxX - minX || 1)) * (W - 2 * M);
  const sy = (v) => H - M - ((v - minY) / (maxY - minY || 1)) * (H - 2 * M);
  const path = env.length ? env.map((p, i) => `${i ? "L" : "M"}${sx(p.dp).toFixed(1)},${sy(p.F_axial).toFixed(1)}`).join("") : "";
  const yieldPct = op.vm ? op.vm.utilization_smys * 100 : null;
  const safePct = op.vm ? op.vm.utilization * 100 : null;
  const risk = op.bucklingState !== "none";

  return (
    <div className="flex flex-col gap-2" data-testid="envelope-panel">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-bold tracking-wide text-slate-300">API RP 5C7 VON MISES ENVELOPE</h3>
        <span className="font-mono tabular-nums text-sm text-[#F8FAFC]" data-testid="pct-yield">
          {yieldPct === null ? "—" : `${yieldPct.toFixed(1)}% Yield`} <span className="text-slate-400 text-xs">({safePct === null ? "—" : safePct.toFixed(0)}% of 80% limit)</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-[#0B1120] rounded-lg border border-slate-700" role="img" aria-label="Von Mises envelope">
        {path && <path d={path} fill="rgba(34,211,238,0.08)" stroke="#22D3EE" strokeWidth="1.5" />}
        <line x1={sx(0)} x2={sx(0)} y1={M / 2} y2={H - M / 2} stroke="#334155" />
        <line x1={M / 2} x2={W - M / 2} y1={sy(0)} y2={sy(0)} stroke="#334155" />
        {op.buckling && Number.isFinite(op.buckling.fCritSin) && [["Sinusoidal", op.buckling.fCritSin, "#F59E0B"], ["Helical", op.buckling.fCritHel, "#EF4444"]].map(([n, f, c]) => (
          <g key={n}><line x1={M} x2={W - M} y1={sy(-f)} y2={sy(-f)} stroke={c} strokeDasharray="5 3" /><text x={W - M} y={sy(-f) - 2} fontSize="8" fill={c} textAnchor="end">{n} {units.fmt(f, "weight")}</text></g>
        ))}
        <circle cx={sx(dpOp)} cy={sy(fOp)} r="5" fill={risk || (yieldPct ?? 0) > 100 ? "#EF4444" : "#F8FAFC"} stroke="#0B1120" />
        <text x={M} y={10} fontSize="8" fill="#94A3B8">Axial force ({units.label("weight")}) vs Δp ({units.label("pressure")})</text>
      </svg>
      <div className={`text-xs font-mono rounded px-2 py-1 border ${risk ? "border-red-500 text-red-300 bg-red-950/40" : op.compression ? "border-amber-500 text-amber-300" : "border-slate-700 text-slate-400"}`} data-testid="buckling-status">
        {op.compression
          ? `COMPRESSION (Weight < 0) · ${risk ? `${op.bucklingState.toUpperCase()} BUCKLING RISK` : "below buckling thresholds"}`
          : "Tension · no buckling risk"}
        {op.buckling && Number.isFinite(op.buckling.fCritSin) && <div className="text-slate-400">Dawson-Paslay: F_sin {units.fmt(op.buckling.fCritSin, "weight")} · F_hel {units.fmt(op.buckling.fCritHel, "weight")} (assumes {units.fmt(DEFAULT_CASING_ID_IN, "od")} bore)</div>}
      </div>
    </div>
  );
}
