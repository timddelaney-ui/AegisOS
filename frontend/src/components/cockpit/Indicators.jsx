import React from "react";
import { ENCODER_LABELS, ENCODER_THRESHOLD_FT } from "../../lib/cockpitTelemetry";

export function DirectionBadge({ direction }) {
  const glyph = direction === "RIH" ? "▼" : direction === "POOH" ? "▲" : "■";
  const cls = direction === "RIH" ? "text-emerald-300 border-emerald-500" : direction === "POOH" ? "text-amber-300 border-amber-500" : "text-slate-400 border-slate-600";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono font-bold text-sm ${cls}`} data-testid="direction-indicator">
      <span aria-hidden>{glyph}</span> {direction}
    </span>
  );
}

export function EncoderBanner({ consensus }) {
  if (!consensus.mismatch) return null;
  return (
    <div role="alert" className="bg-red-950 border border-red-500 text-red-200 rounded px-3 py-1.5 text-sm font-mono" data-testid="encoder-warning">
      ENCODER CONSENSUS WARNING: max spread {consensus.maxDeltaFt.toFixed(2)} ft &gt; {ENCODER_THRESHOLD_FT.toFixed(1)} ft — check traction wheel slip / gooseneck / levelwind.
    </div>
  );
}

export function EncoderCounters({ encoders, consensus }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="encoder-counters">
      {ENCODER_LABELS.map((label, i) => (
        <div key={label} className={`rounded border px-2 py-1 bg-[#0F172A] ${consensus.mismatch ? "border-red-500" : "border-slate-600"}`}>
          <div className="text-[10px] text-slate-400">{label}</div>
          <div className="font-mono tabular-nums text-sm text-[#F8FAFC]">{Number.isFinite(encoders[i]) ? `${encoders[i].toFixed(1)} ft` : "—"}</div>
        </div>
      ))}
    </div>
  );
}
