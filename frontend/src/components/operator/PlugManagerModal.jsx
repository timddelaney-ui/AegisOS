import React, { useEffect, useState } from "react";
import { X, Trash2, Pencil, Save } from "lucide-react";

export const PLUG_TYPES = {
  frac_plug: "Frac plug", bridge_plug: "Bridge plug", ball_seat: "Ball seat", packer: "Packer", other: "Other",
};
const inputCls = "w-full bg-slate-900 border border-slate-800 focus:border-purple-500 outline-none rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 mt-1";
const blank = { name: "", plug_type: "frac_plug", top: "", bottom: "", notes: "" };

// Depth inputs are in display units; toFt / fromFt convert to canonical ft
export function PlugManagerModal({ plugs, canEdit, depthLabel, toFt, fromFt, onSave, onDelete, onClose, wellName }) {
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.name.trim() && form.top !== "" && form.bottom !== "";

  const startEdit = (p) => {
    setEditId(p.plug_id);
    setForm({ name: p.name, plug_type: p.plug_type, top: +fromFt(p.top_md_ft).toFixed(1), bottom: +fromFt(p.bottom_md_ft).toFixed(1), notes: p.notes || "" });
  };
  const submit = async () => {
    setBusy(true);
    const ok = await onSave(editId, {
      name: form.name.trim(), plug_type: form.plug_type, notes: form.notes || null,
      top_md_ft: toFt(parseFloat(form.top)), bottom_md_ft: toFt(parseFloat(form.bottom)),
    });
    setBusy(false);
    if (ok) { setForm(blank); setEditId(null); }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" data-testid="plug-manager-modal">
      <div className="bg-[#0B1120] border border-slate-800 w-full max-w-xl rounded-2xl p-5 space-y-4 max-h-[88vh] overflow-y-auto op-pop">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-100 uppercase tracking-wide">Plug records</h3>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">{wellName}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white" data-testid="plug-manager-close-btn"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 bg-[#0D1526] border border-slate-800 rounded-xl space-y-3">
          <span className="text-xs font-bold uppercase text-slate-300">{editId ? "Edit plug" : "Add a plug"}</span>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[10px] uppercase text-slate-400">ID / name
              <input value={form.name} onChange={set("name")} placeholder="P1" className={inputCls} data-testid="plug-name-input" />
            </label>
            <label className="text-[10px] uppercase text-slate-400">Type
              <select value={form.plug_type} onChange={set("plug_type")} className={inputCls} data-testid="plug-type-select">
                {Object.entries(PLUG_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-[10px] uppercase text-slate-400">Top MD ({depthLabel})
              <input type="number" value={form.top} onChange={set("top")} className={inputCls} data-testid="plug-top-input" />
            </label>
            <label className="text-[10px] uppercase text-slate-400">Bottom MD ({depthLabel})
              <input type="number" value={form.bottom} onChange={set("bottom")} className={inputCls} data-testid="plug-bottom-input" />
            </label>
            <label className="col-span-2 text-[10px] uppercase text-slate-400">Notes (optional)
              <input value={form.notes} onChange={set("notes")} placeholder="Stage 3 · set 14:20" className={inputCls} data-testid="plug-notes-input" />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={submit} disabled={!valid || busy} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 transition-colors font-bold text-white text-xs rounded-lg" data-testid="plug-save-btn">
              <Save className="w-3.5 h-3.5" /> {editId ? "Save changes" : "Add plug"}
            </button>
            {editId && <button onClick={() => { setEditId(null); setForm(blank); }} className="px-3 py-2 border border-slate-700 text-slate-300 text-xs rounded-lg" data-testid="plug-cancel-edit-btn">Cancel</button>}
          </div>
        </div>

        <div className="space-y-2" data-testid="plug-record-list">
          {plugs.length === 0 && <p className="text-xs text-slate-500">No plugs recorded for this well yet.</p>}
          {plugs.map((p) => (
            <div key={p.plug_id} className="flex items-center justify-between gap-2 p-2.5 bg-[#0D1526] border border-slate-800 rounded-lg text-xs" data-testid={`plug-record-${p.plug_id}`}>
              <div className="min-w-0">
                <span className="font-bold text-purple-400 mr-1.5">{p.name}</span>
                <span className="text-slate-300">{PLUG_TYPES[p.plug_type]}</span>
                <div className="text-[10px] font-mono text-slate-400">{fromFt(p.top_md_ft).toFixed(1)}–{fromFt(p.bottom_md_ft).toFixed(1)} {depthLabel}{p.notes ? ` · ${p.notes}` : ""}</div>
              </div>
              {canEdit && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEdit(p)} className="p-1 text-slate-400 hover:text-purple-300" data-testid={`plug-edit-${p.plug_id}`}><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => onDelete(p.plug_id)} className="p-1 text-slate-400 hover:text-rose-400" data-testid={`plug-delete-${p.plug_id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
          ))}
          {!canEdit && plugs.length > 0 && <p className="text-[10px] text-slate-500">Editing and deleting plugs needs a Supervisor or Management role.</p>}
        </div>
      </div>
    </div>
  );
}
