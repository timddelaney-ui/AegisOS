import React, { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Play, Pause, StepForward, StepBack, SkipBack, SkipForward, X, FileUp, Gauge } from "lucide-react";
import { toast } from "sonner";
import { parseJobLog } from "../lib/jobLogParser";

/**
 * Floating Job-Log Playback bar for LiveOps.
 *
 * Accepts drag-and-drop CSV / LAS / WITS field recordings, parses them,
 * then drives an external callback at 1× / 5× / 10× / Step rates so the
 * entire LiveOps dashboard (gauges, strip chart, wellbore BHA tip) scrubs
 * through the recorded data for client reviews.
 *
 * Props:
 *   onSampleTick(sample, index, total)  — called ~ each playback tick
 *   onLoad({ samples, format, filename }) — called after a successful parse
 *   onClose() — called when the user clears the loaded file
 */
export default function JobLogPlayback({ onSampleTick, onLoad, onClose }) {
  const [samples, setSamples] = useState([]);
  const [format, setFormat] = useState("");
  const [filename, setFilename] = useState("");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState("");
  const timerRef = useRef(null);
  const idxRef = useRef(0);
  idxRef.current = idx;

  // ── Playback loop ──
  useEffect(() => {
    if (!playing || samples.length === 0) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    const interval = Math.max(10, Math.round(1000 / speed));  // 1 sample / tick, speed = ticks/s
    timerRef.current = setInterval(() => {
      const next = idxRef.current + 1;
      if (next >= samples.length) {
        setPlaying(false);
        clearInterval(timerRef.current);
        timerRef.current = null;
        toast.success("Playback complete");
        return;
      }
      setIdx(next);
      onSampleTick && onSampleTick(samples[next], next, samples.length);
    }, interval);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, speed, samples, onSampleTick]);

  // ── File ingestion ──
  const ingest = useCallback(async (file) => {
    if (!file) return;
    setErr("");
    try {
      const text = await file.text();
      const { samples: parsed, format: fmt } = parseJobLog(file.name, text);
      setSamples(parsed);
      setFormat(fmt);
      setFilename(file.name);
      setIdx(0);
      setPlaying(false);
      onLoad && onLoad({ samples: parsed, format: fmt, filename: file.name });
      onSampleTick && onSampleTick(parsed[0], 0, parsed.length);
      toast.success(`${fmt} loaded`, {
        description: `${parsed.length.toLocaleString()} samples from ${file.name}`,
        duration: 3500,
      });
    } catch (e) {
      const msg = e?.message || "Could not parse the file.";
      setErr(msg);
      toast.error("Job-log parse failed", { description: msg, duration: 5000 });
    }
  }, [onLoad, onSampleTick]);

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) ingest(file);
  };
  const onInput = (e) => {
    const file = e.target.files?.[0];
    if (file) ingest(file);
  };

  // ── Transport helpers ──
  const jump = (i) => {
    const clamped = Math.max(0, Math.min(samples.length - 1, i));
    setIdx(clamped);
    onSampleTick && onSampleTick(samples[clamped], clamped, samples.length);
  };
  const stepFwd = () => jump(idx + 1);
  const stepBack = () => jump(idx - 1);
  const toggle = () => {
    if (samples.length === 0) return;
    if (!playing && idx >= samples.length - 1) {
      setIdx(0);
      onSampleTick && onSampleTick(samples[0], 0, samples.length);
    }
    setPlaying(!playing);
  };
  const close = () => {
    setPlaying(false);
    setSamples([]);
    setFormat("");
    setFilename("");
    setIdx(0);
    setErr("");
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    onClose && onClose();
  };

  // ── Render: compact drop zone when no file; transport bar when loaded ──
  if (samples.length === 0) {
    return (
      <label
        data-testid="joblog-dropzone"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        htmlFor="joblog-input"
        className={`ca-glass flex items-center gap-2 px-3 py-2 cursor-pointer transition-all ${dragOver ? "ca-glass-cyan border-dashed" : "hover:ca-glass-cyan border-dashed border-white/15"}`}
      >
        <FileUp className={`w-4 h-4 ${dragOver ? "text-[#06B6D4] animate-pulse" : "text-[#F59E0B]"}`} />
        <div className="flex flex-col leading-tight">
          <span className="ca-eyebrow ca-eyebrow-amber">Job-Log Playback</span>
          <span className="text-[11px] text-slate-300">
            {err ? <span className="text-[#EF4444]">{err}</span> : <>Drag a <b className="text-[#06B6D4]">CSV · LAS · WITS</b> file or click to pick · drives all gauges</>}
          </span>
        </div>
        <input id="joblog-input" data-testid="joblog-input" type="file" accept=".csv,.tsv,.txt,.las,.wits" onChange={onInput} className="hidden" />
      </label>
    );
  }

  const pct = samples.length > 1 ? (idx / (samples.length - 1)) * 100 : 0;
  const cur = samples[idx] || {};
  return (
    <div data-testid="joblog-bar" className="ca-glass ca-glass-cyan p-2 flex items-center gap-2 flex-wrap">
      <span className="ca-eyebrow ca-eyebrow-cyan flex items-center gap-1">
        <Gauge className="w-3 h-3" />{format}
      </span>
      <span className="text-[11px] text-slate-200 ca-telemetry">
        <b className="text-white">{filename}</b> · {idx.toLocaleString()} / {samples.length.toLocaleString()}
      </span>

      <div className="flex items-center gap-1 ml-1">
        <button data-testid="joblog-start" onClick={() => jump(0)} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-300" title="Jump to start"><SkipBack className="w-3.5 h-3.5" /></button>
        <button data-testid="joblog-step-back" onClick={stepBack} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-300" title="Step back"><StepBack className="w-3.5 h-3.5" /></button>
        <button
          data-testid="joblog-play"
          onClick={toggle}
          className={`p-1.5 rounded font-bold ${playing ? "bg-[#EF4444] text-white shadow-[0_0_0_1px_rgba(239,68,68,0.5)]" : "bg-[#F59E0B] text-black shadow-[0_0_0_1px_rgba(245,158,11,0.5)]"}`}
          title={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button data-testid="joblog-step-fwd" onClick={stepFwd} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-300" title="Step forward"><StepForward className="w-3.5 h-3.5" /></button>
        <button data-testid="joblog-end" onClick={() => jump(samples.length - 1)} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-300" title="Jump to end"><SkipForward className="w-3.5 h-3.5" /></button>
      </div>

      <div className="inline-flex items-center bg-black/40 rounded-full p-0.5 ml-1">
        {[1, 5, 10].map((s) => (
          <button
            key={s}
            data-testid={`joblog-speed-${s}x`}
            onClick={() => setSpeed(s)}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider transition-all ${speed === s ? "bg-[#06B6D4] text-white shadow-[0_0_0_1px_rgba(6,182,212,0.5)]" : "text-slate-400 hover:text-white"}`}>
            {s}×
          </button>
        ))}
      </div>

      <input
        data-testid="joblog-scrub"
        type="range"
        min={0}
        max={Math.max(0, samples.length - 1)}
        value={idx}
        onChange={(e) => jump(Number(e.target.value))}
        className="flex-1 min-w-[160px] accent-[#F59E0B]"
      />

      <span className="text-[10px] text-slate-400 ca-telemetry tabular-nums w-14 text-right">
        {Math.round(pct)}%
      </span>
      <span className="text-[10px] text-slate-500 ca-telemetry hidden md:inline">
        {cur.depth_ft != null && `${Math.round(cur.depth_ft)} ft · `}
        {cur.weight_lb != null && `${Math.round(cur.weight_lb)} lbs · `}
        {cur.p_internal_psi != null && `${Math.round(cur.p_internal_psi)} psi`}
      </span>

      <button data-testid="joblog-close" onClick={close} className="p-1 rounded bg-white/5 hover:bg-[#EF4444]/20 hover:text-[#EF4444] text-slate-400 ml-1" title="Close playback">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
