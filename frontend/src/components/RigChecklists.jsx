import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ShieldAlert, ClipboardList, Wrench, CheckCircle2, Circle, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";

const KEY = (rigId, kind) => `ctp_checklist_v1::${rigId}::${kind}`;

const DEFAULT_LIB = {
  safety: [
    { id: "flha_am",       label: "Pre-tour FLHA / Toolbox Talk signed by all crew",         cadence: "shift" },
    { id: "safety_meeting",label: "Weekly Safety Meeting held (topic logged)",               cadence: "week" },
    { id: "h2s_check",     "label": "H₂S monitor bump-tested",                               cadence: "shift" },
    { id: "hazop_review",  label: "HAZOP / MOC reviewed for today's operation",              cadence: "shift" },
    { id: "muster_review", label: "Muster point + wind sock reviewed with visitors",         cadence: "shift" },
    { id: "erp_ack",       label: "Site-specific ERP acknowledged by supervisor",            cadence: "shift" },
  ],
  ops: [
    { id: "bop_function",  label: "BOP function test recorded",                              cadence: "daily" },
    { id: "wellhead_p",    label: "Wellhead pressure logged (surface & annulus)",            cadence: "daily" },
    { id: "coil_fatigue",  label: "CT fatigue log updated (cycles counted)",                 cadence: "daily" },
    { id: "reel_inspect",  label: "Reel + injector inspected for leaks",                     cadence: "daily" },
    { id: "jha_reviewed",  label: "JHA reviewed with day tour crew",                         cadence: "daily" },
    { id: "circulate_bu",  label: "Circulate bottoms-up before pulling into surface",        cadence: "daily" },
  ],
  pm: [
    { id: "hyd_filter",    label: "Hydraulic filter change",                                 cadence: "week"  },
    { id: "pump_seal",     label: "Triplex pump packing / seal inspection",                  cadence: "week"  },
    { id: "wire_rope",     label: "Wireline / crane wire rope inspection",                   cadence: "month" },
    { id: "gauge_cal",     label: "Weight indicator + pressure gauge calibration",           cadence: "month" },
    { id: "fluid_sample",  label: "Hydraulic + engine oil sample sent for analysis",         cadence: "month" },
    { id: "bop_service",   label: "BOP rebuild / service interval",                          cadence: "month" },
  ],
};

const TIER_CONFIG = {
  safety: { label: "Safety Meetings / FLHA",  Icon: ShieldAlert,   accent: "#C00000" },
  ops:    { label: "Daily Operations",        Icon: ClipboardList, accent: "#107C41" },
  pm:     { label: "Weekly / Monthly PMs",    Icon: Wrench,        accent: "#0056B3" },
};

function loadState(rigId, kind) {
  try {
    const raw = localStorage.getItem(KEY(rigId, kind));
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Checklist: read failed", e?.message);
  }
  // First visit for this rig → seed with the default library, all unchecked
  return DEFAULT_LIB[kind].map((it) => ({ ...it, checked: false, lastCheckedAt: null, lastCheckedBy: null, custom: false }));
}
function saveState(rigId, kind, items) {
  try { localStorage.setItem(KEY(rigId, kind), JSON.stringify(items)); }
  catch (e) { console.warn("Checklist: write failed", e?.message); }
}

const ChecklistTier = ({ kind, expanded, onToggle }) => {
  const { rigId, markSeen, refreshActivity } = useRig();
  const { user } = useAuth();
  const cfg = TIER_CONFIG[kind];
  const [items, setItems] = useState(() => loadState(rigId, kind));
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newCadence, setNewCadence] = useState("daily");

  // Reload when the active rig changes
  useEffect(() => { setItems(loadState(rigId, kind)); }, [rigId, kind]);
  useEffect(() => { saveState(rigId, kind, items); }, [rigId, kind, items]);

  const emitEvent = async (item, action) => {
    try {
      await axios.post(
        `${API}/crew/checklist-events`,
        { rig_id: rigId, tier: kind, item_id: item.id, item_label: item.label, cadence: item.cadence, action },
        { withCredentials: true }
      );
      markSeen(rigId, "checklist");
      refreshActivity && refreshActivity();
    } catch (e) {
      // Solo mode or offline — local state still tracks the check-off; log for debug only.
      console.debug("Checklist: server sync failed", e?.response?.status || e?.message);
    }
  };

  const toggleItem = (id) => {
    setItems((prev) => {
      const next = prev.map((it) => {
        if (it.id !== id) return it;
        const willCheck = !it.checked;
        emitEvent(it, willCheck ? "checked" : "unchecked");
        return {
          ...it,
          checked: willCheck,
          lastCheckedAt: willCheck ? new Date().toISOString() : it.lastCheckedAt,
          lastCheckedBy: willCheck ? (user?.name || user?.email || "crew") : it.lastCheckedBy,
        };
      });
      return next;
    });
  };
  const addItem = () => {
    if (!newLabel.trim()) return;
    setItems((prev) => [...prev, { id: `cus_${Date.now()}`, label: newLabel.trim(), cadence: newCadence, checked: false, custom: true, lastCheckedAt: null, lastCheckedBy: null }]);
    setNewLabel("");
    setAddOpen(false);
  };
  const remove = (id) => setItems((prev) => prev.filter((i) => i.id !== id));
  const resetAll = () => setItems((prev) => prev.map((i) => ({ ...i, checked: false, lastCheckedAt: null, lastCheckedBy: null })));

  const total = items.length;
  const done = items.filter((i) => i.checked).length;
  const Icon = cfg.Icon;

  return (
    <div className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden" data-testid={`checklist-tier-${kind}`}>
      <button
        data-testid={`checklist-toggle-${kind}`}
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between border-b border-[#E5E7EB] hover:bg-[#FAFAFA]"
        style={{ background: `${cfg.accent}10` }}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-4 h-4" style={{ color: cfg.accent }} /> : <ChevronRight className="w-4 h-4" style={{ color: cfg.accent }} />}
          <Icon className="w-4 h-4" style={{ color: cfg.accent }} strokeWidth={2.5} />
          <span className="text-sm font-bold" style={{ color: cfg.accent }}>{cfg.label}</span>
        </div>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: cfg.accent, color: "white" }}>{done}/{total}</span>
      </button>
      {expanded && (
        <>
          <div className="divide-y divide-[#F0F0F0]">
            {items.map((it) => (
              <div key={it.id} data-testid={`checklist-item-${it.id}`} className="flex items-start gap-2 px-3 py-2 hover:bg-[#FAFAFA]">
                <button
                  data-testid={`checklist-check-${it.id}`}
                  onClick={() => toggleItem(it.id)}
                  className="mt-0.5 flex-shrink-0"
                >
                  {it.checked
                    ? <CheckCircle2 className="w-5 h-5" style={{ color: cfg.accent }} strokeWidth={2.5} />
                    : <Circle className="w-5 h-5 text-[#B0B0B0]" strokeWidth={2} />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] ${it.checked ? "line-through text-[#8A8A8A]" : "text-[#262626] font-medium"}`}>{it.label}</div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#8A8A8A]">
                    <span className="uppercase tracking-wide font-semibold">{it.cadence}</span>
                    {it.lastCheckedAt && (
                      <span>• {new Date(it.lastCheckedAt).toLocaleString()} by {it.lastCheckedBy || "—"}</span>
                    )}
                  </div>
                </div>
                {it.custom && (
                  <button onClick={() => remove(it.id)} className="text-[#C00000] hover:bg-[#F8D7DA] rounded p-1" data-testid={`checklist-delete-${it.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="px-3 py-2 flex items-center justify-between bg-[#F9FAFB] border-t border-[#E5E7EB]">
            <button
              data-testid={`checklist-reset-${kind}`}
              onClick={resetAll}
              className="text-[11px] text-[#595959] hover:text-[#262626] font-semibold"
            >
              Reset all
            </button>
            <button
              data-testid={`checklist-add-btn-${kind}`}
              onClick={() => setAddOpen((v) => !v)}
              className="text-[11px] font-bold flex items-center gap-1 px-2 py-1 rounded"
              style={{ background: cfg.accent, color: "white" }}
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> Add item
            </button>
          </div>
          {addOpen && (
            <div className="px-3 py-2 bg-[#F0F9F3] border-t border-[#E5E7EB] flex gap-2" data-testid={`checklist-add-form-${kind}`}>
              <input
                data-testid={`checklist-new-label-${kind}`}
                placeholder="Custom checklist item"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="flex-1 px-2 py-1 border border-[#CCC] rounded text-xs"
              />
              <select
                data-testid={`checklist-new-cadence-${kind}`}
                value={newCadence}
                onChange={(e) => setNewCadence(e.target.value)}
                className="px-2 py-1 border border-[#CCC] rounded text-xs"
              >
                <option value="shift">shift</option>
                <option value="daily">daily</option>
                <option value="week">week</option>
                <option value="month">month</option>
              </select>
              <button
                data-testid={`checklist-save-item-${kind}`}
                onClick={addItem}
                disabled={!newLabel.trim()}
                className="text-xs font-bold text-white px-3 py-1 rounded disabled:opacity-50"
                style={{ background: cfg.accent }}
              >
                Save
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * RigChecklists — three collapsible tiers (Safety/FLHA, Daily Ops, Weekly/Monthly PMs).
 * All state is localStorage per rig — swapping rigs shows a different set of check-offs instantly.
 */
const RigChecklists = () => {
  const { rigId } = useRig();
  const [openTier, setOpenTier] = useState("safety");
  const summary = useMemo(() => {
    const out = {};
    for (const kind of Object.keys(TIER_CONFIG)) {
      const items = loadState(rigId, kind);
      out[kind] = { total: items.length, done: items.filter((i) => i.checked).length };
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rigId, openTier]);

  return (
    <div className="space-y-2" data-testid="rig-checklists">
      <div className="text-[11px] text-[#595959] flex items-center gap-2">
        <span className="font-bold uppercase tracking-wider">{rigLabel(rigId)} Checklists</span>
        <span className="text-[10px]">·</span>
        {Object.entries(TIER_CONFIG).map(([k, cfg]) => (
          <span key={k} className="text-[10px] font-semibold" style={{ color: cfg.accent }}>
            {cfg.label.split(" ")[0]} {summary[k]?.done ?? 0}/{summary[k]?.total ?? 0}
          </span>
        ))}
      </div>
      {Object.keys(TIER_CONFIG).map((kind) => (
        <ChecklistTier
          key={`${rigId}::${kind}`}
          kind={kind}
          expanded={openTier === kind}
          onToggle={() => setOpenTier(openTier === kind ? null : kind)}
        />
      ))}
    </div>
  );
};

export default RigChecklists;
