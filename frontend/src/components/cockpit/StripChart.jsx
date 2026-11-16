import React, { useEffect, useRef, useState } from "react";
import { WINDOWS } from "../../lib/cockpitTelemetry";

export const PENS = [
  { key: "pInt", label: "Coil Pressure", unit: "psi", color: "#22D3EE" },
  { key: "pWh", label: "Wellhead Pressure", unit: "psi", color: "#F59E0B" },
  { key: "dp", label: "Differential Pressure", unit: "psi", color: "#A78BFA" },
  { key: "weight", label: "Weight / Hookload", unit: "lbf", color: "#34D399" },
];

const fmt = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : "—");

export default function StripChart({ samples, version, current }) {
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState({ pInt: true, pWh: true, dp: true, weight: true });
  const [win, setWin] = useState("15m");
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    const { width: W, height: H } = canvas;
    ctx.fillStyle = "#0F172A"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo((W * i) / 10, 0); ctx.lineTo((W * i) / 10, H); ctx.stroke(); }
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, (H * i) / 5); ctx.lineTo(W, (H * i) / 5); ctx.stroke(); }
    const now = Date.now();
    const span = WINDOWS[win];
    const pts = samples.filter((s) => now - s.ts <= span);
    PENS.filter((p) => visible[p.key]).forEach((pen) => {
      const vals = pts.map((s) => s[pen.key]).filter(Number.isFinite);
      if (!vals.length) return;
      let lo = Math.min(...vals); let hi = Math.max(...vals);
      if (hi - lo < 1) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
      if (lo < 0 && hi > 0) { // zero line for pens that cross negative
        ctx.strokeStyle = pen.color + "55"; ctx.setLineDash([4, 4]);
        const zy = H - ((0 - lo) / (hi - lo)) * H;
        ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.strokeStyle = pen.color; ctx.lineWidth = 1.6; ctx.beginPath();
      let started = false;
      pts.forEach((s) => {
        const v = s[pen.key]; if (!Number.isFinite(v)) return;
        const x = W - ((now - s.ts) / span) * W; const y = H - ((v - lo) / (hi - lo)) * H;
        if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
      });
      ctx.stroke();
    });
    if (hover) {
      ctx.strokeStyle = "#F8FAFC"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hover.x * (W / hover.cw), 0); ctx.lineTo(hover.x * (W / hover.cw), H); ctx.stroke();
    }
  }, [samples, version, win, visible, hover]);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = Date.now() - (1 - x / r.width) * WINDOWS[win];
    let best = null;
    for (const s of samples) if (!best || Math.abs(s.ts - t) < Math.abs(best.ts - t)) best = s;
    setHover(best ? { x, cw: r.width, sample: best } : null);
  };

  return (
    <div className="flex flex-col gap-2 h-full" data-testid="strip-chart">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {PENS.map((p) => {
          const v = hover?.sample ? hover.sample[p.key] : current[p.key];
          return (
            <button key={p.key} type="button" aria-pressed={visible[p.key]} data-testid={`pen-toggle-${p.key}`}
              onClick={() => setVisible((s) => ({ ...s, [p.key]: !s[p.key] }))}
              className="text-left rounded-lg border px-3 py-2 bg-[#0F172A]"
              style={{ borderColor: visible[p.key] ? p.color : "#334155", opacity: visible[p.key] ? 1 : 0.45 }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: p.color }}>{p.label}</div>
              <div className="font-mono tabular-nums text-2xl font-bold text-[#F8FAFC]">{fmt(v)} <span className="text-xs text-slate-400">{p.unit}</span></div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-1 text-xs" role="group" aria-label="Time window">
        {Object.keys(WINDOWS).map((w) => (
          <button key={w} type="button" onClick={() => setWin(w)} aria-pressed={win === w}
            className={`px-3 py-1 rounded border ${win === w ? "bg-cyan-500 text-slate-950 border-cyan-400" : "border-slate-600 text-slate-300"}`}>{w}</button>
        ))}
        {hover?.sample && <span className="ml-auto font-mono text-slate-300">{new Date(hover.sample.ts).toLocaleTimeString()} · depth {fmt(hover.sample.depth)} ft</span>}
      </div>
      <canvas ref={canvasRef} width={1000} height={320} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        className="w-full flex-1 min-h-[240px] rounded-lg border border-slate-700 cursor-crosshair" aria-label="Real-time strip chart" />
    </div>
  );
}
