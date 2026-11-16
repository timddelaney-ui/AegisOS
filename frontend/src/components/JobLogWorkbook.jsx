import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API, useAuth } from "../context/AuthContext";
import { FluidTotalizersPanel } from "./operator/FluidTotalizersPanel";
import { enqueue } from "../utils/offlineQueue";
import { diffPressure } from "../lib/cockpitTelemetry";

const TABS = ["Operations Log", "Tasks & Assignments", "Parts & Consumables", "Fluids & Totals", "Shift Handover"];
const ROWS_KEY = "aegis_joblog_rows_v1";
export const COLUMNS = [
  { key: "time", label: "Time" },
  { key: "depth", label: "Depth", numeric: true },
  { key: "coil", label: "Coil Press", numeric: true },
  { key: "wh", label: "WH Press", numeric: true },
  { key: "diff", label: "Diff Press", numeric: true },
  { key: "weight", label: "Weight", numeric: true },
  { key: "pump", label: "Pump Rate", numeric: true },
  { key: "notes", label: "Activity / Notes", wide: true },
  { key: "by", label: "Logged By" },
  { key: "status", label: "Status" },
];
const NUMERIC_RE = /^-?\d*\.?\d*$/;
const cellCls = "w-full bg-[#0F172A] text-[#F8FAFC] border border-[#475569] px-2 py-1 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400";
const inputCls = "bg-[#0F172A] text-[#F8FAFC] border border-[#475569] rounded px-2 py-1 text-sm";
const btn = "px-3 py-1.5 rounded border border-cyan-500 text-cyan-300 text-sm font-semibold hover:bg-cyan-500/10 disabled:opacity-40";

const nowStr = () => new Date().toLocaleTimeString([], { hour12: false });
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blankRow = (by = "") => ({ id: rid(), time: nowStr(), depth: "", coil: "", wh: "", diff: "", weight: "", pump: "", notes: "", by, status: "Draft", synced: false });
const r0 = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? String(Math.round(Number(v) * 10) / 10) : "");

function loadRows() {
  try { const v = JSON.parse(localStorage.getItem(ROWS_KEY)); if (Array.isArray(v)) return v; } catch { /* fresh log */ }
  return [];
}

// Persist via API when reachable; otherwise queue. 404/405 = no job-log endpoint, stay local.
async function persistRow(row) {
  const { synced, ...payload } = row;
  if (typeof navigator !== "undefined" && navigator.onLine === false) { await enqueue("job_log", payload); return "queued"; }
  try {
    await axios.post(`${API}/job-log/rows`, payload, { withCredentials: true });
    return "sent";
  } catch (e) {
    const code = e?.response?.status;
    if (code === 404 || code === 405) return "local";
    if (code && code < 500) return "rejected";
    await enqueue("job_log", payload);
    return "queued";
  }
}

function OperationsLog({ signals }) {
  const { user } = useAuth();
  const by = user?.name || "";
  const [rows, setRows] = useState(loadRows);
  const [state, setState] = useState({});
  const gridRef = useRef(null);
  useEffect(() => { try { localStorage.setItem(ROWS_KEY, JSON.stringify(rows.slice(-500))); } catch { /* storage full */ } }, [rows]);

  const focusCell = (r, c) => gridRef.current?.querySelector(`[data-cell="${r}-${c}"]`)?.focus();
  const addRow = (row) => { setRows((rs) => [...rs, row]); return row; };
  const update = (id, key, value) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value, synced: false } : r)));
  const commit = async (row) => {
    const res = await persistRow(row);
    setState((s) => ({ ...s, [row.id]: res }));
    if (res === "queued") toast.info("Offline — row queued for sync");
  };
  const stamp = () => {
    const row = blankRow(by);
    Object.assign(row, {
      depth: r0(signals?.depth), coil: r0(signals?.pInt), wh: r0(signals?.pWh),
      diff: r0(diffPressure(signals?.pInt, signals?.pWh)), weight: r0(signals?.weight), pump: r0(signals?.pump),
      notes: `Telemetry stamp (${signals?.direction || "—"})`, synced: true,
    });
    addRow(row); commit(row);
  };

  const onKeyDown = (e, r, c) => {
    const el = e.target;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length;
    const move = (nr, nc) => { e.preventDefault(); focusCell(nr, nc); };
    if (e.key === "Enter" || e.key === "ArrowDown") move(Math.min(r + 1, rows.length - 1), c);
    else if (e.key === "ArrowUp") move(Math.max(r - 1, 0), c);
    else if (e.key === "ArrowRight" && atEnd && c < COLUMNS.length - 1) move(r, c + 1);
    else if (e.key === "ArrowLeft" && atStart && c > 0) move(r, c - 1);
    else if (e.key === "Tab" && !e.shiftKey && c === COLUMNS.length - 1 && r < rows.length - 1) move(r + 1, 0);
    else if (e.key === "Tab" && e.shiftKey && c === 0 && r > 0) move(r - 1, COLUMNS.length - 1);
  };

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <button type="button" className={btn} onClick={() => addRow(blankRow(by))}>+ Add Row</button>
        <button type="button" className={btn} onClick={stamp}>Stamp Live Telemetry</button>
      </div>
      <div className="overflow-auto max-h-[360px] border border-[#475569] rounded" ref={gridRef}>
        <table className="min-w-full border-collapse" data-testid="ops-log-grid">
          <thead>
            <tr>{COLUMNS.map((c) => <th key={c.key} className="sticky top-0 z-10 bg-[#1E293B] text-slate-200 text-xs text-left px-2 py-1.5 border border-[#475569]">{c.label}</th>)}<th className="sticky top-0 z-10 bg-[#1E293B] text-xs px-2 border border-[#475569]">Sync</th></tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.id}>
                {COLUMNS.map((c, ci) => (
                  <td key={c.key} className={`p-0 ${c.wide ? "min-w-[240px]" : "min-w-[90px]"}`}>
                    <input className={cellCls} value={row[c.key]} data-cell={`${r}-${ci}`} aria-label={`${c.label} row ${r + 1}`}
                      inputMode={c.numeric ? "decimal" : undefined}
                      onChange={(e) => { if (!c.numeric || NUMERIC_RE.test(e.target.value)) update(row.id, c.key, e.target.value); }}
                      onBlur={() => { if (!row.synced && state[row.id] !== "sent") { commit(row); setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, synced: true } : x))); } }}
                      onKeyDown={(e) => onKeyDown(e, r, ci)} />
                  </td>
                ))}
                <td className="px-2 text-[10px] text-slate-400 border border-[#475569]">{state[row.id] || (row.synced ? "saved" : "")}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={COLUMNS.length + 1} className="text-center text-slate-400 text-sm py-4">No entries yet — Add Row or Stamp Live Telemetry.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

function TasksTab() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const refresh = useCallback(async () => {
    try { const r = await axios.get(`${API}/tasks`, { withCredentials: true }); setTasks(r.data?.tasks || []); } catch { /* offline: keep list */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const add = async () => {
    if (!title.trim()) return;
    try { await axios.post(`${API}/tasks`, { title: title.trim() }, { withCredentials: true }); setTitle(""); await refresh(); }
    catch { toast.error("Could not create task (offline or not permitted)"); }
  };
  const complete = async (t) => {
    const payload = { task_id: t.task_id, status: "done" };
    const queue = async () => { await enqueue("task_completion", payload); setTasks((l) => l.map((x) => (x.task_id === t.task_id ? { ...x, status: "done" } : x))); toast.info("Offline — completion queued"); };
    if (isOffline()) return queue();
    try { await axios.patch(`${API}/tasks/${t.task_id}`, { status: "done" }, { withCredentials: true }); await refresh(); }
    catch (e) { if (!e?.response) await queue(); else toast.error("Request failed"); }
  };
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input className={`${inputCls} flex-1`} placeholder="New task / assignment" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="New task title" />
        <button type="button" className={btn} onClick={add}>Add Task</button>
      </div>
      <ul className="divide-y divide-slate-700 max-h-[300px] overflow-auto">
        {tasks.map((t) => (
          <li key={t.task_id} className="flex items-center gap-3 py-1.5 text-sm text-[#F8FAFC]">
            <span className={`flex-1 ${t.status === "done" ? "line-through text-slate-500" : ""}`}>{t.title}</span>
            <span className="text-xs text-slate-400">{t.assignee_name || t.assignee_user_id || ""}</span>
            <span className="text-xs font-mono text-slate-300">{t.status}</span>
            {t.status !== "done" && <button type="button" className={btn} onClick={() => complete(t)}>Complete</button>}
          </li>
        ))}
        {!tasks.length && <li className="text-slate-400 text-sm py-3">No tasks.</li>}
      </ul>
    </div>
  );
}

const PART_KINDS = ["parts_request", "consumable", "inventory_update"];
function PartsTab() {
  const [kind, setKind] = useState(PART_KINDS[0]);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("1");
  const [list, setList] = useState([]);
  const submit = async () => {
    if (!item.trim()) return;
    const payload = { kind, title: item.trim(), quantity: Number(qty) || 1, rig_id: localStorage.getItem("aegis_cockpit_rig_id") || undefined };
    const entry = { id: rid(), kind, item: payload.title, quantity: payload.quantity, status: "pending" };
    const set = (status) => setList((l) => [{ ...entry, status }, ...l.filter((x) => x.id !== entry.id)]);
    setItem("");
    if (isOffline()) { await enqueue("parts_request", payload); set("queued (offline)"); return; }
    try {
      const r = await axios.post(`${API}/approvals/requests`, payload, { withCredentials: true });
      set(r.data?.status || "submitted");
    } catch (e) {
      if (!e?.response) { await enqueue("parts_request", payload); set("queued (offline)"); } else { set("failed"); toast.error("Request failed"); }
    }
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Request kind">{PART_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <input className={`${inputCls} flex-1`} placeholder="Part / consumable" value={item} onChange={(e) => setItem(e.target.value)} aria-label="Item" />
        <input className={`${inputCls} w-20`} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} aria-label="Quantity" />
        <button type="button" className={btn} onClick={submit}>Submit Request</button>
      </div>
      <ul className="text-sm text-[#F8FAFC] divide-y divide-slate-700">
        {list.map((x) => <li key={x.id} className="py-1.5 flex gap-3"><span className="text-xs font-mono text-slate-400">{x.kind}</span><span className="flex-1">{x.item} × {x.quantity}</span><span className="text-xs text-cyan-300" data-testid="parts-status">{x.status}</span></li>)}
      </ul>
    </div>
  );
}

function HandoverTab({ signals }) {
  const [notes, setNotes] = useState("");
  const send = async () => {
    let openTasks = [];
    try { const t = await axios.get(`${API}/tasks`, { params: { status: "open" }, withCredentials: true }); openTasks = (t.data?.tasks || []).map((x) => x.title).slice(0, 100); } catch { /* optional */ }
    const num = (v) => (Number.isFinite(v) ? v : null);
    const payload = {
      rig_id: localStorage.getItem("aegis_cockpit_rig_id") || undefined,
      depth_ft: num(signals?.depth), coil_pressure_psi: num(signals?.pInt), wh_pressure_psi: num(signals?.pWh),
      diff_pressure_psi: num(signals?.dp), weight_lbf: num(signals?.weight),
      open_tasks: openTasks, note: notes.slice(0, 2000) || undefined,
    };
    try {
      const r = await axios.post(`${API}/handovers/send`, payload, { withCredentials: true });
      if (r.data?.mode === "live") toast.success(r.data.message || "Handover dispatched");
      else toast.info(r.data?.message || "Sandbox mode: handover stored, not sent");
    } catch (e) {
      toast.error(!e?.response || isOffline() ? "Offline — handover not sent; retry when connected" : "Handover failed");
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <textarea className={`${inputCls} min-h-[120px]`} placeholder="Shift handover notes: status, hazards, outstanding tasks…" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Handover notes" />
      <div><button type="button" className={btn} onClick={send}>Send Handover</button></div>
    </div>
  );
}

export default function JobLogWorkbook({ signals }) {
  const [tab, setTab] = useState(TABS[0]);
  return (
    <div className="w-full text-[#F8FAFC]" data-testid="job-log-workbook">
      <div role="tablist" className="flex flex-wrap gap-1 mb-3 border-b border-slate-700">
        {TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-t border-b-2 ${tab === t ? "border-cyan-400 text-cyan-300" : "border-transparent text-slate-400"}`}>{t}</button>
        ))}
      </div>
      {tab === TABS[0] && <OperationsLog signals={signals} />}
      {tab === TABS[1] && <TasksTab />}
      {tab === TABS[2] && <PartsTab />}
      {tab === TABS[3] && <FluidTotalizersPanel telemetry={signals?.telemetry || {}} />}
      {tab === TABS[4] && <HandoverTab signals={signals} />}
    </div>
  );
}
