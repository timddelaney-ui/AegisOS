import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Radio, ChevronDown, Search, Check, Pencil, X, Save } from "lucide-react";
import { toast } from "sonner";
import { RIGS, useRig, rigAccent, rigDefaultLabel } from "../context/RigContext";
import { API } from "../context/AuthContext";
import { useAuth } from "../context/AuthContext";
import { isManagement } from "../lib/roles";

/**
 * RigSelector — searchable dropdown for 25 rigs + Yard.
 * - Shows a red dot next to any rig with unread chat or checklist activity.
 * - Management users see a Rename (pencil) button that opens a bulk editor
 *   for team-scoped rig labels (e.g. "North Pad Unit 7").
 */
const RigSelector = () => {
  const { rigId, setRigId, unreadFor, labels, refreshLabels } = useRig();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const rootRef = useRef(null);
  const canRename = isManagement(user);

  useEffect(() => {
    const onDoc = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const labelFor = (id) => labels?.[id] || rigDefaultLabel(id);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return RIGS;
    return RIGS.filter((r) => {
      const lab = labelFor(r.id).toLowerCase();
      return lab.includes(q) || r.id.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, labels]);

  const totalUnread = useMemo(() => {
    let n = 0;
    for (const r of RIGS) {
      const u = unreadFor(r.id);
      if (u.chat || u.checklist) n += 1;
    }
    return n;
  }, [unreadFor]);

  const activeAccent = rigAccent(rigId);
  const active = unreadFor(rigId);

  return (
    <div
      ref={rootRef}
      data-testid="rig-selector"
      className="bg-[#1E1E1E] text-white px-2 py-1 flex items-center gap-2 flex-shrink-0 border-b border-[#333] relative"
    >
      <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-[#9CA3AF]">
        <Radio className="w-3 h-3" strokeWidth={2.5} />
        <span className="hidden xs:inline sm:inline">Active Rig</span>
        <span className="xs:hidden sm:hidden">Rig</span>
      </div>

      <button
        data-testid="rig-selector-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded font-bold text-[12px] whitespace-nowrap transition-colors tap-44"
        style={{ background: activeAccent, color: "white" }}
      >
        <span>{labelFor(rigId)}</span>
        {(active.chat || active.checklist) && <span className="w-1.5 h-1.5 rounded-full bg-white/90 animate-pulse" />}
        <ChevronDown className="w-3 h-3" strokeWidth={2.5} />
      </button>

      {totalUnread > 0 && !open && (
        <span
          data-testid="rig-total-unread-badge"
          className="text-[9px] font-bold bg-[#DC2626] text-white px-1.5 py-[1px] rounded-full"
          title={`Activity on ${totalUnread} rig${totalUnread === 1 ? "" : "s"}`}
        >
          {totalUnread} new
        </span>
      )}

      <span className="text-[9px] text-[#9CA3AF] hidden sm:block ml-auto">All data filtered by rig</span>

      {open && (
        <div
          data-testid="rig-selector-menu"
          className="absolute left-1 top-full mt-1 z-50 bg-white text-[#262626] rounded-lg shadow-xl border border-[#D4D4D4] w-72 max-h-[70dvh] overflow-hidden flex flex-col"
        >
          <div className="px-2 py-2 border-b border-[#E5E7EB] bg-[#FAFAFA] flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-[#8A8A8A]" />
            <input
              autoFocus
              data-testid="rig-selector-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search rig…"
              className="flex-1 bg-transparent outline-none text-xs"
            />
            {canRename && (
              <button
                data-testid="rig-rename-open"
                onClick={(e) => { e.stopPropagation(); setRenameOpen(true); setOpen(false); }}
                title="Rename rigs (Management only)"
                className="text-[10px] font-bold px-2 py-1 rounded bg-[#FF6B1A] text-white hover:bg-[#C44A08] flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" />Rename
              </button>
            )}
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-[#8A8A8A]">No rig matches &ldquo;{query}&rdquo;.</div>
            )}
            {filtered.map((r) => {
              const isActive = r.id === rigId;
              const u = unreadFor(r.id);
              const anyUnread = u.chat || u.checklist;
              const custom = Boolean(labels?.[r.id]);
              const displayLabel = labelFor(r.id);
              return (
                <button
                  key={r.id}
                  data-testid={`rig-menu-item-${r.id}`}
                  onClick={() => { setRigId(r.id); setOpen(false); setQuery(""); }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 text-[12px] font-semibold hover:bg-[#FFF7EF] ${isActive ? "bg-[#FFF7EF]" : ""}`}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.accent }} />
                  <span className="flex-1 text-left truncate">
                    {displayLabel}
                    {custom && <span className="ml-1.5 text-[9px] text-[#8A8A8A] font-normal">· {r.id}</span>}
                  </span>
                  {anyUnread && (
                    <span data-testid={`rig-menu-unread-${r.id}`} className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" title="New activity" />
                  )}
                  {isActive && <Check className="w-3.5 h-3.5 text-[#FF6B1A]" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {renameOpen && (
        <RigRenameModal
          onClose={() => setRenameOpen(false)}
          onSaved={() => { refreshLabels(); setRenameOpen(false); }}
          initial={labels}
        />
      )}
    </div>
  );
};

/**
 * Bulk rename dialog — one row per rig, with "reset" to default on each line.
 */
const RigRenameModal = ({ onClose, onSaved, initial }) => {
  const [draft, setDraft] = useState(() => {
    const d = {};
    RIGS.forEach((r) => { d[r.id] = initial?.[r.id] || ""; });
    return d;
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await axios.put(`${API}/rigs/labels`, { labels: draft }, { withCredentials: true });
      toast.success("Rig names saved");
      onSaved?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    } finally { setBusy(false); }
  };

  return (
    <div
      data-testid="rig-rename-modal"
      className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#111827] border border-white/20 text-white rounded-lg w-full max-w-md p-4 max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-bold text-sm uppercase tracking-wider">Rename rigs</h3>
            <p className="text-[10px] text-white/50">Blank = keep default (Rig 1, Rig 2, …). Max 60 chars.</p>
          </div>
          <button data-testid="rig-rename-close" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 -mx-4 px-4 space-y-1.5 border-y border-white/10 py-2">
          {RIGS.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded w-14 text-center flex-shrink-0"
                style={{ background: `${r.accent}30`, color: r.accent }}
              >
                {r.id}
              </span>
              <input
                data-testid={`rig-rename-input-${r.id}`}
                value={draft[r.id]}
                onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                placeholder={rigDefaultLabel(r.id)}
                maxLength={60}
                className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#FF6B1A]"
              />
              {draft[r.id] && (
                <button
                  data-testid={`rig-rename-reset-${r.id}`}
                  onClick={() => setDraft((d) => ({ ...d, [r.id]: "" }))}
                  className="text-[10px] text-white/50 hover:text-white px-1"
                  title="Reset to default"
                >
                  reset
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-bold px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">Cancel</button>
          <button
            data-testid="rig-rename-save"
            onClick={save}
            disabled={busy}
            className="text-xs font-bold px-3 py-1.5 rounded bg-[#FF6B1A] hover:bg-[#C44A08] text-white disabled:opacity-40 flex items-center gap-1"
          >
            <Save className="w-3 h-3" />{busy ? "Saving…" : "Save all"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RigSelector;
