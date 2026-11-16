import React, { useEffect, useMemo, useRef, useState } from "react";
import { WINDOWS } from "../../lib/cockpitTelemetry";
import { PENS, chartDomains, nearestSample, traceSegments, windowSamples } from "../../lib/stripChart";
import { useUnits } from "../../context/UnitContext";

export { PENS } from "../../lib/stripChart";
const MARGIN = { left: 72, right: 80, top: 26, bottom: 32 };
const tick = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const timeLabel = (time) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export default function StripChart({ samples, version, current }) {
  const units = useUnits();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 1000, height: 340 });
  const [visible, setVisible] = useState({ pInt: true, pWh: true, dp: true, weight: true });
  const [win, setWin] = useState("10m");
  const [hoverTime, setHoverTime] = useState(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const { start, end, points, domains } = useMemo(() => {
    const end = now;
    const start = end - WINDOWS[win];
    return { start, end, points: windowSamples(samples, start, end), domains: chartDomains(samples) };
    // Samples are held in a telemetry ref; version signals new samples.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, version, win, now]);
  const hover = hoverTime === null ? null : nearestSample(points, hoverTime);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const resize = () => {
      const width = Math.max(280, Math.round(node.getBoundingClientRect().width) || 1000);
      setSize({ width, height: width < 600 ? 280 : 340 });
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(node);
    window.addEventListener("resize", resize);
    return () => { observer?.disconnect(); window.removeEventListener("resize", resize); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    const { width, height } = size;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    ctx.fillStyle = "#080E19";
    ctx.fillRect(0, 0, width, height);
    ctx.font = "11px monospace";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 5; i++) {
      const y = MARGIN.top + plotHeight * i / 5;
      ctx.strokeStyle = "#263244";
      ctx.beginPath(); ctx.moveTo(MARGIN.left, y); ctx.lineTo(width - MARGIN.right, y); ctx.stroke();
      for (const [dim, x, align, color] of [
        ["pressure", MARGIN.left - 8, "right", "#CBD5E1"],
        ["weight", width - MARGIN.right + 8, "left", "#4ADE80"],
      ]) {
        const [lo, hi] = domains[dim];
        ctx.fillStyle = color; ctx.textAlign = align;
        ctx.fillText(tick(units.from(hi - (hi - lo) * i / 5, dim)), x, y);
      }
    }
    const timeTicks = width < 600 ? 2 : 5;
    for (let i = 0; i <= timeTicks; i++) {
      const x = MARGIN.left + plotWidth * i / timeTicks;
      ctx.strokeStyle = "#263244";
      ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, height - MARGIN.bottom); ctx.stroke();
      ctx.textAlign = i === 0 ? "left" : i === timeTicks ? "right" : "center";
      ctx.fillStyle = "#94A3B8";
      ctx.fillText(timeLabel(start + (end - start) * i / timeTicks), x, height - 12);
    }
    ctx.textAlign = "left"; ctx.fillStyle = "#CBD5E1";
    ctx.fillText(`Pressure (${units.label("pressure")})`, MARGIN.left, 12);
    ctx.textAlign = "right"; ctx.fillStyle = "#4ADE80";
    ctx.fillText(`Weight (${units.label("weight")})`, width - MARGIN.right, 12);
    ctx.save();
    ctx.beginPath(); ctx.rect(MARGIN.left, MARGIN.top, plotWidth, plotHeight); ctx.clip();
    ctx.translate(MARGIN.left, MARGIN.top);
    if (domains.pressure[0] < 0) {
      const [lo, hi] = domains.pressure;
      const y = plotHeight - (0 - lo) / (hi - lo) * plotHeight;
      ctx.strokeStyle = "#94A3B8"; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotWidth, y); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const pen of PENS.filter((p) => visible[p.key])) {
      ctx.strokeStyle = pen.color; ctx.fillStyle = pen.color; ctx.lineWidth = 1.8;
      for (const segment of traceSegments(points, pen.key, start, end, domains[pen.dim], plotWidth, plotHeight)) {
        if (segment.length === 1) {
          ctx.beginPath(); ctx.arc(segment[0].x, segment[0].y, 2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.beginPath();
          segment.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
          ctx.stroke();
        }
      }
    }
    if (hover) {
      const x = (hover.ts - start) / (end - start) * plotWidth;
      ctx.strokeStyle = "#F8FAFC"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotHeight); ctx.stroke();
    }
    ctx.restore();
  }, [points, domains, start, end, size, visible, hover, units]);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) * size.width / rect.width;
    const fraction = (x - MARGIN.left) / (size.width - MARGIN.left - MARGIN.right);
    setHoverTime(fraction < 0 || fraction > 1 ? null : start + fraction * (end - start));
  };

  return (
    <div className="flex flex-col gap-2 h-full min-w-0" data-testid="strip-chart">
      <h2 className="text-xs font-bold tracking-wide text-slate-300">REAL-TIME TELEMETRY STRIP CHART</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {PENS.map((pen) => {
          const value = hover ? hover[pen.key] : current[pen.key];
          return (
            <button key={pen.key} type="button" aria-pressed={visible[pen.key]} data-testid={`pen-toggle-${pen.key}`}
              onClick={() => setVisible((s) => ({ ...s, [pen.key]: !s[pen.key] }))}
              className="min-w-0 text-left rounded-lg border px-2 py-2 bg-[#0F172A]"
              style={{ borderColor: visible[pen.key] ? pen.color : "#334155", opacity: visible[pen.key] ? 1 : 0.45 }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: pen.color }}>{pen.label}</div>
              <div className="font-mono tabular-nums text-xl font-bold text-[#F8FAFC]">{units.fmt(value, pen.dim, { digits: units.isMetric ? 1 : 0, suffix: false })} <span className="text-xs text-slate-400">{units.label(pen.dim)}</span></div>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs" role="group" aria-label="Time window">
        {Object.keys(WINDOWS).map((w) => (
          <button key={w} type="button" onClick={() => { setWin(w); setHoverTime(null); }} aria-pressed={win === w}
            className={`px-3 py-1 rounded border ${win === w ? "bg-cyan-500 text-slate-950 border-cyan-400" : "border-slate-600 text-slate-300"}`}>{w}</button>
        ))}
        {hover && <span className="ml-auto font-mono text-slate-300">{new Date(hover.ts).toLocaleTimeString()} · depth {units.fmt(hover.depth, "depth")}</span>}
      </div>
      <div ref={containerRef} className="min-w-0 w-full">
        <canvas ref={canvasRef} onPointerMove={onMove} onPointerLeave={() => setHoverTime(null)}
          style={{ width: "100%", height: size.height }} className="block rounded-lg border border-slate-700 cursor-crosshair"
          role="img" aria-label={`Real-time strip chart: pressure in ${units.label("pressure")}, weight in ${units.label("weight")}, ${win} window`} />
      </div>
      <p className="text-[10px] text-slate-400">Shared pressure scale · weight on right axis · gaps over 30 seconds shown as breaks · no smoothing</p>
    </div>
  );
}
