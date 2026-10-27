import React, { useState } from "react";
import { X, Save, Loader2, User, Users } from "lucide-react";
import { toast } from "sonner";
import { postResilient } from "../lib/fieldStore";

const SaveJobDialog = ({ sheetKey, sheetTitle, unitSystem, values, hasTeam, onClose, onSaved }) => {
  const [title, setTitle] = useState(`${sheetTitle} — ${new Date().toLocaleDateString()}`);
  const [visibility, setVisibility] = useState("private");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await postResilient(
        "/jobs",
        { sheet_key: sheetKey, title: title.trim(), unit_system: unitSystem, values, visibility },
        { kind: "job" },
      );
      if (res.status === "rejected") { setError(res.error || "Failed to save"); setSaving(false); return; }
      if (res.status === "queued") toast.warning("Saved on this device — will upload when signal returns");
      onSaved && onSaved(res.data);
      onClose();
    } catch (e) {
      setError("Failed to save");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4 dialog-sheet" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl max-w-md w-full dialog-sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#D4D4D4]">
          <h3 className="text-base font-bold text-[#262626] flex items-center gap-2">
            <Save className="w-4 h-4 text-[#FF6B1A]" /> Save Field Job
          </h3>
          <button onClick={onClose} className="text-[#595959] hover:text-[#262626]"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-[#444] block mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#FAFAFA] border border-[#CCC] px-3 py-2 rounded text-sm outline-none focus:border-[#FF6B1A] focus:ring-2 focus:ring-[#FF6B1A]/10"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#444] block mb-1">Visibility</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setVisibility("private")}
                className={`flex items-center gap-2 justify-center py-2 rounded text-sm font-semibold border ${visibility === "private" ? "bg-[#FFF1E6] border-[#FF6B1A] text-[#C44A08]" : "bg-white border-[#D4D4D4] text-[#444]"}`}
              >
                <User className="w-4 h-4" /> Private
              </button>
              <button
                onClick={() => hasTeam && setVisibility("team")}
                disabled={!hasTeam}
                className={`flex items-center gap-2 justify-center py-2 rounded text-sm font-semibold border ${visibility === "team" ? "bg-[#FFF1E6] border-[#FF6B1A] text-[#C44A08]" : "bg-white border-[#D4D4D4] text-[#444]"} ${!hasTeam ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Users className="w-4 h-4" /> Team
              </button>
            </div>
            {!hasTeam && <p className="text-[11px] text-[#595959] mt-1">Join or create a team to enable team-shared jobs.</p>}
          </div>
          {error && <p className="text-xs text-[#C00000]">{error}</p>}
        </div>
        <div className="px-4 py-3 border-t border-[#D4D4D4] flex justify-end gap-2">
          <button onClick={onClose} className="border border-[#D4D4D4] text-[#444] px-4 py-2 rounded text-sm font-semibold">Cancel</button>
          <button onClick={save} disabled={saving || !title.trim()} className="bg-[#FF6B1A] hover:bg-[#C44A08] text-white px-4 py-2 rounded text-sm font-semibold flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save Job
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveJobDialog;
