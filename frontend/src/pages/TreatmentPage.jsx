import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, ClipboardList, Play, Square, Send, Trash2,
  Copy, Printer, RefreshCw, User, Pencil, Check, X,
} from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";
import RigSelector from "../components/RigSelector";
import { usePullToRefresh, PullIndicator } from "../hooks/usePullToRefresh";

const POLL_MS = 3000;

const fmtTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const stampBar = (iso) => {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

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
        <ClipboardList className="w-5 h-5 text-[#0D6535]" />
        <h2 className="text-sm font-bold text-[#0D6535]">Start a new treatment on {rigLabel(rigId)}</h2>
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
        className="text-sm font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Play className="w-4 h-4" /> Start treatment</>}
      </button>
    </div>
  );
};

const EntryComposer = ({ treatmentId, onAdded }) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/treatments/${treatmentId}/entries`, { text: t }, { withCredentials: true });
      setText("");
      onAdded(data);
      inputRef.current?.focus();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to log entry."); }
    finally { setBusy(false); }
  };

  return (
    <form className="bg-white border-t border-[#D4D4D4] p-2 flex gap-2 sticky bottom-0 safe-bottom" onSubmit={(e) => { e.preventDefault(); send(); }} data-testid="treatment-composer">
      <textarea
        ref={inputRef}
        data-testid="treatment-entry-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter (without shift) submits, Shift+Enter inserts a newline
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim() && !busy) send(); }
        }}
        placeholder="Log a note — Enter to send, Shift+Enter for newline"
        rows={2}
        maxLength={2000}
        className="flex-1 px-2.5 py-2 border border-[#CCC] rounded text-sm resize-none"
      />
      <button type="submit" disabled={busy || !text.trim()} data-testid="treatment-entry-send"
        className="self-stretch text-sm font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-4 rounded disabled:opacity-50 inline-flex items-center gap-1 tap-44 min-w-[52px] justify-center">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      </button>
    </form>
  );
};

const TreatmentEntryRow = ({ entry, mine, treatmentId, onPatched, onDeleted }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.text);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      const { data } = await axios.patch(`${API}/treatments/${treatmentId}/entries/${entry.entry_id}`, { text: t }, { withCredentials: true });
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
      <div className="text-[10px] font-mono font-bold text-[#0D6535] mt-0.5 w-12 sm:w-16 flex-shrink-0 text-right leading-tight">{stampBar(entry.created_at)}</div>
      <div className={`flex-1 min-w-0 border-l-2 pl-2 ${mine ? "border-[#0D6535]" : "border-[#D4D4D4]"}`}>
        <div className="text-[10px] font-bold text-[#595959] flex items-center gap-1">
          <User className="w-3 h-3" /> {entry.author_name}
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
            <div className="flex gap-1 justify-end">
              <button data-testid={`treatment-entry-cancel-${entry.entry_id}`} onClick={() => { setEditing(false); setText(entry.text); }} className="text-[10px] text-[#595959] px-2 py-1 inline-flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
              <button data-testid={`treatment-entry-save-${entry.entry_id}`} onClick={save} disabled={busy || !text.trim()} className="text-[10px] font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-2 py-1 rounded disabled:opacity-50 inline-flex items-center gap-1">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-1">
            <div className="text-[13px] text-[#262626] whitespace-pre-wrap break-words flex-1">{entry.text}</div>
            {mine && (
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button data-testid={`treatment-entry-edit-btn-${entry.entry_id}`} onClick={() => setEditing(true)} className="p-0.5 text-[#107C41] hover:bg-[#F0F9F3] rounded tap-44" aria-label="Edit"><Pencil className="w-3 h-3" /></button>
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
  const pollRef = useRef(null);
  const sinceRef = useRef(null);
  const scrollRef = useRef(null);

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
    } catch (e) { /* ignore transient errors */ }
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
      const dayKey = new Date(e.created_at).toLocaleDateString();
      if (!map.has(dayKey)) map.set(dayKey, []);
      map.get(dayKey).push(e);
    }
    return Array.from(map.entries());
  }, [entries]);

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col print:bg-white">
      <header className="bg-[#0D6535] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0 safe-x print:hidden">
        <button onClick={() => navigate("/hub")} data-testid="treatment-back" className="flex items-center gap-1.5 text-sm font-semibold tap-44 -ml-2 pl-2 pr-2"><ArrowLeft className="w-4 h-4" /> Back</button>
        <h1 className="text-sm font-semibold ml-2 flex items-center gap-2 min-w-0"><ClipboardList className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Treatment · {rigLabel(rigId)}</span></h1>
        {refreshing && <RefreshCw className="w-3 h-3 animate-spin ml-2 opacity-70 flex-shrink-0" />}
      </header>
      <div className="print:hidden"><RigSelector /></div>

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
                      <h2 className="text-base font-bold text-[#0D6535] truncate">{active.name}</h2>
                    </div>
                    <div className="text-[11px] text-[#595959] mt-0.5">
                      {active.well_or_job_no && <>Well/Job: <strong className="text-[#262626]">{active.well_or_job_no}</strong> · </>}
                      Started {fmtTime(active.created_at)} by <strong className="text-[#262626]">{active.created_by_name}</strong>
                    </div>
                    {active.note && <div className="text-[11px] text-[#595959] italic mt-0.5">{active.note}</div>}
                  </div>
                  <div className="flex gap-1 print:hidden flex-shrink-0">
                    <button onClick={copyLog} data-testid="treatment-copy" className="text-[11px] font-bold text-[#0D6535] border border-[#0D6535] px-2 py-1.5 rounded inline-flex items-center gap-1 hover:bg-[#F0F9F3] tap-44">
                      <Copy className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Copy</span>
                    </button>
                    <button onClick={printLog} data-testid="treatment-print" className="text-[11px] font-bold text-[#0D6535] border border-[#0D6535] px-2 py-1.5 rounded inline-flex items-center gap-1 hover:bg-[#F0F9F3] tap-44">
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
                    {groupedByDay.map(([day, list]) => (
                      <div key={day}>
                        <div className="text-[10px] font-bold text-[#595959] uppercase tracking-wide sticky top-0 bg-white/95 py-1 -mx-3 px-3 print:static">
                          {day}
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
                    ))}
                  </div>
                )}
              </div>

              <EntryComposer treatmentId={active.treatment_id} onAdded={onEntryAdded} />
            </>
          )}
        </div>
      </div>

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
