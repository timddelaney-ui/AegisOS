import React from "react";
import { thinWallVonMises, vmEnvelope, intervalAt, damageColor } from "../lib/ctPhysics";
import { Activity, Gauge as GaugeIcon } from "lucide-react";

const PAD = 20;

// Compact Von Mises egg — reads active reel from props + live sample
export function MiniVonMises({ reel, sample, large = false }) {
  const depth = sample?.depth_ft || 0;
  const seg = intervalAt(reel, depth) || { od_in: 2.0, wt_in: 0.175, smys_psi: 90000, grade: "QT-900" };
  const dp = (sample?.p_internal_psi || 0) - (sample?.p_external_psi || 0);
  const F = sample?.axial_force_lbf || 0;
  const stress = thinWallVonMises({ OD: seg.od_in, WT: seg.wt_in, dp, F_axial: F, smys: seg.smys_psi });
  const env80 = vmEnvelope({ OD: seg.od_in, WT: seg.wt_in, smys: seg.smys_psi, utilization_target: 1.0 });
  const env100 = vmEnvelope({ OD: seg.od_in, WT: seg.wt_in, smys: seg.smys_psi, utilization_target: 1.25 });

  const xMax = Math.max(...env100.map((p) => Math.abs(p.dp))) * 1.15;
  const yMax = Math.max(...env100.map((p) => Math.abs(p.F_axial))) * 1.15;
  const W = large ? 820 : 320;
  const H = large ? 540 : 220;

  const toSvg = (x, y) => ({
    x: PAD + ((x + xMax) / (2 * xMax)) * (W - 2 * PAD),
    y: H - PAD - ((y + yMax) / (2 * yMax)) * (H - 2 * PAD),
  });
  const envPath = (env) => env.map((p, i) => {
    const { x, y } = toSvg(p.dp, p.F_axial);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";

  const op = toSvg(dp, F);
  const util = stress?.utilization || 0;
  const alert = util >= 0.95;
  const warn = util >= 0.80;

  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[#0D1A24] text-white rounded-t">
        <GaugeIcon className="w-3.5 h-3.5 text-amber-300" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Von Mises</span>
        <span className={`ml-auto text-[11px] font-bold tabular-nums ${alert ? "text-red-400 animate-pulse" : warn ? "text-amber-300" : "text-green-300"}`}>
          {(util * 100).toFixed(1)}%
        </span>
      </div>
      <div className="flex-1 bg-white rounded-b border border-[#E5E5E5] overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
          <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} fill="#FAFAFA" stroke="#E5E5E5" />
          <path d={envPath(env100)} fill="rgba(214,69,69,0.08)" stroke="#8B0000" strokeDasharray="3 2" strokeWidth="1.3" />
          <path d={envPath(env80)}  fill="rgba(16,124,65,0.10)" stroke="#FF6B1A" strokeWidth="2" />
          <line x1={toSvg(0, -yMax).x} y1={toSvg(0, -yMax).y} x2={toSvg(0, yMax).x} y2={toSvg(0, yMax).y} stroke="#262626" strokeWidth="0.6" />
          <line x1={toSvg(-xMax, 0).x} y1={toSvg(-xMax, 0).y} x2={toSvg(xMax, 0).x} y2={toSvg(xMax, 0).y} stroke="#262626" strokeWidth="0.6" />
          <circle cx={op.x} cy={op.y} r={large ? "9" : "6"} fill={alert ? "#C00000" : warn ? "#C36600" : "#C44A08"} stroke="#fff" strokeWidth="2">
            {alert && <animate attributeName="r" values={large ? "9;13;9" : "6;9;6"} dur="0.9s" repeatCount="indefinite" />}
          </circle>
          <text x={W - 4} y={14} textAnchor="end" fontSize={large ? 11 : 9} fill="#FF6B1A">80% SMYS</text>
          {large && (
            <>
              <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="#595959">Δp (psi) · burst (+) / collapse (−)</text>
              <text x={10} y={H / 2} transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle" fontSize="11" fill="#595959">F axial (lbf)</text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

// Mini fatigue strip — damage[] array of 0..1 values
export function MiniFatigue({ damage = [], spacing = 100, worst = 0, large = false }) {
  const warn = worst >= 0.8;
  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[#0D1A24] text-white rounded-t">
        <Activity className="w-3.5 h-3.5 text-amber-300" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Reel Fatigue · {spacing}ft nodes</span>
        <span className={`ml-auto text-[11px] font-bold tabular-nums ${warn ? "text-red-400" : "text-green-300"}`}>
          worst {(worst * 100).toFixed(1)}%
        </span>
      </div>
      <div className="flex-1 bg-white rounded-b border border-[#E5E5E5] p-2 overflow-auto">
        <div className="flex flex-wrap gap-[1px] content-start">
          {damage.length === 0 && <p className="text-[10px] text-[#595959] italic">No fatigue history yet.</p>}
          {damage.map((d, i) => (
            <div
              key={i}
              title={`MD ${i * spacing} ft · ${(d * 100).toFixed(1)}%`}
              className={large ? "w-[14px] h-5" : "w-[7px] h-3"}
              style={{ background: damageColor(d), borderRadius: 1 }}
            />
          ))}
        </div>
        {large && (
          <div className="flex items-center gap-3 text-[10px] text-[#595959] mt-3 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: damageColor(0.1) }} /> fresh</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: damageColor(0.4) }} /> &lt;50%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: damageColor(0.6) }} /> amber</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: damageColor(0.85) }} /> red</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: damageColor(0.99) }} /> retire</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Radial-arc gauge for weight / pressure
export function LiveGauge({ title, unit, value, min = 0, max = 100, criticalAbove, warnAbove, large = false, color = "#0056B3" }) {
  const v = Number(value) || 0;
  const pct = Math.max(0, Math.min(1, (v - min) / (max - min)));
  const angle = -120 + pct * 240; // -120° to +120°
  const r = large ? 110 : 60;
  const cx = r + 20;
  const cy = r + 10;
  const toXY = (deg) => {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const arcPath = (startDeg, endDeg) => {
    const a = toXY(startDeg), b = toXY(endDeg);
    const large_arc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 ${large_arc} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  };
  const warn = warnAbove != null && v >= warnAbove;
  const critical = criticalAbove != null && v >= criticalAbove;
  const needle = toXY(angle);
  const W = (r + 20) * 2;
  const H = r + 50;
  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[#0D1A24] text-white rounded-t">
        <GaugeIcon className="w-3.5 h-3.5 text-amber-300" />
        <span className="text-[10px] font-bold uppercase tracking-wider">{title}</span>
        <span className={`ml-auto text-[11px] font-bold tabular-nums ${critical ? "text-red-400 animate-pulse" : warn ? "text-amber-300" : "text-white"}`}>
          {v.toFixed(0)} {unit}
        </span>
      </div>
      <div className="flex-1 bg-white rounded-b border border-[#E5E5E5] flex items-center justify-center">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full max-h-full">
          {/* Background arc */}
          <path d={arcPath(-120, 120)} stroke="#E5E5E5" strokeWidth="8" fill="none" />
          {/* Warning arc */}
          {warnAbove != null && (
            <path d={arcPath(-120 + ((warnAbove - min) / (max - min)) * 240, 120)} stroke="#C36600" strokeWidth="8" fill="none" opacity="0.5" />
          )}
          {criticalAbove != null && (
            <path d={arcPath(-120 + ((criticalAbove - min) / (max - min)) * 240, 120)} stroke="#C00000" strokeWidth="8" fill="none" opacity="0.6" />
          )}
          {/* Value arc */}
          <path d={arcPath(-120, angle)} stroke={critical ? "#C00000" : warn ? "#C36600" : color} strokeWidth="8" fill="none" strokeLinecap="round" />
          {/* Needle */}
          <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="#262626" strokeWidth="2" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="4" fill="#262626" />
          {/* Center value */}
          <text x={cx} y={cy + r / 2 + 4} textAnchor="middle" fontSize={large ? 28 : 16} fontWeight="bold" fill={critical ? "#C00000" : warn ? "#C36600" : "#262626"} className="tabular-nums">{v.toFixed(0)}</text>
          <text x={cx} y={cy + r / 2 + (large ? 24 : 16)} textAnchor="middle" fontSize={large ? 12 : 10} fill="#595959">{unit}</text>
          {/* Min/max */}
          <text x={toXY(-120).x} y={toXY(-120).y + 14} textAnchor="middle" fontSize="9" fill="#8B8B8B">{min}</text>
          <text x={toXY(120).x} y={toXY(120).y + 14} textAnchor="middle" fontSize="9" fill="#8B8B8B">{max}</text>
        </svg>
      </div>
    </div>
  );
}

// Scrolling strip chart (last N samples)
export function StripChart({ samples = [], series = [], large = false }) {
  // series: [{ key, color, label, scaleHint? }]
  const W = large ? 820 : 440;
  const H = large ? 540 : 220;
  const padL = 42, padR = 10, padT = 20, padB = 22;
  const n = samples.length;
  const xStep = n > 1 ? (W - padL - padR) / (n - 1) : 0;

  // One y-axis per series (independent scaling)
  const bounds = series.map((s) => {
    const vals = samples.map((p) => Number(p?.[s.key])).filter((v) => Number.isFinite(v));
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 1;
    const pad = (hi - lo) * 0.1 + 1;
    return { lo: lo - pad, hi: hi + pad };
  });
  const toY = (v, b) => padT + (1 - (v - b.lo) / Math.max(b.hi - b.lo, 1e-6)) * (H - padT - padB);
  const line = (s, b) => samples.map((p, i) => {
    const v = Number(p?.[s.key]);
    if (!Number.isFinite(v)) return null;
    return `${i === 0 ? "M" : "L"}${(padL + i * xStep).toFixed(1)},${toY(v, b).toFixed(1)}`;
  }).filter(Boolean).join(" ");

  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[#0D1A24] text-white rounded-t">
        <Activity className="w-3.5 h-3.5 text-amber-300" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Live Chart · last {n} samples</span>
        <span className="ml-auto flex items-center gap-2">
          {series.map((s) => (
            <span key={s.key} className="text-[10px] font-bold" style={{ color: s.color }}>● {s.label}</span>
          ))}
        </span>
      </div>
      <div className="flex-1 bg-white rounded-b border border-[#E5E5E5]">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
          <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="#FAFAFA" stroke="#E5E5E5" />
          {series.map((s, i) => (
            <g key={s.key}>
              <path d={line(s, bounds[i])} stroke={s.color} strokeWidth="2" fill="none" />
              {/* latest value tag */}
              {samples.length > 0 && Number.isFinite(Number(samples[samples.length - 1]?.[s.key])) && (
                <circle
                  cx={padL + (samples.length - 1) * xStep}
                  cy={toY(Number(samples[samples.length - 1][s.key]), bounds[i])}
                  r="3" fill={s.color} />
              )}
            </g>
          ))}
          <text x={padL} y={H - 6} fontSize="9" fill="#8B8B8B">now −{n}s</text>
          <text x={W - padR} y={H - 6} textAnchor="end" fontSize="9" fill="#8B8B8B">now</text>
        </svg>
      </div>
    </div>
  );
}
