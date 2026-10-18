import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Plus, Minus, Trash2, MapPin, Loader2, Package, Beaker, Wrench, ListChecks, RefreshCw, Pencil, Check, X } from "lucide-react";
import { API } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";

/**
 * TeamItemsList — generic CRUD list used for inventory, consumables, parts orders, to-dos.
 * All items share a base shape; specific columns / statuses vary by `kind`.
 *
 * Live-sync: polls the backend every POLL_MS so all crew members on the same
 * rig see additions / status flips / deletions without a manual refresh.
 */
const POLL_MS = 4000;
const KIND_CONFIG = {
  inventory:   { label: "Inventory",       Icon: Package,     statuses: ["OK", "LOW", "OOS"],                accent: "#FF6B1A", quantityLabel: "Qty" },
  consumables: { label: "Consumables",     Icon: Beaker,      statuses: ["OK", "LOW", "OOS"],                accent: "#856404", quantityLabel: "Qty" },
  parts_order: { label: "Parts Orders",    Icon: Wrench,      statuses: ["REQUESTED", "ORDERED", "RECEIVED"], accent: "#C36600", quantityLabel: "Qty" },
  todo:        { label: "To-Do List",      Icon: ListChecks,  statuses: ["OPEN", "IN_PROGRESS", "DONE"],     accent: "#0056B3", quantityLabel: null },
};

const STATUS_STYLE = {
  OK:          "bg-[#D4EDDA] text-[#155724] border-[#28A745]",
  LOW:         "bg-[#FFF3CD] text-[#856404] border-[#FFE69C]",
  OOS:         "bg-[#F8D7DA] text-[#721C24] border-[#F5C6CB]",
  REQUESTED:   "bg-[#FFF3CD] text-[#856404] border-[#FFE69C]",
  ORDERED:     "bg-[#CCE5FF] text-[#004085] border-[#B8DAFF]",
  RECEIVED:    "bg-[#D4EDDA] text-[#155724] border-[#28A745]",
  OPEN:        "bg-[#F8D7DA] text-[#721C24] border-[#F5C6CB]",
  IN_PROGRESS: "bg-[#FFF3CD] text-[#856404] border-[#FFE69C]",
  DONE:        "bg-[#D4EDDA] text-[#155724] border-[#28A745]",
};

const TeamItemsList = ({ kind }) => {
  const cfg = KIND_CONFIG[kind];
  const { rigId } = useRig();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", quantity: "", unit: "", location: "", note: "", status: cfg.statuses[0], priority: "MED" });
  // Guard poll re-fetches while an optimistic mutation is in-flight so the
  // user's just-made change doesn't briefly flicker back to the old value.
  const pendingWriteRef = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    else setSyncing(true);
    try {
      const { data } = await axios.get(`${API}/team/items/${kind}`, { params: { rig_id: rigId }, withCredentials: true });
      // If an optimistic mutation is still in flight, skip the overwrite.
      if (pendingWriteRef.current === 0) {
        setItems(data.items || []);
      }
    } catch { /* transient — next poll will retry */ }
    finally {
      if (!silent) setLoading(false);
      else setSyncing(false);
    }
  }, [kind, rigId]);

  // Initial load + rig change
  useEffect(() => { load(); }, [load]);

  // Live-sync: poll every POLL_MS while the tab is visible. Pause while a
  // modal/alert is open to keep the UI calm (document.hidden handles that too).
  useEffect(() => {
    let timer = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      load({ silent: true });
    };
    timer = setInterval(tick, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const create = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    pendingWriteRef.current += 1;
    try {
      const payload = { kind, rig_id: rigId, ...form };
      if (payload.quantity === "") delete payload.quantity;
      else payload.quantity = parseFloat(payload.quantity);
      await axios.post(`${API}/team/items`, payload, { withCredentials: true });
      setForm({ name: "", quantity: "", unit: "", location: "", note: "", status: cfg.statuses[0], priority: "MED" });
      setShowAdd(false);
    } finally {
      pendingWriteRef.current = Math.max(0, pendingWriteRef.current - 1);
      setSaving(false);
      // Fetch after releasing the write-guard so the new item shows immediately.
      await load({ silent: true });
    }
  };

  const updateStatus = async (item, newStatus) => {
    // Optimistic update
    setItems((prev) => prev.map((i) => i.item_id === item.item_id ? { ...i, status: newStatus } : i));
    pendingWriteRef.current += 1;
    try {
      await axios.patch(`${API}/team/items/${item.item_id}`, { status: newStatus }, { withCredentials: true });
    } catch {
      // Roll back on error
      setItems((prev) => prev.map((i) => i.item_id === item.item_id ? { ...i, status: item.status } : i));
    } finally {
      pendingWriteRef.current = Math.max(0, pendingWriteRef.current - 1);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    const prev = items;
    setItems((p) => p.filter((i) => i.item_id !== item.item_id));
    pendingWriteRef.current += 1;
    try {
      await axios.delete(`${API}/team/items/${item.item_id}`, { withCredentials: true });
    } catch {
      setItems(prev); // roll back
    } finally {
      pendingWriteRef.current = Math.max(0, pendingWriteRef.current - 1);
    }
  };

  // ─── Edit flow ───────────────────────────────────────
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  const startEdit = (item) => {
    setEditingId(item.item_id);
    setEditDraft({
      name: item.name || "",
      quantity: item.quantity ?? "",
      unit: item.unit || "",
      location: item.location || "",
      note: item.note || "",
    });
  };
  const cancelEdit = () => { setEditingId(null); setEditDraft({}); };

  const saveEdit = async (item) => {
    const payload = { ...editDraft };
    if (payload.quantity === "" || payload.quantity === null) payload.quantity = null;
    else payload.quantity = parseFloat(payload.quantity);
    // Optimistic
    setItems((prev) => prev.map((i) => i.item_id === item.item_id ? { ...i, ...payload } : i));
    const prev = items;
    pendingWriteRef.current += 1;
    try {
      await axios.patch(`${API}/team/items/${item.item_id}`, payload, { withCredentials: true });
      cancelEdit();
    } catch (e) {
      setItems(prev);
      alert(e.response?.data?.detail || "Save failed.");
    } finally {
      pendingWriteRef.current = Math.max(0, pendingWriteRef.current - 1);
    }
  };

  const bumpQuantity = async (item, delta) => {
    if (item.quantity === null || item.quantity === undefined) return;
    const next = Math.max(0, (parseFloat(item.quantity) || 0) + delta);
    setItems((prev) => prev.map((i) => i.item_id === item.item_id ? { ...i, quantity: next } : i));
    pendingWriteRef.current += 1;
    try {
      await axios.patch(`${API}/team/items/${item.item_id}`, { quantity: next }, { withCredentials: true });
    } catch {
      // revert on failure
      setItems((prev) => prev.map((i) => i.item_id === item.item_id ? { ...i, quantity: item.quantity } : i));
    } finally {
      pendingWriteRef.current = Math.max(0, pendingWriteRef.current - 1);
    }
  };

  const Icon = cfg.Icon;

  return (
    <div data-testid={`team-list-${kind}`} className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between border-b border-[#E5E7EB]" style={{ background: `${cfg.accent}10` }}>
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: cfg.accent }} strokeWidth={2.5} />
          <span className="text-sm font-bold" style={{ color: cfg.accent }}>{cfg.label}</span>
          <span className="text-[10px] text-[#595959]">{items.length} items · {rigLabel(rigId)}</span>
          {syncing && <RefreshCw className="w-3 h-3 animate-spin text-[#8A8A8A]" strokeWidth={2.5} />}
          {!syncing && !loading && <span className="text-[9px] text-[#8A8A8A] font-semibold tracking-wide">LIVE</span>}
        </div>
        <button
          data-testid={`team-list-add-${kind}`}
          onClick={() => setShowAdd((v) => !v)}
          className="text-xs font-semibold flex items-center gap-1 px-2 py-1 rounded"
          style={{ background: cfg.accent, color: "white" }}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> Add
        </button>
      </div>

      {showAdd && (
        <div className="p-3 bg-[#F9FAFB] border-b border-[#E5E7EB] space-y-2" data-testid={`team-list-add-form-${kind}`}>
          <div className="grid grid-cols-2 gap-2">
            <input data-testid={`itm-input-name-${kind}`} placeholder="Item name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm" />
            {cfg.quantityLabel && (
              <>
                <input data-testid={`itm-input-qty-${kind}`} type="text" inputMode="decimal" placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                <input data-testid={`itm-input-unit-${kind}`} placeholder="Unit (ea, m, L, drums…)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
              </>
            )}
            <input data-testid={`itm-input-location-${kind}`} placeholder={kind === "todo" ? "Well / rig / area" : "Location (Blue Shed / Rack 3…)"} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm" />
            <input data-testid={`itm-input-note-${kind}`} placeholder="Note / detail" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm" />
            <select data-testid={`itm-input-status-${kind}`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm">
              {cfg.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {kind === "todo" && (
              <select data-testid={`itm-input-priority-todo`} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm">
                {["LOW", "MED", "HIGH"].map((s) => <option key={s} value={s}>{s} priority</option>)}
              </select>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="text-xs text-[#595959] px-3 py-1.5">Cancel</button>
            <button data-testid={`team-list-save-${kind}`} disabled={saving || !form.name.trim()} onClick={create} className="text-xs font-bold text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ background: cfg.accent }}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-[#F0F0F0]">
        {loading && <div className="p-6 text-center text-[12px] text-[#595959]"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="p-6 text-center text-[12px] text-[#595959]">No {cfg.label.toLowerCase()} yet. Tap Add to log the first one.</div>
        )}
        {items.map((it) => {
          const isEditing = editingId === it.item_id;
          if (isEditing) {
            return (
              <div key={it.item_id} data-testid={`team-list-item-${kind}`} className="p-2.5 bg-[#FFF8E1] border-l-4 border-[#F59E0B] space-y-1.5">
                <input data-testid={`itm-edit-name-${it.item_id}`} value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className="w-full px-2 py-1.5 border border-[#CCC] rounded text-sm" placeholder="Name" />
                {cfg.quantityLabel && (
                  <div className="flex gap-1.5">
                    <input data-testid={`itm-edit-qty-${it.item_id}`} type="text" inputMode="decimal" value={editDraft.quantity} onChange={(e) => setEditDraft({ ...editDraft, quantity: e.target.value })} className="flex-1 px-2 py-1.5 border border-[#CCC] rounded text-sm" placeholder="Qty" />
                    <input data-testid={`itm-edit-unit-${it.item_id}`} value={editDraft.unit} onChange={(e) => setEditDraft({ ...editDraft, unit: e.target.value })} className="w-24 px-2 py-1.5 border border-[#CCC] rounded text-sm" placeholder="Unit" />
                  </div>
                )}
                <input data-testid={`itm-edit-location-${it.item_id}`} value={editDraft.location} onChange={(e) => setEditDraft({ ...editDraft, location: e.target.value })} className="w-full px-2 py-1.5 border border-[#CCC] rounded text-sm" placeholder="Location" />
                <input data-testid={`itm-edit-note-${it.item_id}`} value={editDraft.note} onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} className="w-full px-2 py-1.5 border border-[#CCC] rounded text-sm" placeholder="Note" />
                <div className="flex gap-2 justify-end">
                  <button data-testid={`itm-edit-cancel-${it.item_id}`} onClick={cancelEdit} className="text-[11px] text-[#595959] px-2 py-1 inline-flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
                  <button data-testid={`itm-edit-save-${it.item_id}`} onClick={() => saveEdit(it)} disabled={!editDraft.name?.trim()} className="text-[11px] font-bold text-white px-3 py-1 rounded disabled:opacity-50 inline-flex items-center gap-1" style={{ background: cfg.accent }}><Check className="w-3 h-3" /> Save</button>
                </div>
              </div>
            );
          }
          return (
          <div key={it.item_id} data-testid={`team-list-item-${kind}`} className="p-2.5 flex items-start gap-2 hover:bg-[#FAFAFA]">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-[#262626]">{it.name}</span>
                {it.quantity !== null && it.quantity !== undefined && (
                  <div className="inline-flex items-center gap-0.5 bg-white border border-[#D4D4D4] rounded">
                    <button data-testid={`itm-qty-down-${it.item_id}`} onClick={() => bumpQuantity(it, -1)} className="px-1 py-0.5 text-[#595959] hover:bg-[#F0F0F0] tap-44" aria-label="Decrease"><Minus className="w-3 h-3" strokeWidth={2.5} /></button>
                    <span className="text-[11px] font-bold text-[#262626] min-w-[1.75em] text-center">{it.quantity}{it.unit ? " " + it.unit : ""}</span>
                    <button data-testid={`itm-qty-up-${it.item_id}`} onClick={() => bumpQuantity(it, +1)} className="px-1 py-0.5 text-[#595959] hover:bg-[#F0F0F0] tap-44" aria-label="Increase"><Plus className="w-3 h-3" strokeWidth={2.5} /></button>
                  </div>
                )}
                <select
                  data-testid={`itm-status-${it.item_id}`}
                  value={it.status || cfg.statuses[0]}
                  onChange={(e) => updateStatus(it, e.target.value)}
                  className={`text-[9px] font-bold px-1.5 py-[2px] rounded border ${STATUS_STYLE[it.status] || "bg-[#EEE] text-[#333] border-[#CCC]"} uppercase tracking-wide`}
                >
                  {cfg.statuses.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
                {it.priority && kind === "todo" && (
                  <span className={`text-[9px] font-bold px-1.5 py-[2px] rounded border uppercase ${it.priority === "HIGH" ? "bg-[#F8D7DA] text-[#721C24] border-[#F5C6CB]" : it.priority === "MED" ? "bg-[#FFF3CD] text-[#856404] border-[#FFE69C]" : "bg-[#EEE] text-[#333] border-[#CCC]"}`}>{it.priority}</span>
                )}
              </div>
              {it.location && (
                <div className="text-[11px] text-[#595959] mt-0.5 flex items-center gap-1">
                  <MapPin className="w-3 h-3" strokeWidth={2.5} /> {it.location}
                </div>
              )}
              {it.note && <div className="text-[11px] text-[#444] mt-0.5 italic">{it.note}</div>}
              <div className="text-[9px] text-[#8A8A8A] mt-0.5">by {it.created_by} · {new Date(it.created_at).toLocaleDateString()}</div>
            </div>
            <button data-testid={`itm-edit-${it.item_id}`} onClick={() => startEdit(it)} className="text-[#FF6B1A] hover:bg-[#FFF7EF] rounded p-1 tap-44" aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></button>
            <button data-testid={`itm-delete-${it.item_id}`} onClick={() => remove(it)} className="text-[#C00000] hover:bg-[#F8D7DA] rounded p-1 tap-44" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          );
        })}
      </div>
    </div>
  );
};

export default TeamItemsList;
