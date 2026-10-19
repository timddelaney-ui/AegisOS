import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, ClipboardList, Play, Square, Send, Trash2,
  Copy, Printer, RefreshCw, User, Pencil, Check, X, Zap, Clock,
  Star, AlertTriangle, StickyNote, Columns,
} from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";
import RigSelector from "../components/RigSelector";
import { usePullToRefresh, PullIndicator } from "../hooks/usePullToRefresh";
import { fmtTime as fmtClock, fmtShort as fmtTime } from "../lib/timeFormat";
import LiveStripSidebar from "../components/LiveStripSidebar";
import { OPERATION_CODE_BY_NUM, PHASE_COLOR } from "../lib/operationCodes";

const POLL_MS = 3000;

// Entry kinds — a plain note vs. significant operational event vs. non-productive time
const ENTRY_KINDS = [
  { id: "note",  label: "Note",  Icon: StickyNote,    color: "#6B7280", chipBg: "#F3F4F6" },
  { id: "event", label: "Event", Icon: Star,          color: "#F59E0B", chipBg: "#FEF3C7" },
  { id: "npt",   label: "NPT",   Icon: AlertTriangle, color: "#DC2626", chipBg: "#FEE2E2" },
];
const KIND_META = Object.fromEntries(ENTRY_KINDS.map((k) => [k.id, k]));

const NPT_CATEGORIES = [
  { id: "equipment",    label: "Equipment" },
  { id: "weather",      label: "Weather" },
  { id: "wait_on_well", label: "Wait on well" },
  { id: "hse",          label: "HSE" },
  { id: "other",        label: "Other" },
];
const NPT_LABEL = Object.fromEntries(NPT_CATEGORIES.map((n) => [n.id, n.label]));

// 24-hour "HH:MM:SS" clock for the vertical stamp bar beside each entry.
const stampBar = (iso) => fmtClock(iso);

const StartCard = ({ rigId, onStarted }) => {
  const [name, setName] = useState("");
  const [wellNo, setWellNo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!name.trim()) { toast.error("Give it a name (well number, job, etc.)"); return; }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/treatments`, {
        rig_id: rigId,
        name: name.trim(),
        well_or_job_no: wellNo.trim() || null,
        note: note.trim() || null,
      }, { withCredentials: true });
      toast.success(`Treatment started: ${data.name}`);
      onStarted(data);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to start."); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-[#D4D4D4] rounded-lg p-4 space-y-3" data-testid="treatment-start-card">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-5 h-5 text-[#C44A08]" />
        <h2 className="text-sm font-bold text-[#C44A08]">Start a new treatment on {rigLabel(rigId)}</h2>
      </div>
      <p className="text-[12px] text-[#595959]">
        Everyone on the rig sees your notes in near-real time on mobile and desktop. One active treatment per rig — starting a new one closes any prior open log.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input data-testid="treatment-name" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Treatment name (e.g. Sand cleanout · 4-32-45-06W5) *"
          className="col-span-2 px-2.5 py-2 border border-[#CCC] rounded text-sm" />
        <input data-testid="treatment-well" value={wellNo} onChange={(e) => setWellNo(e.target.value)}
          placeholder="Well / Job # (optional)"
          className="px-2.5 py-2 border border-[#CCC] rounded text-sm" />
        <input data-testid="treatment-note" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Kick-off note (optional)"
          className="px-2.5 py-2 border border-[#CCC] rounded text-sm" />
      </div>
      <button data-testid="treatment-start" disabled={busy || !name.trim()} onClick={start}
        className="text-sm font-bold text-white bg-[#C44A08] hover:bg-[#0A4F28] px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Play className="w-4 h-4" /> Start treatment</>}
      </button>
    </div>
  );
};

const toLocalDTInput = (iso) => {
  // Converts ISO/timestamp -> datetime-local input value "YYYY-MM-DDTHH:MM"
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalDTInput = (s) => (s ? new Date(s).toISOString() : null);

const EntryComposer = ({ treatmentId, onAdded }) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [eventAt, setEventAt] = useState(() => toLocalDTInput());
  const [quickStamping, setQuickStamping] = useState(false);
  const [kind, setKind] = useState("note");
  const [nptCategory, setNptCategory] = useState("equipment");
  const [nptMinutes, setNptMinutes] = useState("");
  const inputRef = useRef(null);

  const send = async (overrideText) => {
    const t = (overrideText ?? text).trim();
    if (!t) return;
    if (kind === "npt" && (!nptMinutes || Number(nptMinutes) <= 0)) {
      toast.error("NPT requires a duration in minutes.");
      return;
    }
    setBusy(true);
    try {
      const body = { text: t, kind };
      if (useCustomTime && eventAt) body.event_at = fromLocalDTInput(eventAt);
      if (kind === "npt") {
        body.npt_category = nptCategory;
        body.npt_minutes = Number(nptMinutes);
      }
      const { data } = await axios.post(`${API}/treatments/${treatmentId}/entries`, body, { withCredentials: true });
      if (overrideText === undefined) {
        setText("");
        setKind("note");
        setNptMinutes("");
      }
      setUseCustomTime(false);
      setEventAt(toLocalDTInput());
      onAdded(data);
      inputRef.current?.focus();
      return data;
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to log entry."); return null; }
    finally { setBusy(false); }
  };

  // Quick-stamp: drop a timestamped marker in one tap, fill in later from phone or desktop.
  const quickStamp = async () => {
    setQuickStamping(true);
    try {
      const stamp = new Date();
      const hhmm = `${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}`;
      const placeholder = `⏱ ${hhmm} — (fill in later)`;
      await send(placeholder);
      toast.success(`Stamped ${hhmm} — edit the note any time`, { duration: 3500 });
    } finally { setQuickStamping(false); }
  };

  return (
    <form className="bg-white border-t border-[#D4D4D4] p-2 flex flex-col gap-1.5 sticky bottom-0 safe-bottom" onSubmit={(e) => { e.preventDefault(); send(); }} data-testid="treatment-composer">
      {/* Kind selector */}
      <div className="flex items-center gap-1" data-testid="treatment-kind-selector">
        {ENTRY_KINDS.map((k) => {
          const Icon = k.Icon;
          const active = kind === k.id;
          return (
            <button
              key={k.id}
              type="button"
              data-testid={`treatment-kind-${k.id}`}
              onClick={() => setKind(k.id)}
              className="text-[10px] font-bold uppercase px-2 py-1 rounded flex items-center gap-1 transition-colors"
              style={active
                ? { background: k.color, color: "white" }
                : { background: k.chipBg, color: k.color }}
            >
              <Icon className="w-3 h-3" strokeWidth={2.5} />
              {k.label}
            </button>
          );
        })}
        <span className="text-[9px] text-[#8A8A8A] ml-2 italic">
          {kind === "event" && "Pins to Live Ops playback timeline"}
          {kind === "npt" && "Pins to timeline + counted toward NPT total"}
        </span>
      </div>

      {/* NPT category + minutes */}
      {kind === "npt" && (
        <div className="flex items-center gap-2" data-testid="treatment-npt-fields">
          <select
            data-testid="treatment-npt-category"
            value={nptCategory}
            onChange={(e) => setNptCategory(e.target.value)}
            className="px-2 py-1 border border-[#CCC] rounded text-[11px] bg-white"
          >
            {NPT_CATEGORIES.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
          <input
            data-testid="treatment-npt-minutes"
            type="number"
            value={nptMinutes}
            onChange={(e) => setNptMinutes(e.target.value)}
            min={1}
            step={1}
            placeholder="Minutes"
            className="px-2 py-1 border border-[#CCC] rounded text-[11px] w-24"
          />
          <span className="text-[10px] text-[#595959]">of non-productive time</span>
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          data-testid="treatment-entry-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim() && !busy) send(); }
          }}
          placeholder={
            kind === "event" ? 'Significant event — e.g. "Tagged bottom at 4,210 ft"'
            : kind === "npt" ? 'NPT reason — e.g. "Pump 2 seal failure, waiting on parts"'
            : "Log a note — Enter to send, Shift+Enter for newline"
          }
          rows={2}
          maxLength={2000}
          className="flex-1 px-2.5 py-2 border border-[#CCC] rounded text-sm resize-none"
        />
        <div className="flex flex-col gap-1 self-stretch">
          <button
            type="button"
            data-testid="treatment-quick-stamp"
            onClick={quickStamp}
            disabled={quickStamping || busy}
            title="Drop a timestamp placeholder (edit the note later from phone or computer)"
            className="text-[11px] font-bold text-[#C36600] bg-white border-2 border-[#C36600] hover:bg-[#FFF4D6] px-2 rounded disabled:opacity-50 inline-flex items-center gap-1 tap-44 min-w-[60px] justify-center flex-1"
          >
            {quickStamping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Zap className="w-3.5 h-3.5" strokeWidth={2.6} /> Stamp</>}
          </button>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            data-testid="treatment-entry-send"
            className="text-sm font-bold text-white bg-[#C44A08] hover:bg-[#0A4F28] px-3 rounded disabled:opacity-50 inline-flex items-center gap-1 tap-44 min-w-[52px] justify-center flex-1"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="inline-flex items-center gap-1 cursor-pointer" data-testid="treatment-custom-time-toggle-wrap">
          <input
            data-testid="treatment-custom-time-toggle"
            type="checkbox"
            checked={useCustomTime}
            onChange={(e) => setUseCustomTime(e.target.checked)}
            className="w-3.5 h-3.5 accent-[#C44A08]"
          />
          <span className="text-[11px] text-[#595959]"><Clock className="inline w-3 h-3 mr-0.5" />Logging a past event</span>
        </label>
        {useCustomTime && (
          <input
            data-testid="treatment-event-at"
            type="datetime-local"
            value={eventAt}
            onChange={(e) => setEventAt(e.target.value)}
            className="px-2 py-0.5 border border-[#CCC] rounded text-[11px] text-[#262626] bg-white"
          />
        )}
        {useCustomTime && (
          <span className="text-[10px] text-[#C36600] italic">
            This note will slot into chronological order by the event time.
          </span>
        )}
      </div>
    </form>
  );
};

const TreatmentEntryRow = ({ entry, mine, treatmentId, onPatched, onDeleted }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.text);
  const [eventAt, setEventAt] = useState(toLocalDTInput(entry.event_at || entry.created_at));
  const [busy, setBusy] = useState(false);

  // What we display as the primary timestamp — the event time if present, else logged time.
  const displayAt = entry.event_at || entry.created_at;
  const createdAt = entry.created_at;
  const wasBackdated = entry.event_at && Math.abs(new Date(entry.event_at) - new Date(entry.created_at)) > 60 * 1000;

  const save = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      const { data } = await axios.patch(
        `${API}/treatments/${treatmentId}/entries/${entry.entry_id}`,
        { text: t, event_at: fromLocalDTInput(eventAt) },
        { withCredentials: true },
      );
      onPatched(data);
      toast.success("Entry updated.");
      setEditing(false);
    } catch (e) { toast.error(e.response?.data?.detail || "Edit failed."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm("Delete this entry? This cannot be undone.")) return;
    setBusy(true);
    try {
      await axios.delete(`${API}/treatments/${treatmentId}/entries/${entry.entry_id}`, { withCredentials: true });
      onDeleted();
      toast.success("Entry deleted.");
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed."); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex gap-2 items-start group" data-testid={`treatment-entry-${entry.entry_id}`}>
      <div className="text-[10px] font-mono font-bold text-[#C44A08] mt-0.5 w-12 sm:w-16 flex-shrink-0 text-right leading-tight">
        {stampBar(displayAt)}
        {wasBackdated && (
          <div className="text-[8px] font-normal italic text-[#C36600]" title={`Logged ${stampBar(createdAt)}`}>
            backdated
          </div>
        )}
      </div>
      <div className={`flex-1 min-w-0 border-l-2 pl-2 ${
        entry.kind === "event" ? "border-[#F59E0B]" :
        entry.kind === "npt" ? "border-[#DC2626]" :
        mine ? "border-[#C44A08]" : "border-[#D4D4D4]"
      }`}>
        <div className="text-[10px] font-bold text-[#595959] flex items-center gap-1 flex-wrap">
          {entry.kind === "event" && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#F59E0B]">
              <Star className="w-2.5 h-2.5" strokeWidth={2.8} />Event
            </span>
          )}
          {entry.kind === "npt" && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#FEE2E2] text-[#DC2626]">
              <AlertTriangle className="w-2.5 h-2.5" strokeWidth={2.8} />NPT
              {entry.npt_category && <span className="ml-0.5 opacity-80">· {NPT_LABEL[entry.npt_category] || entry.npt_category}</span>}
              {entry.npt_minutes && <span className="ml-0.5">· {entry.npt_minutes}m</span>}
            </span>
          )}
          <User className="w-3 h-3" /> {entry.author_name}
          {entry.operation_code && OPERATION_CODE_BY_NUM[entry.operation_code] && (
            <span
              data-testid={`treatment-entry-opcode-${entry.entry_id}`}
              className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
              style={{ background: PHASE_COLOR[OPERATION_CODE_BY_NUM[entry.operation_code].phase] + "25", color: PHASE_COLOR[OPERATION_CODE_BY_NUM[entry.operation_code].phase] }}
              title={OPERATION_CODE_BY_NUM[entry.operation_code].desc}>
              #{String(entry.operation_code).padStart(2, "0")} · {OPERATION_CODE_BY_NUM[entry.operation_code].label}
            </span>
          )}
          {wasBackdated && (
            <span className="text-[9px] font-normal italic text-[#C36600]">· logged {stampBar(createdAt)}</span>
          )}
          {entry.edited_at && <span className="text-[9px] font-normal italic text-[#8A8A8A]">· edited {stampBar(entry.edited_at)}</span>}
        </div>
        {editing ? (
          <div className="space-y-1 mt-0.5">
            <textarea
              data-testid={`treatment-entry-edit-${entry.entry_id}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full px-2 py-1.5 border border-[#CCC] rounded text-sm"
              autoFocus
            />
            <label className="flex items-center gap-1.5 text-[10px] text-[#595959]">
              <Clock className="w-3 h-3" />Event time:
              <input
                data-testid={`treatment-entry-edit-event-${entry.entry_id}`}
                type="datetime-local"
                value={eventAt}
                onChange={(e) => setEventAt(e.target.value)}
                className="px-1.5 py-0.5 border border-[#CCC] rounded text-[11px] bg-white"
              />
            </label>
            <div className="flex gap-1 justify-end">
              <button data-testid={`treatment-entry-cancel-${entry.entry_id}`} onClick={() => { setEditing(false); setText(entry.text); setEventAt(toLocalDTInput(entry.event_at || entry.created_at)); }} className="text-[10px] text-[#595959] px-2 py-1 inline-flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
              <button data-testid={`treatment-entry-save-${entry.entry_id}`} onClick={save} disabled={busy || !text.trim()} className="text-[10px] font-bold text-white bg-[#C44A08] hover:bg-[#0A4F28] px-2 py-1 rounded disabled:opacity-50 inline-flex items-center gap-1">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-1">
            <div className="flex-1">
              <div className="text-[13px] text-[#262626] whitespace-pre-wrap break-words">{entry.text}</div>
              {entry.telemetry_snapshot && (
                <div
                  data-testid={`treatment-entry-snapshot-${entry.entry_id}`}
                  className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-[#595959] bg-[#F5F7FA] rounded px-1.5 py-1 border border-[#E2E8F0]">
                  <span className="font-bold uppercase tracking-wider text-[9px] text-[#1E293B]">● Live snapshot</span>
                  {entry.telemetry_snapshot.depth_ft != null && <span>Depth <b className="text-[#0E7490]">{Math.round(entry.telemetry_snapshot.depth_ft)} ft</b></span>}
                  {entry.telemetry_snapshot.weight_lb != null && <span>Wt <b>{Math.round(entry.telemetry_snapshot.weight_lb)} lbs</b></span>}
                  {entry.telemetry_snapshot.p_internal_psi != null && <span>P_int <b className="text-[#B91C1C]">{Math.round(entry.telemetry_snapshot.p_internal_psi)} psi</b></span>}
                  {entry.telemetry_snapshot.p_external_psi != null && <span>P_whp <b>{Math.round(entry.telemetry_snapshot.p_external_psi)} psi</b></span>}
                  {entry.telemetry_snapshot.traction_pressure_psi != null && <span>Skate <b className="text-[#B45309]">{Math.round(entry.telemetry_snapshot.traction_pressure_psi)} psi</b></span>}
                  {entry.telemetry_snapshot.vm_utilization != null && <span>VM <b className="text-[#6D28D9]">{(entry.telemetry_snapshot.vm_utilization * 100 * 0.8).toFixed(1)}%</b></span>}
                  {entry.telemetry_snapshot.fatigue_worst != null && <span>Fat <b>{(entry.telemetry_snapshot.fatigue_worst * 100).toFixed(2)}%</b></span>}
                </div>
              )}
            </div>
            {mine && (
              <div className="flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <button data-testid={`treatment-entry-edit-btn-${entry.entry_id}`} onClick={() => setEditing(true)} className="p-0.5 text-[#FF6B1A] hover:bg-[#FFF7EF] rounded tap-44" aria-label="Edit"><Pencil className="w-3 h-3" /></button>
                <button data-testid={`treatment-entry-delete-btn-${entry.entry_id}`} onClick={remove} className="p-0.5 text-[#C00000] hover:bg-[#F8D7DA] rounded tap-44" aria-label="Delete"><Trash2 className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const TreatmentPage = () => {
  const navigate = useNavigate();
  const { rigId } = useRig();
  const { user } = useAuth();
  const [active, setActive] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [splitView, setSplitView] = useState(() => {
    try { return localStorage.getItem("coilaegis_treatment_split_v1") === "1"; }
    catch { return false; }
  });
  const pollRef = useRef(null);
  const sinceRef = useRef(null);
  const scrollRef = useRef(null);

  const toggleSplit = () => {
    setSplitView((v) => {
      const next = !v;
      try { localStorage.setItem("coilaegis_treatment_split_v1", next ? "1" : "0"); } catch (e) { console.debug("[Treatment] localStorage write failed", e?.message); }
      return next;
    });
  };

  const loadActive = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/treatments/active`, { params: { rig_id: rigId }, withCredentials: true });
      const trt = data.treatment;
      setActive(trt);
      if (trt) {
        const eResp = await axios.get(`${API}/treatments/${trt.treatment_id}/entries`, { withCredentials: true });
        setEntries(eResp.data.entries || []);
        sinceRef.current = eResp.data.entries?.length ? eResp.data.entries[eResp.data.entries.length - 1].created_at : trt.created_at;
      } else {
        setEntries([]);
        sinceRef.current = null;
      }
    } catch (e) {
      // Silent — polling will retry
      console.debug("Treatment load failed", e?.response?.status);
    } finally { setLoading(false); }
  }, [rigId]);

  const pollNew = useCallback(async () => {
    if (!active || !sinceRef.current) return;
    try {
      setRefreshing(true);
      const { data } = await axios.get(`${API}/treatments/${active.treatment_id}/entries`, {
        params: { since: sinceRef.current },
        withCredentials: true,
      });
      if (data.entries?.length) {
        setEntries((prev) => [...prev, ...data.entries]);
        sinceRef.current = data.entries[data.entries.length - 1].created_at;
      }
    } catch (e) { console.debug("[Treatment] pollNew transient error", e?.response?.status || e?.message); }
    finally { setRefreshing(false); }
  }, [active]);

  useEffect(() => { loadActive(); }, [loadActive]);

  useEffect(() => {
    if (!active) return;
    pollRef.current = setInterval(pollNew, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [active, pollNew]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries.length]);

  const onEntryAdded = (entry) => {
    setEntries((prev) => [...prev, entry]);
    sinceRef.current = entry.created_at;
  };

  const refreshAll = async () => {
    await loadActive();
  };
  const { ref: pullRef, progress, refreshing: pulling } = usePullToRefresh(refreshAll);

  const closeTreatment = async () => {
    if (!active) return;
    if (!window.confirm(`Close "${active.name}"? You can still read the log later, but no new entries can be added.`)) return;
    setClosing(true);
    try {
      await axios.post(`${API}/treatments/${active.treatment_id}/close`, {}, { withCredentials: true });
      toast.success("Treatment closed.");
      setActive(null);
      setEntries([]);
    } catch (e) { toast.error(e.response?.data?.detail || "Close failed."); }
    finally { setClosing(false); }
  };

  const copyLog = async () => {
    if (!active) return;
    const header = `Treatment: ${active.name}` + (active.well_or_job_no ? ` · ${active.well_or_job_no}` : "") + `\nRig: ${rigLabel(rigId)}\nStarted: ${fmtTime(active.created_at)} by ${active.created_by_name}\n${active.note ? "Note: " + active.note + "\n" : ""}\n`;
    const body = entries.map((e) => `[${fmtTime(e.created_at)}] ${e.author_name}: ${e.text}`).join("\n");
    try {
      await navigator.clipboard.writeText(header + body);
      toast.success("Log copied to clipboard.");
    } catch { toast.error("Clipboard blocked — use Print/PDF instead."); }
  };

  const printLog = () => window.print();

  const groupedByDay = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const ref = e.event_at || e.created_at;
      // Group by local calendar day in 24-hour aware format
      const d = new Date(ref);
      const dayKey = `${String(d.getFullYear())}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      if (!map.has(dayKey)) map.set(dayKey, []);
      map.get(dayKey).push(e);
    }
    return Array.from(map.entries());
  }, [entries]);

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col print:bg-white">
      <header className="bg-[#C44A08] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0 safe-x print:hidden">
        <button onClick={() => navigate("/hub")} data-testid="treatment-back" className="flex items-center gap-1.5 text-sm font-semibold tap-44 -ml-2 pl-2 pr-2"><ArrowLeft className="w-4 h-4" /> Back</button>
        <h1 className="text-sm font-semibold ml-2 flex items-center gap-2 min-w-0"><ClipboardList className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Treatment · {rigLabel(rigId)}</span></h1>
        {refreshing && <RefreshCw className="w-3 h-3 animate-spin ml-2 opacity-70 flex-shrink-0" />}
        <div className="ml-auto flex items-center gap-1">
          <button
            data-testid="treatment-split-toggle"
            onClick={toggleSplit}
            title={splitView ? "Hide live chart" : "Show live chart beside the log"}
            className={`text-[11px] font-bold px-2 py-1 rounded flex items-center gap-1 tap-44 ${splitView ? "bg-white text-[#C44A08]" : "bg-white/10 border border-white/30 text-white hover:bg-white/20"}`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{splitView ? "Hide chart" : "Live chart"}</span>
          </button>
        </div>
      </header>
      <div className="print:hidden"><RigSelector /></div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: treatment log (full width or 60%) */}
        <div className={`${splitView ? "w-full lg:w-3/5" : "w-full"} flex flex-col overflow-hidden transition-all`}>
          <div className="flex-1 p-3 pb-4 overflow-hidden flex flex-col scroll-smooth-mobile" ref={pullRef}>
        <PullIndicator progress={progress} refreshing={pulling} />
        <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col space-y-3">
          {loading ? (
            <div className="text-center text-[13px] text-[#595959] py-8"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading…</div>
          ) : !active ? (
            <StartCard rigId={rigId} onStarted={(t) => { setActive(t); setEntries([]); sinceRef.current = t.created_at; }} />
          ) : (
            <>
              {/* Header card */}
              <div className="bg-white border border-[#D4D4D4] rounded-lg p-3 space-y-1 print:border-0" data-testid="treatment-header">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-[#DCFCE7] text-[#065F46] px-1.5 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#065F46] animate-pulse" /> LIVE
                      </span>
                      <h2 className="text-base font-bold text-[#C44A08] truncate">{active.name}</h2>
                    </div>
                    <div className="text-[11px] text-[#595959] mt-0.5">
                      {active.well_or_job_no && <>Well/Job: <strong className="text-[#262626]">{active.well_or_job_no}</strong> · </>}
                      Started {fmtTime(active.created_at)} by <strong className="text-[#262626]">{active.created_by_name}</strong>
                    </div>
                    {active.note && <div className="text-[11px] text-[#595959] italic mt-0.5">{active.note}</div>}
                  </div>
                  <div className="flex gap-1 print:hidden flex-shrink-0">
                    <button onClick={copyLog} data-testid="treatment-copy" className="text-[11px] font-bold text-[#C44A08] border border-[#C44A08] px-2 py-1.5 rounded inline-flex items-center gap-1 hover:bg-[#FFF7EF] tap-44">
                      <Copy className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Copy</span>
                    </button>
                    <button onClick={printLog} data-testid="treatment-print" className="text-[11px] font-bold text-[#C44A08] border border-[#C44A08] px-2 py-1.5 rounded inline-flex items-center gap-1 hover:bg-[#FFF7EF] tap-44">
                      <Printer className="w-3.5 h-3.5" /> <span className="hidden sm:inline">PDF</span>
                    </button>
                    <button onClick={closeTreatment} disabled={closing} data-testid="treatment-close" className="text-[11px] font-bold text-[#B91C1C] border border-[#B91C1C] px-2 py-1.5 rounded inline-flex items-center gap-1 hover:bg-[#FEF2F2] disabled:opacity-50 tap-44">
                      {closing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />} <span className="hidden sm:inline">Close</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white border border-[#D4D4D4] rounded-lg print:border-0" data-testid="treatment-timeline" id="treatment-print-area">
                {entries.length === 0 ? (
                  <div className="p-8 text-center text-[13px] text-[#595959] italic">
                    No entries yet — log the first note below. Everyone on {rigLabel(rigId)} sees updates every {POLL_MS / 1000}s.
                  </div>
                ) : (
                  <div className="p-3 space-y-4">
                    {groupedByDay.map(([day, list]) => {
                      // Convert "YYYY-MM-DD" group key → "DD Mon YYYY" for display
                      const [y, m, dd] = day.split("-").map(Number);
                      const d = new Date(y, m - 1, dd);
                      const headerLabel = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                      return (
                        <div key={day}>
                          <div className="text-[10px] font-bold text-[#595959] uppercase tracking-wide sticky top-0 bg-white/95 py-1 -mx-3 px-3 print:static">
                            {headerLabel}
                          </div>
                          <div className="space-y-1.5 mt-1">
                            {list.map((e) => (
                              <TreatmentEntryRow
                                key={e.entry_id}
                                entry={e}
                                mine={e.author === user?.email}
                                treatmentId={active.treatment_id}
                                onPatched={(updated) => setEntries((prev) => prev.map((x) => x.entry_id === updated.entry_id ? updated : x))}
                                onDeleted={() => setEntries((prev) => prev.filter((x) => x.entry_id !== e.entry_id))}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <EntryComposer treatmentId={active.treatment_id} onAdded={onEntryAdded} />
            </>
          )}
        </div>
      </div>
        </div>
        {/* Right: live chart sidebar (desktop split). On mobile, hidden under the lg breakpoint. */}
        {splitView && (
          <div className="hidden lg:flex w-2/5 flex-shrink-0 border-l border-black/40">
            <LiveStripSidebar />
          </div>
        )}
      </div>

      {/* Mobile split: slide-in bottom sheet with the live chart */}
      {splitView && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 h-[42vh] z-40 shadow-[0_-6px_18px_rgba(0,0,0,0.4)] print:hidden">
          <LiveStripSidebar compact />
        </div>
      )}

      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .print\\:border-0 { border: 0 !important; }
          #treatment-print-area { max-height: none !important; overflow: visible !important; }
        }
      `}</style>
    </div>
  );
};

export default TreatmentPage;
