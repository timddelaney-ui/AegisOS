import React from "react";
import { STATUS, GREEN_MAX_PCT, AMBER_MAX_PCT } from "../../lib/shadow/variance";

const RANGE = 5; // gauge spans ±5 %
const W = 240;
const xOf = (pct) => ((Math.max(-RANGE, Math.min(RANGE, pct)) + RANGE) / (2 * RANGE)) * W;

/** Horizontal delta gauge with green/amber/red bands. Fixed viewBox → zero layout shift. */
export default function DeltaGauge({ delta, status = "na", label }) {
  const bands = [
    [-RANGE, -AMBER_MAX_PCT, "red"], [-AMBER_MAX_PCT, -GREEN_MAX_PCT, "amber"], [-GREEN_MAX_PCT, GREEN_MAX_PCT, "green"],
    [GREEN_MAX_PCT, AMBER_MAX_PCT, "amber"], [AMBER_MAX_PCT, RANGE, "red"],
  ];
  const has = delta != null && Number.isFinite(delta);
  return (
    <svg viewBox={`0 0 ${W} 34`} className="block h-9 w-full" role="img" aria-label={label || `Delta ${has ? delta.toFixed(2) : "n/a"} percent`}>
      {bands.map(([a, b, s]) => (
        <rect key={`${a}-${b}`} x={xOf(a)} y={14} width={xOf(b) - xOf(a)} height={8} fill={STATUS[s].color} opacity={0.35} />
      ))}
      <line x1={W / 2} x2={W / 2} y1={10} y2={26} stroke="#94A3B8" strokeWidth={1} />
      {[-RANGE, 0, RANGE].map((t) => (
        <text key={t} x={xOf(t)} y={33} textAnchor={t < 0 ? "start" : t > 0 ? "end" : "middle"} fontSize={7} fill="#94A3B8">{t > 0 ? `+${t}%` : `${t}%`}</text>
      ))}
      {has && (
        <g className="cab-marker" style={{ transform: `translateX(${xOf(delta)}px)` }}>
          <path d="M0 6 L5 0 L-5 0 Z" transform="translate(0 6)" fill={STATUS[status].color} />
          <rect x={-1.5} y={12} width={3} height={12} rx={1.5} fill={STATUS[status].color} />
        </g>
      )}
    </svg>
  );
}
