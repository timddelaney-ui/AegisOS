import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API } from "../context/AuthContext";
import { HUB_TILES, DEFAULT_TILE_ORDER } from "../lib/hubRegistry";
import { X, Eye, EyeOff, ArrowUp, ArrowDown, Home } from "lucide-react";

export const HubCustomizeButton = ({ onApply }) => {
  const [open, setOpen] = useState(false);
  const [tiles, setTiles] = useState([]);
  const [homeDefault, setHomeDefault] = useState("hub");

  const load = async () => {
    try {
      const r = await axios.get(`${API}/me/prefs`, { withCredentials: true });
      const existing = r.data?.hub_tiles || [];
      const existingIds = new Set(existing.map((t) => t.id));
      // Backfill any registry tile the user hasn't seen yet
      const merged = [...existing];
      DEFAULT_TILE_ORDER.forEach((id) => {
        if (!existingIds.has(id)) merged.push({ id, visible: true, order: merged.length });
      });
      // Drop IDs that are no longer in registry
      const filtered = merged.filter((t) => HUB_TILES[t.id]).sort((a, b) => a.order - b.order);
      setTiles(filtered.map((t, i) => ({ ...t, order: i })));
      setHomeDefault(r.data?.home_default || "hub");
    } catch { /* ignore */ }
  };

  const openModal = () => { setOpen(true); load(); };

  const toggle = (id) => setTiles((prev) => prev.map((t) => t.id === id ? { ...t, visible: !t.visible } : t));
  const move = (idx, dir) => setTiles((prev) => {
    const to = idx + dir;
    if (to < 0 || to >= prev.length) return prev;
    const next = [...prev];
    [next[idx], next[to]] = [next[to], next[idx]];
    return next.map((t, i) => ({ ...t, order: i }));
  });

  const save = async () => {
    try {
      await axios.patch(`${API}/me/prefs`, { hub_tiles: tiles, home_default: homeDefault }, { withCredentials: true });
      toast.success("Hub layout saved");
      setOpen(false);
      onApply && onApply();
    } catch (e) {
      toast.error("Save failed");
    }
  };

  return (
    <>
      <button
        data-testid="hub-customize-btn"
        onClick={openModal}
        className="text-[11px] font-bold bg-white border border-[#D4D4D4] hover:border-[#FF6B1A] rounded px-2 py-1 text-[#262626] flex items-center gap-1"
      >
        <Eye className="w-3 h-3" />Customize home
      </button>

      {open && (
        <div
          data-testid="hub-customize-modal"
          onClick={() => setOpen(false)}
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3"
        >
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-[#E5E5E5]">
              <h2 className="font-bold text-sm text-[#262626] flex items-center gap-2"><Eye className="w-4 h-4" />Customize your Home</h2>
              <button onClick={() => setOpen(false)} className="text-[#595959] hover:bg-[#F3F4F6] rounded p-1"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-3 border-b border-[#E5E5E5]">
              <p className="text-[11px] font-bold uppercase text-[#595959] mb-1 flex items-center gap-1"><Home className="w-3 h-3" />Home default</p>
              <select data-testid="home-default-select" value={homeDefault} onChange={(e) => setHomeDefault(e.target.value)} className="w-full border rounded px-2 py-1 text-sm">
                <option value="hub">Hub (this page)</option>
                <option value="live-ops">Live Ops dashboard</option>
                <option value="workbook">Workbook (17 sheets)</option>
              </select>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <p className="text-[11px] font-bold uppercase text-[#595959] mb-1">Tiles — toggle & reorder</p>
              {tiles.map((t, i) => {
                const meta = HUB_TILES[t.id];
                const Icon = meta?.Icon;
                return (
                  <div key={t.id} data-testid={`customize-tile-${t.id}`} className={`flex items-center gap-2 border rounded p-2 ${t.visible ? "border-[#D4D4D4]" : "border-[#E5E5E5] bg-[#F8FAFC] opacity-60"}`}>
                    {Icon && (
                      <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${meta.accent}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <span className="flex-1 min-w-0 text-xs font-bold truncate">{meta?.label || t.id}</span>
                    <button data-testid={`toggle-tile-${t.id}`} onClick={() => toggle(t.id)} className={`p-1 rounded ${t.visible ? "text-[#FF6B1A]" : "text-[#C4C4C4]"}`}>
                      {t.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button data-testid={`move-up-${t.id}`} onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-[#595959] disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                    <button data-testid={`move-down-${t.id}`} onClick={() => move(i, 1)} disabled={i === tiles.length - 1} className="p-1 text-[#595959] disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                  </div>
                );
              })}
            </div>

            <div className="p-3 border-t border-[#E5E5E5] flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded font-bold border">Cancel</button>
              <button data-testid="hub-customize-save" onClick={save} className="text-xs px-3 py-1.5 rounded font-bold bg-[#FF6B1A] text-white">Save layout</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
