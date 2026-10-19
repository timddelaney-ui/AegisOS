import React from "react";
import { thinWallVonMises, vmEnvelope, intervalAt, damageColor } from "../lib/ctPhysics";
import { Activity, Gauge as GaugeIcon, Compass } from "lucide-react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Grid } from "@react-three/drei";
import * as THREE from "three";

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
              key={`dmg-${i * spacing}`}
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
// `trend` (optional): array of recent numeric values projected into the same
// display units as `value` — rendered as a 60s micro-sparkline at the bottom
// of the gauge body so the tool push can see trend direction without opening
// the full chart.
export function LiveGauge({ title, unit, value, min = 0, max = 100, criticalAbove, warnAbove, large = false, color = "#0056B3", digits = 0, secondary = null, trend = null }) {
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
  // Trend sparkline geometry — bandY sits just under the min/max end labels,
  // bandH is the strip height; we extend H to actually contain the band.
  const hasTrend = Array.isArray(trend) && trend.length >= 2;
  const bandY = cy + r + (large ? 22 : 16);
  const bandH = large ? 14 : 8;
  const bandBottomPad = 4;
  const H = hasTrend ? (bandY + bandH + bandBottomPad) : (r + 50);
  // Format min/max end-labels with same precision as the center readout.
  const fmtV = (x) => x.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[#0D1A24] text-white rounded-t">
        <GaugeIcon className="w-3.5 h-3.5 text-amber-300" />
        <span className="text-[10px] font-bold uppercase tracking-wider">{title}</span>
        <span className={`ml-auto text-[11px] font-bold tabular-nums ${critical ? "text-red-400 animate-pulse" : warn ? "text-amber-300" : "text-white"}`}>
          {fmtV(v)} {unit}
          {secondary && (
            <span data-testid="livegauge-secondary" className="ml-1.5 text-[9px] font-semibold text-slate-400 tabular-nums">
              ≈ {secondary}
            </span>
          )}
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
          <text x={cx} y={cy + r / 2 + 4} textAnchor="middle" fontSize={large ? 28 : 16} fontWeight="bold" fill={critical ? "#C00000" : warn ? "#C36600" : "#262626"} className="tabular-nums">{fmtV(v)}</text>
          <text x={cx} y={cy + r / 2 + (large ? 24 : 16)} textAnchor="middle" fontSize={large ? 12 : 10} fill="#595959">{unit}</text>
          {secondary && (
            <text x={cx} y={cy + r / 2 + (large ? 42 : 28)} textAnchor="middle" fontSize={large ? 11 : 9} fill="#8B8B8B" className="tabular-nums">≈ {secondary}</text>
          )}
          {/* Min/max */}
          <text x={toXY(-120).x} y={toXY(-120).y + 14} textAnchor="middle" fontSize="9" fill="#8B8B8B">{fmtV(min)}</text>
          <text x={toXY(120).x} y={toXY(120).y + 14} textAnchor="middle" fontSize="9" fill="#8B8B8B">{fmtV(max)}</text>
          {/* Trend sparkline (last ~60 samples) — plotted along the bottom
              of the gauge body. Scales to the pen's own min/max so even a
              gentle 50-psi drift is visible. */}
          {hasTrend && (() => {
            const vals = trend.filter((n) => Number.isFinite(n));
            if (vals.length < 2) return null;
            const lo = Math.min(...vals);
            const hi = Math.max(...vals);
            const spread = Math.max(hi - lo, 1e-6);
            const bandL = toXY(-120).x - 4;
            const bandR = toXY(120).x + 4;
            const bandW = bandR - bandL;
            const step = bandW / (vals.length - 1);
            const path = vals.map((val, i) => {
              const x = bandL + i * step;
              const y = bandY + bandH - ((val - lo) / spread) * bandH;
              return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(" ");
            const lastX = bandL + (vals.length - 1) * step;
            const lastY = bandY + bandH - ((vals[vals.length - 1] - lo) / spread) * bandH;
            return (
              <g data-testid="livegauge-trend-spark" opacity="0.95">
                <rect x={bandL} y={bandY} width={bandW} height={bandH} fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="0.5" rx="1" />
                <path d={path} stroke={critical ? "#C00000" : warn ? "#C36600" : color} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={lastX} cy={lastY} r="1.5" fill={critical ? "#C00000" : warn ? "#C36600" : color} />
                <text x={bandL - 2} y={bandY + bandH + 7} fontSize="7" fill="#64748B" textAnchor="start" className="tabular-nums">T−60s</text>
              </g>
            );
          })()}
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

/*────────────────────────────────────────────────────────────────────
  RollingTrends — Enterprise 5-pen scrolling strip chart with cursor
  spotlight, legend-with-live-value, and spike indicators. Designed
  for the "spot the exact tick the string went sticky" doghouse flow.
────────────────────────────────────────────────────────────────────*/
export function RollingTrends({ samples = [], series = [], cursorIndex = null, onCursor, large = false, title = "Rolling Trends · 1 Hz" }) {
  const W = large ? 1180 : 680;
  const H = large ? 540 : 300;
  const padL = 56, padR = 16, padT = 28, padB = 24;
  const n = samples.length;
  const xStep = n > 1 ? (W - padL - padR) / (n - 1) : 0;

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

  // Resolve cursor sample
  const safeCursor = cursorIndex != null && cursorIndex >= 0 && cursorIndex < n ? cursorIndex : (n > 0 ? n - 1 : null);
  const cursorX = safeCursor != null ? padL + safeCursor * xStep : null;
  const cursorSample = safeCursor != null ? samples[safeCursor] : null;

  // Click handler → inform parent (lets external scrubber jump to the tick)
  const svgRef = React.useRef(null);
  const handleClick = (e) => {
    e.stopPropagation();
    if (!onCursor || !svgRef.current || xStep === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    // mouse x in viewBox space
    const scaleX = W / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    const i = Math.round((mx - padL) / xStep);
    const clamped = Math.max(0, Math.min(n - 1, i));
    onCursor(clamped);
  };

  // Y-axis tick count (per-pen mini scales rendered on the left stacked)
  const laneCount = series.length;
  const laneH = (H - padT - padB) / Math.max(1, laneCount);

  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#0D1A24] text-white rounded-t border-b border-white/5">
        <Activity className="w-3.5 h-3.5 text-[#F59E0B]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">{title}</span>
        <span className="text-[9px] text-slate-500 font-mono tabular-nums">· {n} samples</span>
        <span className="ml-auto flex items-center gap-3">
          {series.map((s) => {
            const v = cursorSample ? Number(cursorSample[s.key]) : null;
            const txt = (v != null && Number.isFinite(v)) ? (s.format ? s.format(v) : v.toFixed(0)) : "—";
            return (
              <span key={s.key} className="flex items-center gap-1 text-[10px] font-bold tabular-nums" style={{ color: s.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
                <span className="uppercase tracking-wider text-[9px] text-slate-400">{s.label}</span>
                <span>{txt}</span>
                {s.suffix && <span className="text-[9px] text-slate-500">{s.suffix}</span>}
              </span>
            );
          })}
        </span>
      </div>
      <div className="flex-1 bg-[#0A1220] rounded-b overflow-hidden">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-full cursor-crosshair" onClick={handleClick}>
          {/* Lane backgrounds */}
          {series.map((s, i) => (
            <rect key={`lane-${s.key}`}
              x={padL} y={padT + i * laneH}
              width={W - padL - padR} height={laneH}
              fill={i % 2 === 0 ? "rgba(148,163,184,0.03)" : "transparent"} />
          ))}
          {/* Vertical grid every 60s */}
          {Array.from({ length: Math.floor(n / 60) + 1 }, (_, k) => {
            const idx = n - 1 - k * 60;
            if (idx < 0) return null;
            const x = padL + idx * xStep;
            return <line key={`gv-${k}`} x1={x} y1={padT} x2={x} y2={H - padB} stroke="rgba(148,163,184,0.08)" strokeDasharray="2 3" />;
          })}
          {/* Horizontal lane dividers */}
          {series.slice(1).map((_, i) => (
            <line key={`gh-${i}`} x1={padL} y1={padT + (i + 1) * laneH} x2={W - padR} y2={padT + (i + 1) * laneH} stroke="rgba(148,163,184,0.1)" />
          ))}
          {/* Pens */}
          {series.map((s, i) => (
            <g key={s.key}>
              <path d={line(s, bounds[i])} stroke={s.color} strokeWidth="1.7" fill="none" opacity="0.95" />
              <text x={padL - 6} y={padT + i * laneH + 11} textAnchor="end" fontSize="8" fontWeight="700" fill={s.color} style={{ letterSpacing: "0.1em" }}>
                {s.label.toUpperCase()}
              </text>
              {/* latest dot */}
              {n > 0 && Number.isFinite(Number(samples[n - 1]?.[s.key])) && (
                <circle cx={padL + (n - 1) * xStep} cy={toY(Number(samples[n - 1][s.key]), bounds[i])} r="2.5" fill={s.color}>
                  <animate attributeName="r" values="2.5;4.5;2.5" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          ))}
          {/* Cursor spotlight */}
          {cursorX != null && (
            <g>
              <line x1={cursorX} y1={padT} x2={cursorX} y2={H - padB} stroke="#F59E0B" strokeWidth="1" strokeDasharray="3 3" opacity="0.75" />
              {series.map((s, i) => {
                const v = cursorSample ? Number(cursorSample[s.key]) : null;
                if (v == null || !Number.isFinite(v)) return null;
                const y = toY(v, bounds[i]);
                return <circle key={`cur-${s.key}`} cx={cursorX} cy={y} r="3.2" fill={s.color} stroke="#0A1220" strokeWidth="1.5" />;
              })}
            </g>
          )}
          {/* Time axis */}
          <text x={padL} y={H - 7} fontSize="9" fill="#64748B" fontFamily="monospace">T−{n}s</text>
          <text x={W - padR} y={H - 7} textAnchor="end" fontSize="9" fill="#64748B" fontFamily="monospace">now</text>
          {cursorX != null && (
            <text x={cursorX} y={padT - 8} textAnchor="middle" fontSize="9" fontWeight="700" fill="#F59E0B" fontFamily="monospace">
              T{safeCursor === n - 1 ? "0" : `−${n - 1 - safeCursor}s`}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}

/*────────────────────────────────────────────────────────────────────
  MiniWellbore — glanceable 3D trajectory with DLS/Drag coloring and
  animated BHA tip at the current depth. Lives in the LiveOps grid so
  sticky zones (colored segments) correlate visually with the exact
  strip-chart tick on the Rolling Trends panel.
────────────────────────────────────────────────────────────────────*/
const _dlsColor = (dls) => {
  if (dls == null) return "#64748B";
  if (dls < 3)  return "#10B981";
  if (dls < 6)  return "#F59E0B";
  if (dls < 10) return "#FB7185";
  return "#EF4444";
};
const _dragRaw = (st) => {
  const dls = Number(st?.dls_deg_per_100ft) || 0;
  const k = (dls * Math.PI / 180) / 100;
  const inc = (Number(st?.inc_deg) || 0) * Math.PI / 180;
  return k * k + Math.sin(inc) * Math.sin(inc);
};
const _dragColor = (sev) => {
  if (sev == null) return "#64748B";
  if (sev < 0.25) return "#10B981";
  if (sev < 0.50) return "#F59E0B";
  if (sev < 0.75) return "#FB7185";
  return "#EF4444";
};
const _WB_SCALE = 1 / 60;

function _WellboreLines({ survey, depth, colorMode }) {
  const pts = React.useMemo(() => {
    if (!survey?.stations?.length) return [];
    return survey.stations.map((s) => new THREE.Vector3(
      (s.east_ft || 0) * _WB_SCALE,
      -(s.tvd_ft || 0) * _WB_SCALE,
      (s.north_ft || 0) * _WB_SCALE,
    ));
  }, [survey]);
  const dragNorm = React.useMemo(() => {
    if (!survey?.stations?.length) return [];
    const raws = survey.stations.map(_dragRaw);
    const hi = Math.max(1e-9, ...raws);
    return raws.map((r) => r / hi);
  }, [survey]);
  const tip = React.useMemo(() => {
    if (!survey?.stations?.length || !pts.length) return null;
    const sts = survey.stations;
    let i = 0;
    while (i < sts.length - 1 && sts[i + 1].md_ft < depth) i++;
    if (i >= sts.length - 1) return pts[pts.length - 1];
    const a = sts[i], b = sts[i + 1];
    const t = Math.max(0, Math.min(1, (depth - a.md_ft) / Math.max(1, b.md_ft - a.md_ft)));
    return new THREE.Vector3().lerpVectors(pts[i], pts[i + 1], t);
  }, [survey, depth, pts]);
  if (!pts.length) return null;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const st = survey.stations[i + 1];
    const dls = st?.dls_deg_per_100ft ?? 0;
    let color;
    if (colorMode === "drag") color = _dragColor(dragNorm[i + 1] ?? 0);
    else if (colorMode === "combined") color = _dragColor(Math.max(Math.min(1, dls / 12), dragNorm[i + 1] ?? 0));
    else color = _dlsColor(dls);
    segs.push({ a: pts[i], b: pts[i + 1], color });
  }
  return (
    <group>
      {segs.map((s, i) => (
        <Line key={`mws-${i}`} points={[s.a, s.b]} color={s.color} lineWidth={2.3} />
      ))}
      {tip && (
        <mesh position={tip}>
          <sphereGeometry args={[0.45, 16, 16]} />
          <meshStandardMaterial color="#FF6B1A" emissive="#FF6B1A" emissiveIntensity={0.9} />
        </mesh>
      )}
    </group>
  );
}

export function MiniWellbore({ survey, depth = 0, colorMode = "dls", onCycleMode, large = false }) {
  const stations = survey?.stations?.length || 0;
  const hasData = stations > 1;
  const maxMD = hasData ? survey.stations[stations - 1].md_ft : 0;
  const modeLabel = colorMode === "drag" ? "DRAG · JOHANCSIK 1984"
                  : colorMode === "combined" ? "COMBINED SEVERITY"
                  : "DLS · API RP 7G §4";
  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[#0D1A24] text-white rounded-t border-b border-white/5">
        <Compass className="w-3.5 h-3.5 text-[#06B6D4]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">Wellbore · {stations} stn</span>
        {hasData && (
          <button
            data-testid="mini-wellbore-cycle"
            onClick={(e) => { e.stopPropagation(); onCycleMode && onCycleMode(); }}
            className="ml-auto text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/5 border border-white/15 text-[#F59E0B] hover:bg-white/10"
            title="Cycle DLS / Drag / Combined coloring">
            {modeLabel}
          </button>
        )}
      </div>
      <div className="flex-1 bg-[#0A1220] rounded-b overflow-hidden relative">
        {!hasData ? (
          <div className="w-full h-full flex items-center justify-center text-slate-500 text-[11px] px-3 text-center">
            Upload a directional survey on the <b className="text-[#06B6D4]"> Wellbore</b> page to light this panel up.
          </div>
        ) : (
          <>
            <Canvas camera={{ position: [20, 10, 20], fov: 50 }} dpr={[1, 2]}>
              <ambientLight intensity={0.65} />
              <directionalLight position={[20, 30, 20]} intensity={0.75} />
              <Grid args={[30, 30]} position={[0, 0, 0]} cellColor="#1E293B" sectionColor="#334155" />
              <_WellboreLines survey={survey} depth={depth} colorMode={colorMode} />
              <OrbitControls enablePan={false} enableZoom={large} enableRotate autoRotate autoRotateSpeed={0.6} />
            </Canvas>
            <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between text-[9px] font-mono text-slate-500 pointer-events-none">
              <span>MD <b className="text-[#06B6D4]">{Math.round(depth)} ft</b> / {Math.round(maxMD)}</span>
              <span className="text-[#FF6B1A]">● BHA tip</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
