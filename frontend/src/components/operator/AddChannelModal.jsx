import React, { useState } from "react";
import { X, Trash2 } from "lucide-react";
import { JOB_SETS } from "../../lib/operatorConfig";

const inputCls = "w-full bg-slate-900 border border-slate-800 focus:border-orange-500 outline-none rounded px-2.5 py-1.5 text-xs text-slate-200 mt-1";

export function AddChannelModal({ pressLabel, toPsi, custom, onAdd, onRemove, onClose }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("Custom");
  const [warn, setWarn] = useState("");
  const [crit, setCrit] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      id: `c_${Date.now()}`, title: name.trim(), group, dim: "pressure", tag: group,
      warn: warn === "" ? null : toPsi(parseFloat(warn)),
      crit: crit === "" ? null : toPsi(parseFloat(crit)),
    });
    setName(""); setWarn(""); setCrit("");
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" data-testid="manage-channels-modal">
      <div className="bg-[#0B1120] border border-slate-800 w-full max-w-lg rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto op-pop">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 className="text-base font-bold text-slate-100 uppercase tracking-wide">Manage channels</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white" data-testid="manage-channels-close-btn"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 bg-[#0D1526] border border-slate-800 rounded-xl space-y-3">
          <span className="text-xs font-bold uppercase text-slate-300">Add a channel</span>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[10px] uppercase text-slate-400">Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tubing press" className={inputCls} data-testid="add-channel-name-input" />
            </label>
            <label className="text-[10px] uppercase text-slate-400">Group
              <select value={group} onChange={(e) => setGroup(e.target.value)} className={inputCls} data-testid="add-channel-group-select">
                {["Custom", ...JOB_SETS].map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
            <label className="text-[10px] uppercase text-slate-400">Warn ({pressLabel})
              <input type="number" value={warn} onChange={(e) => setWarn(e.target.value)} className={inputCls} data-testid="add-channel-warn-input" />
            </label>
            <label className="text-[10px] uppercase text-slate-400">Crit ({pressLabel})
              <input type="number" value={crit} onChange={(e) => setCrit(e.target.value)} className={inputCls} data-testid="add-channel-crit-input" />
            </label>
          </div>
          <p className="text-[10px] text-slate-400">Limits are in {pressLabel}. Once the channel is mapped to a DAQ source tag, the tile turns amber at warn and red at crit.</p>
          <button onClick={submit} disabled={!name.trim()} className="w-full py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 transition-colors font-bold text-white text-xs rounded-lg" data-testid="add-channel-submit-btn">
            Add channel
          </button>
        </div>

        {custom.length > 0 && (
          <div className="space-y-2" data-testid="custom-channel-list">
            <span className="text-[10px] font-bold uppercase text-slate-400">Your channels</span>
            {custom.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-2 bg-[#0D1526] border border-slate-800 rounded-lg text-xs">
                <span className="text-slate-200">{c.title} <span className="text-slate-500 font-mono">· {c.group}</span></span>
                <button onClick={() => onRemove(c.id)} className="p-1 text-slate-500 hover:text-rose-400" data-testid={`remove-channel-${c.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
