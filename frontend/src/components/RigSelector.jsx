import React, { useEffect, useMemo, useRef, useState } from "react";
import { Radio, ChevronDown, Search, Check } from "lucide-react";
import { RIGS, useRig, rigAccent, rigLabel } from "../context/RigContext";

/**
 * RigSelector — searchable dropdown for 25 rigs + Yard.
 * Shows a red dot next to any rig with unread chat or checklist activity.
 */
const RigSelector = () => {
  const { rigId, setRigId, unreadFor } = useRig();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return RIGS;
    return RIGS.filter((r) => r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  }, [query]);

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
        <span>Active Rig</span>
      </div>

      <button
        data-testid="rig-selector-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2.5 py-1 rounded font-bold text-[11px] whitespace-nowrap transition-colors"
        style={{ background: activeAccent, color: "white" }}
      >
        <span>{rigLabel(rigId)}</span>
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

      <span className="text-[9px] text-[#666] hidden sm:block ml-auto">All data filtered by rig</span>

      {open && (
        <div
          data-testid="rig-selector-menu"
          className="absolute left-1 top-full mt-1 z-50 bg-white text-[#262626] rounded-lg shadow-xl border border-[#D4D4D4] w-64 max-h-[70dvh] overflow-hidden flex flex-col"
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
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-[#8A8A8A]">No rig matches “{query}”.</div>
            )}
            {filtered.map((r) => {
              const isActive = r.id === rigId;
              const u = unreadFor(r.id);
              const anyUnread = u.chat || u.checklist;
              return (
                <button
                  key={r.id}
                  data-testid={`rig-menu-item-${r.id}`}
                  onClick={() => { setRigId(r.id); setOpen(false); setQuery(""); }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 text-[12px] font-semibold hover:bg-[#F0F9F3] ${isActive ? "bg-[#F0F9F3]" : ""}`}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.accent }} />
                  <span className="flex-1 text-left">{r.label}</span>
                  {anyUnread && (
                    <span data-testid={`rig-menu-unread-${r.id}`} className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" title="New activity" />
                  )}
                  {isActive && <Check className="w-3.5 h-3.5 text-[#107C41]" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default RigSelector;
