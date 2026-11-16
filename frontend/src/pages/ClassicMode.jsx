import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API } from "../context/AuthContext";
import { useCockpitSignals } from "../hooks/useCockpitSignals";
import { STATUS_COLOR, signedFixed, statusFor } from "../lib/cockpitTelemetry";
import { CHANNELS } from "../lib/operatorConfig";
import { DirectionBadge, EncoderBanner, EncoderCounters } from "../components/cockpit/Indicators";
import { enqueue } from "../utils/offlineQueue";
import { useUnits } from "../context/UnitContext";
import UnitSystemSwitcher from "../components/cockpit/UnitSystemSwitcher";

const limits = (key) => { const c = CHANNELS.find((x) => x.key === key); return { warn: c?.warn, crit: c?.crit }; };

function Tile({ label, unit, value, status = "normal", testId, children }) {
  const color = STATUS_COLOR[status];
  return (
    <div className="rounded-2xl border-4 bg-[#0F172A] p-4 flex flex-col justify-between min-h-[160px]" style={{ borderColor: color }} data-testid={testId} data-status={status}>
      <div className="text-sm uppercase tracking-widest text-slate-400">{label}</div>
      <div className="font-mono tabular-nums font-black text-[#F8FAFC] leading-none text-6xl xl:text-7xl break-all" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div className="flex items-center justify-between text-sm"><span className="text-slate-400">{unit}</span><span className="font-bold uppercase" style={{ color }}>{status}</span></div>
      {children}
    </div>
  );
}

export default function ClassicMode() {
  const s = useCockpitSignals();
  const units = useUnits();
  const [log, setLog] = useState([]);
  const note = (label) => setLog((l) => [`${new Date().toLocaleTimeString()} ${label}`, ...l].slice(0, 5));
  const snapshot = () => ({ time: new Date().toISOString(), depth: s.depth, coil: s.pInt, wh: s.pWh, diff: s.dp, weight: s.weight, pump: s.pump });
  const run = async (label, fn) => {
    try { await fn(); note(label); toast.success(`${label} recorded`); } catch { toast.error(`${label} failed`); }
  };
  const [dialog, setDialog] = useState(null);
  const [text, setText] = useState("");
  const act = (type) => {
    if (type === "mark_depth") return run("MARK DEPTH", () => enqueue("job_log", { ...snapshot(), notes: `DEPTH MARK ${units.fmt(s.depth, "depth", { digits: 1 })}` }));
    if (type === "complete_task") {
      return run("COMPLETE TASK", async () => {
        const r = await axios.get(`${API}/tasks`, { params: { status: "open" }, withCredentials: true });
        const t = r.data?.tasks?.[0];
        if (!t) throw new Error("no open task");
        await enqueue("task_completion", { task_id: t.task_id, status: "done" });
      });
    }
    setText("");
    setDialog(type);
  };
  const submitDialog = async () => {
    const value = text.trim();
    if (!value) return;
    const type = dialog;
    setDialog(null);
    if (type === "log_event") await run("LOG EVENT", () => enqueue("job_log", { ...snapshot(), notes: value }));
    else await run("PARTS REQUEST", () => enqueue("parts_request", { kind: "parts_request", title: value, quantity: 1 }));
  };
  const w = s.weight;
  const compression = w !== null && w < 0;
  const actions = [
    ["log_event", "LOG EVENT"], ["mark_depth", "MARK DEPTH"], ["complete_task", "COMPLETE TASK"], ["parts_request", "PARTS / CONSUMABLES REQUEST"],
  ];
  return (
    <div className="min-h-screen bg-[#0B1120] text-[#F8FAFC] p-4 flex flex-col gap-4" data-testid="classic-mode">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="text-lg font-black tracking-widest">PRESSURE CONSOLE</h1>
        <span className="text-xs font-mono text-slate-400">{s.connection}</span>
        <UnitSystemSwitcher />
        <div className="flex items-center gap-2 ml-auto"><DirectionBadge direction={s.direction} /><EncoderCounters encoders={s.encoders} consensus={s.consensus} /></div>
      </header>
      <EncoderBanner consensus={s.consensus} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 flex-1" data-testid="tile-grid">
        <Tile testId="tile-coil" label="Coil Pressure" unit={units.label("pressure")} value={signedFixed(units.from(s.pInt, "pressure"), units.isMetric ? 1 : 0)} status={statusFor(s.pInt, limits("internalPress"))} />
        <Tile testId="tile-wh" label="Wellhead Pressure" unit={units.label("pressure")} value={signedFixed(units.from(s.pWh, "pressure"), units.isMetric ? 1 : 0)} status={statusFor(s.pWh, limits("whp"))} />
        <Tile testId="tile-diff" label="Differential Pressure" unit={units.label("pressure")} value={signedFixed(units.from(s.dp, "pressure"), units.isMetric ? 1 : 0)} status={statusFor(s.dp, { warn: 4000, crit: 6000 })} />
        <Tile testId="tile-weight" label="Weight" unit={units.label("weight")} value={signedFixed(units.from(w, "weight"), units.isMetric ? 1 : 0)} status={compression ? "warning" : statusFor(w, limits("dhTension"))}>
          {compression && <div className="text-xs text-amber-300 font-bold">COMPRESSION / SNUBBING</div>}
        </Tile>
        <Tile testId="tile-depth" label="Depth" unit={units.label("depth")} value={signedFixed(units.from(s.depth, "depth"), 1)} />
        <Tile testId="tile-pump" label="Pump Rate" unit={units.label("flow_bpm")} value={signedFixed(units.from(s.pump, "flow_bpm"), 1)} status={statusFor(s.pump, limits("slurryRate"))} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="toolbar" aria-label="Quick actions">
        {actions.map(([type, label]) => (
          <button key={type} type="button" onClick={() => act(type)}
            className="min-h-[64px] rounded-xl border-2 border-cyan-500 bg-[#0F172A] text-cyan-200 font-black tracking-wide hover:bg-cyan-500/10">{label}</button>
        ))}
      </div>
      {dialog && (
        <form role="dialog" aria-label={dialog === "log_event" ? "Log event" : "Parts request"} className="flex flex-wrap gap-2 items-center rounded-xl border-2 border-cyan-500 bg-[#0F172A] p-3"
          onSubmit={(e) => { e.preventDefault(); submitDialog(); }}>
          <label className="text-sm text-slate-300" htmlFor="classic-dialog-input">{dialog === "log_event" ? "Event description" : "Part / consumable needed"}</label>
          <input id="classic-dialog-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setDialog(null)}
            className="flex-1 min-w-[220px] bg-[#0B1120] border border-[#475569] text-[#F8FAFC] rounded px-3 py-2" />
          <button type="submit" className="px-4 py-2 rounded border border-cyan-500 text-cyan-200 font-bold">Submit</button>
          <button type="button" onClick={() => setDialog(null)} className="px-4 py-2 rounded border border-slate-600 text-slate-300">Cancel</button>
        </form>
      )}
      {log.length > 0 && <ul className="text-xs font-mono text-slate-400">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}
