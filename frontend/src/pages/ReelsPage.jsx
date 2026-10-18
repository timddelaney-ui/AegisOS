import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher, isManagement } from "../lib/roles";
import { useActiveReel } from "../context/ActiveReelContext";
import { defaultSmys } from "../lib/ctPhysics";
import { Plus, Upload, Trash2, CheckCircle2, Lock } from "lucide-react";

const emptyInterval = () => ({ start_md_ft: 0, end_md_ft: 1000, od_in: 2.0, wt_in: 0.175, grade: "QT-900", smys_psi: 90000 });

const ReelCard = ({ reel, isActive, canWrite, onActivate, onDelete }) => (
  <div data-testid={`reel-card-${reel.reel_id}`} className={`bg-white border rounded-lg p-3 ${isActive ? "border-[#107C41] shadow-md" : "border-[#D4D4D4]"}`}>
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-[#262626]">{reel.name}</h3>
          {isActive && <span className="text-[9px] font-bold bg-[#DCFCE7] text-[#065F46] px-1.5 py-0.5 rounded uppercase">Active</span>}
          {reel.retired && <span className="text-[9px] font-bold bg-[#F3F4F6] text-[#595959] px-1.5 py-0.5 rounded uppercase">Retired</span>}
        </div>
        <p className="text-[11px] text-[#595959] mt-0.5">
          {reel.serial ? `S/N ${reel.serial} · ` : ""}
          {Math.round(reel.total_length_ft)} ft · {reel.intervals?.length || 0} interval(s) · {reel.source}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {canWrite && !isActive && !reel.retired && (
          <button data-testid={`activate-reel-${reel.reel_id}`} onClick={() => onActivate(reel.reel_id)} className="text-[11px] bg-[#107C41] text-white px-2 py-1 rounded font-bold">Set Active</button>
        )}
        {canWrite && isManagement && (
          <button data-testid={`delete-reel-${reel.reel_id}`} onClick={() => onDelete(reel.reel_id)} className="text-[#C00000] p-1 hover:bg-[#F8D7DA] rounded"><Trash2 className="w-3.5 h-3.5" /></button>
        )}
      </div>
    </div>
    <div className="mt-2 grid grid-cols-5 gap-1 text-[10px] text-[#595959] font-semibold uppercase">
      <span>Start ft</span><span>End ft</span><span>OD in</span><span>WT in</span><span>Grade</span>
    </div>
    {(reel.intervals || []).map((s, i) => (
      <div key={i} className="grid grid-cols-5 gap-1 text-[11px] text-[#262626] tabular-nums bg-[#F3F4F6] rounded px-1 py-0.5 mt-0.5">
        <span>{s.start_md_ft}</span><span>{s.end_md_ft}</span><span>{s.od_in}</span><span>{s.wt_in}</span><span>{s.grade}</span>
      </div>
    ))}
  </div>
);

export default function ReelsPage() {
  const { user } = useAuth();
  const canWrite = isSupervisorOrHigher(user);
  const canDelete = isManagement(user);
  const { reels, activeReel, refresh } = useActiveReel();
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [serial, setSerial] = useState("");
  const [intervals, setIntervals] = useState([emptyInterval()]);
  const [file, setFile] = useState(null);
  const [uploadName, setUploadName] = useState("");

  useEffect(() => { refresh(); }, []); // eslint-disable-line

  const totalLen = useMemo(() => Math.max(0, ...intervals.map((s) => Number(s.end_md_ft) || 0)), [intervals]);

  const addInterval = () => setIntervals((prev) => [...prev, { ...emptyInterval(), start_md_ft: prev.length ? prev[prev.length - 1].end_md_ft : 0, end_md_ft: (prev.length ? prev[prev.length - 1].end_md_ft : 0) + 1000 }]);
  const removeInterval = (i) => setIntervals((prev) => prev.filter((_, idx) => idx !== i));
  const updateInterval = (i, field, val) => setIntervals((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: field === "grade" ? val : Number(val), smys_psi: field === "grade" ? defaultSmys(val) : s.smys_psi } : s));

  const createReel = async () => {
    if (!name.trim()) return toast.error("Reel name required");
    if (intervals.length === 0) return toast.error("At least one interval needed");
    try {
      await axios.post(`${API}/reels`, { name, serial: serial || undefined, total_length_ft: totalLen, intervals, source: "manual" }, { withCredentials: true });
      toast.success("Reel created");
      setShowNew(false); setName(""); setSerial(""); setIntervals([emptyInterval()]);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Create failed");
    }
  };

  const activateReel = async (id) => {
    try { await axios.post(`${API}/reels/${id}/activate`, {}, { withCredentials: true }); toast.success("Active reel set"); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const deleteReel = async (id) => {
    if (!window.confirm("Permanently delete this reel and its fatigue history?")) return;
    try { await axios.delete(`${API}/reels/${id}`, { withCredentials: true }); toast.success("Reel deleted"); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const uploadFile = async () => {
    if (!file || !uploadName.trim()) return toast.error("Pick a file and name");
    const fd = new FormData();
    fd.append("file", file); fd.append("name", uploadName);
    try {
      await axios.post(`${API}/reels/upload`, fd, { withCredentials: true, headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Reel uploaded"); setFile(null); setUploadName(""); refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="String & Reel Manager" subtitle="Tapered CT reel profiles — the active reel feeds every sheet, Von Mises egg, and fatigue heatmap." />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        {!canWrite && (
          <div className="bg-[#FFF3CD] border border-[#FFE69C] text-[#856404] text-[12px] rounded px-3 py-2 flex items-center gap-2">
            <Lock className="w-4 h-4" /> View-only — Supervisor or Management can edit reels.
          </div>
        )}

        {canWrite && (
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-[#262626] text-sm">Add Reel</h2>
              <button data-testid="toggle-new-reel" onClick={() => setShowNew(!showNew)} className="text-[11px] bg-[#107C41] text-white px-2 py-1 rounded font-bold flex items-center gap-1"><Plus className="w-3 h-3" /> Manual</button>
            </div>
            {showNew && (
              <div className="space-y-2 mb-3">
                <div className="grid grid-cols-2 gap-2">
                  <input data-testid="new-reel-name" placeholder="Name (e.g. 2in QT-900 Blue)" value={name} onChange={(e) => setName(e.target.value)} className="border rounded px-2 py-1 text-sm" />
                  <input placeholder="Serial (optional)" value={serial} onChange={(e) => setSerial(e.target.value)} className="border rounded px-2 py-1 text-sm" />
                </div>
                <div className="space-y-1">
                  <div className="grid grid-cols-6 gap-1 text-[10px] font-bold uppercase text-[#595959]">
                    <span>Start ft</span><span>End ft</span><span>OD in</span><span>WT in</span><span>Grade</span><span></span>
                  </div>
                  {intervals.map((s, i) => (
                    <div key={i} className="grid grid-cols-6 gap-1">
                      <input type="number" step="any" value={s.start_md_ft} onChange={(e) => updateInterval(i, "start_md_ft", e.target.value)} className="border rounded px-1 py-0.5 text-xs" />
                      <input type="number" step="any" value={s.end_md_ft} onChange={(e) => updateInterval(i, "end_md_ft", e.target.value)} className="border rounded px-1 py-0.5 text-xs" />
                      <input type="number" step="any" value={s.od_in} onChange={(e) => updateInterval(i, "od_in", e.target.value)} className="border rounded px-1 py-0.5 text-xs" />
                      <input type="number" step="any" value={s.wt_in} onChange={(e) => updateInterval(i, "wt_in", e.target.value)} className="border rounded px-1 py-0.5 text-xs" />
                      <select value={s.grade} onChange={(e) => updateInterval(i, "grade", e.target.value)} className="border rounded px-1 py-0.5 text-xs">
                        {["QT-800", "QT-900", "QT-1000", "CT-110", "CT-100", "CT-90", "CT-80"].map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                      <button onClick={() => removeInterval(i)} className="text-[#C00000] text-xs">×</button>
                    </div>
                  ))}
                  <button onClick={addInterval} className="text-[11px] text-[#107C41] font-bold flex items-center gap-1"><Plus className="w-3 h-3" />Add taper interval</button>
                </div>
                <button data-testid="submit-new-reel" onClick={createReel} className="bg-[#107C41] text-white px-3 py-1 text-xs font-bold rounded">Create Reel ({totalLen} ft)</button>
              </div>
            )}

            <div className="pt-2 border-t border-[#E5E5E5]">
              <h3 className="text-[11px] font-bold text-[#595959] uppercase mb-1 flex items-center gap-1"><Upload className="w-3 h-3" /> Upload CSV / JSON</h3>
              <p className="text-[10px] text-[#595959] mb-1">CSV columns: <code>start_md_ft, end_md_ft, od_in, wt_in, grade</code></p>
              <div className="flex gap-2">
                <input data-testid="upload-reel-name" placeholder="Reel name" value={uploadName} onChange={(e) => setUploadName(e.target.value)} className="border rounded px-2 py-1 text-xs flex-1" />
                <input data-testid="upload-reel-file" type="file" accept=".csv,.json,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs" />
                <button data-testid="upload-reel-submit" onClick={uploadFile} className="bg-[#0056B3] text-white px-2 py-1 text-xs font-bold rounded">Upload</button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {reels.length === 0 && <p className="text-sm text-[#595959] text-center py-8">No reels yet. {canWrite ? "Add one above." : "Ask Supervisor to add a reel."}</p>}
          {reels.map((r) => <ReelCard key={r.reel_id} reel={r} isActive={r.reel_id === activeReel?.reel_id} canWrite={canWrite} onActivate={activateReel} onDelete={deleteReel} />)}
        </div>
      </div>
    </div>
  );
}
