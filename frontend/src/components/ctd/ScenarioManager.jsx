import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, FolderOpen, Trash2, X, Plus, Users, Lock } from "lucide-react";
import { API } from "../../context/AuthContext";

/**
 * Save / Load / Delete named well scenarios for the CT Drilling calculator.
 * Scenarios store the entire input state (vals + unit_system). Load swaps
 * them back into the parent calculator.
 */
const ScenarioManager = ({ currentVals, unitSystem, onLoad }) => {
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [wellName, setWellName] = useState("");
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/ctd-scenarios`, { withCredentials: true });
      setList(data || []);
    } catch { setList([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) refresh(); }, [open]);

  const save = async () => {
    if (!wellName.trim()) { toast.error("Give the well a name"); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/ctd-scenarios`, {
        well_name: wellName.trim(),
        mode: currentVals.mode,
        unit_system: unitSystem,
        values: currentVals,
        note: note.trim() || null,
        visibility,
      }, { withCredentials: true });
      toast.success(`Saved scenario · ${wellName.trim()}`);
      setSaveOpen(false);
      setWellName(""); setNote(""); setVisibility("private");
      if (open) refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const load = (s) => {
    onLoad({ values: s.values, mode: s.mode, unit_system: s.unit_system });
    toast.success(`Loaded · ${s.well_name}`);
    setOpen(false);
  };

  const remove = async (s, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${s.well_name}"?`)) return;
    try {
      await axios.delete(`${API}/ctd-scenarios/${s.scenario_id}`, { withCredentials: true });
      toast.success("Deleted");
      refresh();
    } catch { toast.error("Delete failed"); }
  };

  return (
    <>
      <button
        data-testid="ctd-save-scenario-btn"
        onClick={() => setSaveOpen(true)}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-semibold border border-[#D4D4D4] bg-white hover:border-[#107C41] hover:text-[#107C41]"
      >
        <Save className="w-3.5 h-3.5" /> Save scenario
      </button>
      <button
        data-testid="ctd-load-scenario-btn"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-semibold border border-[#D4D4D4] bg-white hover:border-[#107C41] hover:text-[#107C41]"
      >
        <FolderOpen className="w-3.5 h-3.5" /> Open scenario
      </button>

      {/* Save dialog */}
      {saveOpen && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-end sm:items-center justify-center p-3" onClick={() => setSaveOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-md p-4 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="ctd-save-dialog">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#262626]">Save CT Drilling scenario</h3>
              <button onClick={() => setSaveOpen(false)}><X className="w-4 h-4 text-[#595959]" /></button>
            </div>
            <label className="block mb-2">
              <span className="text-[11px] font-semibold text-[#333]">Well name / scenario *</span>
              <input
                data-testid="ctd-save-wellname"
                value={wellName}
                onChange={(e) => setWellName(e.target.value)}
                placeholder="e.g. 4-32-45-06W5 · UBD drill-out"
                className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#107C41]/40"
                autoFocus
              />
            </label>
            <label className="block mb-2">
              <span className="text-[11px] font-semibold text-[#333]">Note (optional)</span>
              <textarea
                data-testid="ctd-save-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Formation, contingencies, pre-job thinking…"
                className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm resize-none"
              />
            </label>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-semibold text-[#333]">Share with:</span>
              <div className="flex bg-[#F0F0F0] rounded p-0.5">
                <button
                  onClick={() => setVisibility("private")}
                  className={`px-2 py-0.5 text-[11px] rounded font-semibold inline-flex items-center gap-1 ${visibility === "private" ? "bg-white shadow-sm text-[#262626]" : "text-[#595959]"}`}
                >
                  <Lock className="w-3 h-3" /> Just me
                </button>
                <button
                  data-testid="ctd-save-team"
                  onClick={() => setVisibility("team")}
                  className={`px-2 py-0.5 text-[11px] rounded font-semibold inline-flex items-center gap-1 ${visibility === "team" ? "bg-white shadow-sm text-[#262626]" : "text-[#595959]"}`}
                >
                  <Users className="w-3 h-3" /> My crew
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSaveOpen(false)} className="px-3 py-1.5 text-[12px] font-semibold text-[#595959] hover:text-[#262626]">Cancel</button>
              <button
                data-testid="ctd-save-confirm-btn"
                onClick={save}
                disabled={busy || !wellName.trim()}
                className="px-3 py-1.5 bg-[#107C41] hover:bg-[#0D6535] text-white rounded text-[12px] font-bold disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load drawer */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-end sm:items-center justify-center p-3" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="ctd-load-dialog">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-sm font-bold text-[#262626]">Saved scenarios</h3>
              <button onClick={() => setOpen(false)}><X className="w-4 h-4 text-[#595959]" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {loading ? (
                <p className="text-[12px] text-[#595959] p-4 text-center">Loading…</p>
              ) : list.length === 0 ? (
                <div className="text-center p-6">
                  <FolderOpen className="w-10 h-10 text-[#C4C4C4] mx-auto mb-2" />
                  <p className="text-[12px] text-[#595959]">No scenarios saved yet. Fill in the calculator and hit <strong>Save</strong>.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {list.map((s) => (
                    <button
                      key={s.scenario_id}
                      data-testid={`ctd-scenario-row-${s.scenario_id}`}
                      onClick={() => load(s)}
                      className="w-full text-left p-3 rounded-lg border border-[#D4D4D4] hover:border-[#107C41] hover:bg-[#F0F9F3] transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-[#262626] truncate">{s.well_name}</p>
                            <span className={`text-[10px] font-bold uppercase px-1.5 py-[1px] rounded ${s.mode === "underbalanced" ? "bg-[#FDE8E8] text-[#C00000]" : "bg-[#E6F4EA] text-[#0D6535]"}`}>
                              {s.mode === "underbalanced" ? "UBD" : "BAL"}
                            </span>
                            {s.visibility === "team" && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-[#DBEAFE] text-[#0056B3] px-1.5 py-[1px] rounded">
                                <Users className="w-2.5 h-2.5" /> Crew
                              </span>
                            )}
                          </div>
                          {s.note && <p className="text-[11px] text-[#595959] mt-0.5 line-clamp-2">{s.note}</p>}
                          <p className="text-[10px] text-[#777] mt-0.5">
                            by {s.user_name} · {new Date(s.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          data-testid={`ctd-scenario-delete-${s.scenario_id}`}
                          onClick={(e) => remove(s, e)}
                          className="p-1.5 rounded text-[#595959] hover:text-[#C00000] hover:bg-[#FEE2E2] opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ScenarioManager;
