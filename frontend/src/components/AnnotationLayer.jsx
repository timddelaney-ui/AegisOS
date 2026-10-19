import React, { useMemo, useState } from "react";
import { AlertTriangle, Info, Zap, X, Edit2, Trash2, Cpu, Star, Hash, ChevronDown, ChevronRight } from "lucide-react";
import { OPERATION_CODES, OPERATION_CODE_BY_NUM, OPERATION_PHASES, PHASE_COLOR, OPERATION_CODE_NPT_CATEGORY } from "../lib/operationCodes";

const SEVERITY_COLOR = {
  info:     { bg: "#0056B3", ring: "#60A5FA", label: "INFO" },
  warn:     { bg: "#C36600", ring: "#FBBF24", label: "WARN" },
  critical: { bg: "#C00000", ring: "#F87171", label: "CRIT" },
};

// Treatment-sourced pins (significant event / NPT) — distinct from annotation severities.
const KIND_COLOR = {
  event: { bg: "#F59E0B", ring: "#FDE68A", label: "EVENT" },
  npt:   { bg: "#DC2626", ring: "#FCA5A5", label: "NPT" },
};

const SEVERITY_ICON = {
  info: Info,
  warn: AlertTriangle,
  critical: Zap,
};

/**
 * Vertical pin markers rendered over the scrubber track.
 * Positioned absolutely as a % of the sample window.
 * `annotations` can contain both annotation docs (annot_id + severity + source)
 * and treatment-event docs (entry_id + kind=event|npt + author_name + text as note).
 */
export function AnnotationPins({ annotations, samples, onPinClick }) {
  if (!annotations?.length || !samples?.length) return null;
  const firstTs = Date.parse(samples[0]?.ts || samples[0]?.created_at || Date.now());
  const lastTs = Date.parse(samples[samples.length - 1]?.ts || samples[samples.length - 1]?.created_at || Date.now());
  const span = Math.max(1, lastTs - firstTs);
  const pins = annotations
    .filter((a) => a.timestamp_ms != null && a.timestamp_ms >= firstTs - 1000 && a.timestamp_ms <= lastTs + 1000)
    .map((a) => ({ ...a, pct: Math.max(0, Math.min(100, ((a.timestamp_ms - firstTs) / span) * 100)) }));
  if (!pins.length) return null;
  return (
    <div className="relative w-full h-0 pointer-events-none" data-testid="annotation-pins">
      {pins.map((p) => {
        const isTreatment = p.kind === "event" || p.kind === "npt";
        const c = isTreatment
          ? KIND_COLOR[p.kind]
          : (SEVERITY_COLOR[p.severity] || SEVERITY_COLOR.info);
        const Icon = isTreatment
          ? (p.kind === "event" ? Star : AlertTriangle)
          : (SEVERITY_ICON[p.severity] || Info);
        const isRig = !isTreatment && p.source && p.source !== "manual";
        const key = p.annot_id || p.entry_id;
        const tooltip = isTreatment
          ? `${c.label}${p.kind === "npt" && p.npt_minutes ? ` · ${p.npt_minutes}m` : ""} · ${(p.text || p.note || "").slice(0, 80)} · ${p.author_name || ""}`
          : `${c.label} · ${p.note} · ${p.author_name}${isRig ? " · rig" : ""}`;
        return (
          <button
            key={key}
            data-testid={`annotation-pin-${key}`}
            onClick={(e) => { e.stopPropagation(); onPinClick?.(p); }}
            style={{ left: `calc(${p.pct}% - 7px)`, background: c.bg, boxShadow: `0 0 0 2px ${c.ring}`, top: -22 }}
            className="pointer-events-auto absolute w-3.5 h-5 rounded-sm flex items-center justify-center text-white hover:scale-125 transition-transform cursor-pointer"
            title={tooltip}
          >
            {isRig
              ? <Cpu className="w-2.5 h-2.5" strokeWidth={3} />
              : <Icon className="w-2.5 h-2.5" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Modal: drop a new annotation at the current timestamp. If an operation
 * code (1..69) is picked from the open-domain CT dialect, we also push a
 * treatment-log entry with the live-telemetry snapshot so the official
 * job report is kept in sync without extra keystrokes.
 */
export function DropAnnotationModal({ open, onClose, onSubmit, timestampMs, snapshot }) {
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState("warn");
  const [busy, setBusy] = useState(false);
  // Operation Dialect state
  const [codeNum, setCodeNum] = useState(null);
  const [query, setQuery] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const activeCode = codeNum != null ? OPERATION_CODE_BY_NUM[codeNum] : null;
  const descriptionEdited = useMemo(() => {
    if (!activeCode) return false;
    return note.trim() !== activeCode.desc.trim();
  }, [note, activeCode]);

  const groupedCodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = OPERATION_CODES.filter((c) =>
      !q ||
      c.label.toLowerCase().includes(q) ||
      c.desc.toLowerCase().includes(q) ||
      String(c.code).startsWith(q) ||
      c.phase.toLowerCase().includes(q)
    );
    const by = {};
    for (const c of filtered) (by[c.phase] = by[c.phase] || []).push(c);
    return by;
  }, [query]);

  const pickCode = (c) => {
    setCodeNum(c.code);
    setNote(c.desc);
    setShowPicker(false);
    setQuery("");
    // If the picked code is an NPT category, lift severity to critical
    if (OPERATION_CODE_NPT_CATEGORY[c.code]) setSeverity("critical");
  };

  const clearCode = () => { setCodeNum(null); setNote(""); };

  if (!open) return null;

  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      // Build the telemetry snapshot in the Pydantic-friendly shape used by the backend
      const snap = {
        depth_ft: snapshot?.depth_ft,
        weight_lb: snapshot?.weight_lb,
        p_internal_psi: snapshot?.p_internal_psi || snapshot?.pressure_psi,
        p_external_psi: snapshot?.p_external_psi,
        traction_pressure_psi: snapshot?.traction_pressure_psi,
        axial_force_lbf: snapshot?.axial_force_lbf,
        vm_utilization: snapshot?.vm_utilization,
        fatigue_worst: snapshot?.fatigue_worst,
        source: snapshot?.source || "live",
      };
      const nptCat = OPERATION_CODE_NPT_CATEGORY[codeNum];
      await onSubmit({
        note: note.trim(),
        severity,
        timestamp_ms: timestampMs,
        depth_ft: snapshot?.depth_ft,
        operation_code: codeNum,
        telemetry_snapshot: snap,
        kind: nptCat ? "npt" : (codeNum ? "event" : "note"),
        npt_category: nptCat || null,
      });
      setNote("");
      setSeverity("warn");
      setCodeNum(null);
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <div
      data-testid="annotation-drop-modal"
      className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="ca-glass ca-glass-amber text-white rounded-lg w-full max-w-xl p-4 relative">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm uppercase tracking-wider text-[#F59E0B] flex items-center gap-2">
            <Hash className="w-4 h-4" /> Operation Dialect · Drop Note
          </h3>
          <button data-testid="annotation-drop-close" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {/* Telemetry snapshot preview — this is the live tick this note is anchored to */}
        <div data-testid="drop-telemetry-snapshot" className="bg-[#0A1220] border border-white/10 rounded px-2 py-1.5 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] ca-telemetry">
          <span className="ca-eyebrow ca-eyebrow-cyan">Snapshot</span>
          <span className="text-slate-400">{new Date(timestampMs).toLocaleTimeString()}</span>
          {snapshot?.depth_ft != null  && <span>DEPTH <b className="text-[#06B6D4]">{Math.round(snapshot.depth_ft)} ft</b></span>}
          {snapshot?.weight_lb != null && <span>WT <b className="text-white">{Math.round(snapshot.weight_lb)} lbs</b></span>}
          {snapshot?.p_internal_psi != null && <span>P_int <b className="text-[#EF4444]">{Math.round(snapshot.p_internal_psi)} psi</b></span>}
          {snapshot?.traction_pressure_psi != null && <span>SKATE <b className="text-[#F59E0B]">{Math.round(snapshot.traction_pressure_psi)} psi</b></span>}
          {snapshot?.vm_utilization != null && <span>VM <b className="text-[#A78BFA]">{(snapshot.vm_utilization * 100 * 0.8).toFixed(1)}%</b></span>}
        </div>

        {/* Operation code picker */}
        <div className="mb-3">
          <label className="ca-eyebrow mb-1 block">Operation Code (1–69)</label>
          {activeCode ? (
            <div className="flex items-center gap-2 bg-[#0A1220] border border-white/15 rounded px-2 py-1.5">
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded text-black"
                style={{ background: PHASE_COLOR[activeCode.phase] }}>
                #{String(activeCode.code).padStart(2, "0")} · {activeCode.phase}
              </span>
              <span className="text-xs font-bold text-white">{activeCode.label}</span>
              <button
                data-testid="drop-op-change"
                onClick={() => setShowPicker(!showPicker)}
                className="ml-auto text-[10px] font-bold text-[#F59E0B] hover:text-white uppercase tracking-wider">
                Change <ChevronDown className="inline w-3 h-3" />
              </button>
              <button
                data-testid="drop-op-clear"
                onClick={clearCode}
                className="text-[10px] font-bold text-slate-400 hover:text-[#EF4444]"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button
              data-testid="drop-op-open"
              onClick={() => setShowPicker(true)}
              className="w-full text-left bg-[#0A1220] border border-white/15 rounded px-2 py-1.5 text-xs text-slate-400 hover:border-[#F59E0B] hover:text-white">
              Pick a code to auto-fill the description →
            </button>
          )}

          {showPicker && (
            <div data-testid="drop-op-picker" className="mt-2 bg-[#0A1220] border border-[#F59E0B]/40 rounded max-h-[280px] overflow-y-auto p-2">
              <input
                data-testid="drop-op-search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search codes · milling · N2 · NPT…"
                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs mb-2 placeholder:text-slate-500" />
              {OPERATION_PHASES.map((phase) => {
                const codes = groupedCodes[phase];
                if (!codes?.length) return null;
                return (
                  <div key={phase} className="mb-2">
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: PHASE_COLOR[phase] }}>
                      <ChevronRight className="w-3 h-3" />{phase}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {codes.map((c) => (
                        <button
                          key={c.code}
                          data-testid={`drop-op-${c.code}`}
                          onClick={() => pickCode(c)}
                          className="text-left px-2 py-1 rounded border border-white/5 hover:border-[#F59E0B]/60 hover:bg-white/5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-mono text-slate-500">#{String(c.code).padStart(2, "0")}</span>
                            <span className="text-[11px] font-bold text-white">{c.label}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate leading-tight">{c.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Editable description */}
        <label className="ca-eyebrow mb-1 block">Description {descriptionEdited && <span className="text-[9px] text-[#F59E0B] ml-1">· edited</span>}</label>
        <textarea
          data-testid="annotation-note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={activeCode ? activeCode.desc : 'e.g. "pressure spike here — pump failure at surface"'}
          rows={3}
          maxLength={2000}
          className="w-full bg-black/40 border border-white/15 rounded px-2 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F59E0B]"
        />

        <div className="mt-3 flex items-center gap-1">
          <span className="ca-eyebrow mr-1">Severity</span>
          {["info", "warn", "critical"].map((s) => {
            const c = SEVERITY_COLOR[s];
            return (
              <button
                key={s}
                data-testid={`annotation-severity-${s}`}
                onClick={() => setSeverity(s)}
                style={severity === s ? { background: c.bg } : {}}
                className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${severity === s ? "text-white" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
              >{c.label}</button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button data-testid="annotation-cancel" onClick={onClose} className="text-xs font-bold px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">Cancel</button>
          <button
            data-testid="annotation-submit"
            disabled={!note.trim() || busy}
            onClick={submit}
            className="text-xs font-bold px-3 py-1.5 rounded bg-[#F59E0B] text-black disabled:opacity-40 shadow-[0_0_0_1px_rgba(245,158,11,0.5)]">
            {busy ? "Saving…" : codeNum ? `Log #${codeNum} + Timeline` : "Drop note"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal: inspect an existing annotation OR treatment event (Significant / NPT).
 * Treatment events are read-only from Live Ops — edit them from the Treatment page.
 */
export function ViewAnnotationModal({ annotation, canEdit, canDelete, onClose, onEdit, onDelete, onOpenTreatment }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(annotation?.note || "");
  const [severity, setSeverity] = useState(annotation?.severity || "info");

  if (!annotation) return null;
  const isTreatment = annotation.kind === "event" || annotation.kind === "npt";
  const c = isTreatment
    ? KIND_COLOR[annotation.kind]
    : (SEVERITY_COLOR[annotation.severity] || SEVERITY_COLOR.info);
  const isRig = !isTreatment && annotation.source && annotation.source !== "manual";
  const displayText = isTreatment ? annotation.text : annotation.note;

  const save = async () => {
    await onEdit?.({ note: note.trim(), severity });
    setEditing(false);
  };

  return (
    <div
      data-testid="annotation-view-modal"
      className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="bg-[#111827] border border-white/20 text-white rounded-lg w-full max-w-md p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span style={{ background: c.bg }} className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded">{c.label}</span>
            {isTreatment && annotation.kind === "npt" && annotation.npt_minutes != null && (
              <span className="inline-block text-[10px] font-bold uppercase bg-white/10 px-2 py-0.5 rounded">{annotation.npt_minutes}m</span>
            )}
            {isTreatment && annotation.npt_category && (
              <span className="inline-block text-[10px] font-bold uppercase bg-white/10 px-2 py-0.5 rounded">{annotation.npt_category.replace("_", " ")}</span>
            )}
            {isRig && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-white/10 px-2 py-0.5 rounded"><Cpu className="w-3 h-3" />Rig · {annotation.source}</span>}
          </div>
          <button data-testid="annotation-view-close" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] text-white/60 mb-1">
          <span className="tabular-nums text-amber-300">{new Date(annotation.timestamp_ms).toLocaleString()}</span>
          {annotation.depth_ft != null && <span className="ml-2">Depth: <span className="tabular-nums text-white">{Math.round(annotation.depth_ft)} ft</span></span>}
        </p>
        <p className="text-[11px] text-white/60 mb-2">By: <span className="text-white">{annotation.author_name || "—"}</span></p>
        {editing && !isTreatment ? (
          <>
            <textarea
              data-testid="annotation-edit-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-sm"
            />
            <div className="mt-3 flex items-center gap-1">
              {["info", "warn", "critical"].map((s) => {
                const cc = SEVERITY_COLOR[s];
                return (
                  <button key={s} onClick={() => setSeverity(s)} style={severity === s ? { background: cc.bg } : {}}
                    className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${severity === s ? "text-white" : "bg-white/10 text-white/70"}`}>{cc.label}</button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="bg-black/40 border border-white/10 rounded px-2 py-2 text-sm whitespace-pre-wrap">{displayText}</p>
        )}
        {!isTreatment && annotation.channel && (
          <p className="mt-2 text-[11px] text-white/50">
            Channel: <span className="text-white">{annotation.channel}</span>
            {annotation.value != null && <span> · value {Number(annotation.value).toFixed(2)}</span>}
            {annotation.rule_id && <span> · rule {annotation.rule_id}</span>}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {isTreatment && onOpenTreatment && (
            <button
              data-testid="annotation-open-treatment"
              onClick={onOpenTreatment}
              className="text-xs font-bold px-3 py-1.5 rounded bg-[#FF6B1A] hover:bg-[#C44A08] text-white flex items-center gap-1"
            >
              Open in Treatment →
            </button>
          )}
          {!isTreatment && canDelete && !editing && (
            <button data-testid="annotation-delete" onClick={() => { if (window.confirm("Delete this note?")) onDelete?.(); }}
              className="text-xs font-bold px-3 py-1.5 rounded bg-[#C00000] hover:bg-[#A00000] text-white flex items-center gap-1">
              <Trash2 className="w-3 h-3" />Delete
            </button>
          )}
          {!isTreatment && canEdit && !editing && (
            <button data-testid="annotation-edit" onClick={() => setEditing(true)}
              className="text-xs font-bold px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 flex items-center gap-1">
              <Edit2 className="w-3 h-3" />Edit
            </button>
          )}
          {editing && (
            <>
              <button onClick={() => { setEditing(false); setNote(annotation.note); setSeverity(annotation.severity); }} className="text-xs font-bold px-3 py-1.5 rounded bg-white/10">Cancel</button>
              <button data-testid="annotation-save" onClick={save} className="text-xs font-bold px-3 py-1.5 rounded bg-amber-500 text-black">Save</button>
            </>
          )}
          {!editing && <button onClick={onClose} className="text-xs font-bold px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">Close</button>}
        </div>
      </div>
    </div>
  );
}
