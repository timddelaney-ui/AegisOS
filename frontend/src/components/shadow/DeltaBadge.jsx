import React from "react";
import { STATUS, classifyDelta, exceedsAlert } from "../../lib/shadow/variance";

/** Colour-coded delta chip. Fixed min-width so values never shift layout. */
export default function DeltaBadge({ delta, status, className = "" }) {
  const s = STATUS[status || classifyDelta(delta)];
  const label = delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`;
  return (
    <span
      data-testid="delta-badge"
      data-status={status || classifyDelta(delta)}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-xs font-bold tabular-nums min-w-[84px] ${exceedsAlert(delta) ? "ring-1" : ""} ${className}`}
      style={{ color: s.color, background: s.bg, "--tw-ring-color": s.color }}
      title={`${s.label}${exceedsAlert(delta) ? " — exceeds 2% field verification threshold" : ""}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {label}
    </span>
  );
}
