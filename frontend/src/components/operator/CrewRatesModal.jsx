import React, { useEffect, useState } from "react";
import { Users, X } from "lucide-react";

export function CrewRatesModal({ crew, onSave, onClose }) {
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const [draft, setDraft] = useState(crew);
  const update = (id, field, v) => setDraft((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: parseFloat(v) || 0 } : m)));
  const total = draft.reduce((s, m) => s + m.hourlyRate * m.hoursLogged, 0);

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4" data-testid="crew-rates-modal">
      <div className="bg-[#0B1120] border border-slate-800 w-full max-w-xl rounded-2xl p-5 space-y-4 op-pop">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-orange-500" /> Crew Pay Rates & Timesheets
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Adjustable hourly rates for direct time logging.</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white" data-testid="crew-rates-close-btn"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          {draft.map((m) => (
            <div key={m.id} className="p-3 bg-[#0D1526] border border-slate-800 rounded-xl flex items-center justify-between gap-3" data-testid={`crew-row-${m.id}`}>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-100">{m.name}</div>
                <div className="text-[10px] text-slate-400 font-mono truncate">{m.designation}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 focus-within:border-orange-500 transition-colors">
                  <span className="text-xs text-slate-400 font-mono mr-1">$</span>
                  <input type="number" step="0.50" min="0" value={m.hourlyRate} onChange={(e) => update(m.id, "hourlyRate", e.target.value)}
                    className="w-16 bg-transparent text-xs text-right font-mono font-bold text-orange-400 focus:outline-none" data-testid={`crew-rate-input-${m.id}`} />
                  <span className="text-[10px] text-slate-500 font-mono ml-1">/hr</span>
                </div>
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
                  <input type="number" step="0.5" min="0" value={m.hoursLogged} onChange={(e) => update(m.id, "hoursLogged", e.target.value)}
                    className="w-10 bg-transparent text-xs text-right font-mono text-slate-200 focus:outline-none" data-testid={`crew-hours-input-${m.id}`} />
                  <span className="text-[10px] text-slate-500 font-mono ml-1">hrs</span>
                </div>
                <div className="w-20 text-right text-[11px] text-emerald-400 font-mono font-bold" data-testid={`crew-cost-${m.id}`}>
                  ${(m.hourlyRate * m.hoursLogged).toFixed(2)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-between text-xs font-mono px-1">
          <span className="text-slate-400 uppercase">Shift crew cost</span>
          <span className="text-emerald-400 font-bold" data-testid="crew-total-cost">${total.toFixed(2)}</span>
        </div>

        <button onClick={() => onSave(draft)} className="w-full py-2 bg-orange-600 hover:bg-orange-500 transition-colors font-bold text-white text-xs rounded-lg" data-testid="crew-rates-save-btn">
          Save Rates
        </button>
      </div>
    </div>
  );
}
