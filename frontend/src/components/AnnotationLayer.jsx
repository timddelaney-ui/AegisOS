import React, { useState } from "react";
import { AlertTriangle, Info, Zap, X, Edit2, Trash2, Cpu } from "lucide-react";

const SEVERITY_COLOR = {
  info:     { bg: "#0056B3", ring: "#60A5FA", label: "INFO" },
  warn:     { bg: "#C36600", ring: "#FBBF24", label: "WARN" },
  critical: { bg: "#C00000", ring: "#F87171", label: "CRIT" },
};

const SEVERITY_ICON = {
  info: Info,
  warn: AlertTriangle,
  critical: Zap,
};

/**
 * Vertical pin markers rendered over the scrubber track.
 * Positioned absolutely as a % of the sample window.
 */
export function AnnotationPins({ annotations, samples, onPinClick }) {
  if (!annotations?.length || !samples?.length) return null;
  const firstTs = Date.parse(samples[0]?.ts || samples[0]?.created_at || Date.now());
  const lastTs = Date.parse(samples[samples.length - 1]?.ts || samples[samples.length - 1]?.created_at || Date.now());
  const span = Math.max(1, lastTs - firstTs);
  const pins = annotations
    .filter((a) => a.timestamp_ms >= firstTs - 1000 && a.timestamp_ms <= lastTs + 1000)
    .map((a) => ({ ...a, pct: Math.max(0, Math.min(100, ((a.timestamp_ms - firstTs) / span) * 100)) }));
  if (!pins.length) return null;
  return (
    <div className="relative w-full h-0 pointer-events-none" data-testid="annotation-pins">
      {pins.map((p) => {
        const c = SEVERITY_COLOR[p.severity] || SEVERITY_COLOR.info;
        const Icon = SEVERITY_ICON[p.severity] || Info;
        const isRig = p.source && p.source !== "manual";
        return (
          <button
            key={p.annot_id}
            data-testid={`annotation-pin-${p.annot_id}`}
            onClick={(e) => { e.stopPropagation(); onPinClick?.(p); }}
            style={{ left: `calc(${p.pct}% - 7px)`, background: c.bg, boxShadow: `0 0 0 2px ${c.ring}`, top: -22 }}
            className="pointer-events-auto absolute w-3.5 h-5 rounded-sm flex items-center justify-center text-white hover:scale-125 transition-transform cursor-pointer"
            title={`${c.label} · ${p.note} · ${p.author_name}${isRig ? " · rig" : ""}`}
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
 * Modal: drop a new annotation at the current timestamp.
 */
export function DropAnnotationModal({ open, onClose, onSubmit, timestampMs, snapshot }) {
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState("warn");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ note: note.trim(), severity, timestamp_ms: timestampMs, depth_ft: snapshot?.depth_ft });
      setNote("");
      setSeverity("warn");
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <div
      data-testid="annotation-drop-modal"
      className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="bg-[#111827] border border-white/20 text-white rounded-lg w-full max-w-md p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm uppercase tracking-wider">Drop timeline note</h3>
          <button data-testid="annotation-drop-close" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] text-white/60 mb-3">
          Timestamp: <span className="tabular-nums text-amber-300">{new Date(timestampMs).toLocaleTimeString()}</span>
          {snapshot?.depth_ft != null && <span className="ml-2">Depth: <span className="tabular-nums text-white">{Math.round(snapshot.depth_ft)} ft</span></span>}
        </p>
        <textarea
          data-testid="annotation-note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='e.g. "pressure spike here — pump failure at surface"'
          rows={3}
          maxLength={500}
          className="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400"
          autoFocus
        />
        <div className="mt-3 flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-white/50 mr-1">Severity:</span>
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
            className="text-xs font-bold px-3 py-1.5 rounded bg-amber-500 text-black disabled:opacity-40">
            {busy ? "Saving…" : "Drop note"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal: inspect an existing annotation, with edit/delete for authorized users.
 */
export function ViewAnnotationModal({ annotation, canEdit, canDelete, onClose, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(annotation?.note || "");
  const [severity, setSeverity] = useState(annotation?.severity || "info");

  if (!annotation) return null;
  const c = SEVERITY_COLOR[annotation.severity] || SEVERITY_COLOR.info;
  const isRig = annotation.source && annotation.source !== "manual";

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
            {isRig && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-white/10 px-2 py-0.5 rounded"><Cpu className="w-3 h-3" />Rig · {annotation.source}</span>}
          </div>
          <button data-testid="annotation-view-close" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] text-white/60 mb-1">
          <span className="tabular-nums text-amber-300">{new Date(annotation.timestamp_ms).toLocaleString()}</span>
          {annotation.depth_ft != null && <span className="ml-2">Depth: <span className="tabular-nums text-white">{Math.round(annotation.depth_ft)} ft</span></span>}
        </p>
        <p className="text-[11px] text-white/60 mb-2">By: <span className="text-white">{annotation.author_name || "—"}</span></p>
        {editing ? (
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
          <p className="bg-black/40 border border-white/10 rounded px-2 py-2 text-sm whitespace-pre-wrap">{annotation.note}</p>
        )}
        {annotation.channel && (
          <p className="mt-2 text-[11px] text-white/50">
            Channel: <span className="text-white">{annotation.channel}</span>
            {annotation.value != null && <span> · value {Number(annotation.value).toFixed(2)}</span>}
            {annotation.rule_id && <span> · rule {annotation.rule_id}</span>}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {canDelete && !editing && (
            <button data-testid="annotation-delete" onClick={() => { if (window.confirm("Delete this note?")) onDelete?.(); }}
              className="text-xs font-bold px-3 py-1.5 rounded bg-[#C00000] hover:bg-[#A00000] text-white flex items-center gap-1">
              <Trash2 className="w-3 h-3" />Delete
            </button>
          )}
          {canEdit && !editing && (
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
