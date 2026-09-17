import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Plus, Trash2, Loader2, Calendar, Printer, X, ChevronLeft, ChevronRight } from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";
import RigSelector from "../components/RigSelector";

const ROLES = ["Operator", "Supervisor", "Chief Op", "Swamper", "Pump Op", "Pusher", "Crane Op", "Other"];
const PATTERNS = [
  { id: "one_off", label: "One-off shift" },
  { id: "14/14",   label: "14/14 rotation" },
  { id: "20/10",   label: "20/10 rotation" },
  { id: "7/7",     label: "7/7 rotation" },
  { id: "custom",  label: "Custom on/off" },
];

const ROLE_COLOR = {
  Operator:   "#0D6535", Supervisor: "#0056B3", "Chief Op": "#7C3AED",
  Swamper:    "#C36600", "Pump Op":   "#0891B2", Pusher:    "#DB2777",
  "Crane Op": "#059669", Other:      "#6B7280",
};

const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isoDate = (d) => d.toISOString().slice(0, 10);

const buildWeeks = (start, count = 2) => {
  const s = new Date(start);
  s.setDate(s.getDate() - s.getDay()); // back to Sunday
  return Array.from({ length: count * 7 }, (_, i) => addDays(s, i));
};

const shiftCoversDay = (shift, day) => {
  const d = isoDate(day);
  return shift.start_date <= d && (shift.end_date || shift.start_date) >= d;
};

const CrewSchedulePage = () => {
  const navigate = useNavigate();
  const { rigId } = useRig();
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    crew_member_name: "", role: "Operator", tour: "day",
    pattern: "one_off", start_date: isoDate(new Date()), end_date: "",
    rotation_days_on: 14, rotation_days_off: 14, repeat_cycles: 1, note: "",
  });

  const days = useMemo(() => buildWeeks(anchor, 2), [anchor]);
  const rangeStart = isoDate(days[0]);
  const rangeEnd = isoDate(days[days.length - 1]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await axios.get(`${API}/schedule`, {
        params: { rig_id: rigId, start: rangeStart, end: rangeEnd },
        withCredentials: true,
      });
      setShifts(data.shifts || []);
    } catch (e) { setError(e.response?.data?.detail || "Failed to load."); }
    finally { setLoading(false); }
  }, [rigId, rangeStart, rangeEnd]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.crew_member_name?.trim()) return;
    setSaving(true); setError(null);
    try {
      const payload = { ...form, rig_id: rigId };
      if (payload.pattern !== "one_off") delete payload.end_date;
      if (payload.pattern === "one_off" && !payload.end_date) payload.end_date = payload.start_date;
      if (payload.pattern !== "custom") { delete payload.rotation_days_on; delete payload.rotation_days_off; }
      payload.repeat_cycles = parseInt(payload.repeat_cycles, 10) || 1;
      await axios.post(`${API}/schedule`, payload, { withCredentials: true });
      setShowAdd(false);
      // Jump the grid to the shift's start_date so users see the row they just created
      if (form.start_date) setAnchor(form.start_date);
      setForm({ ...form, crew_member_name: "", note: "" });
      await load();
    } catch (e) { setError(e.response?.data?.detail || "Failed to save."); }
    finally { setSaving(false); }
  };

  const remove = async (shift) => {
    if (!window.confirm(`Delete ${shift.crew_member_name}'s shift?`)) return;
    await axios.delete(`${API}/schedule/${shift.shift_id}`, { withCredentials: true });
    await load();
  };

  const printSchedule = () => window.print();

  // Group shifts by crew member for a row-per-person view.
  const rows = useMemo(() => {
    const map = new Map();
    for (const s of shifts) {
      const key = s.crew_member_name;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return Array.from(map.entries()).map(([name, list]) => ({ name, role: list[0].role, shifts: list }));
  }, [shifts]);

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col print:bg-white">
      <header className="bg-[#0D6535] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0 print:hidden">
        <button onClick={() => navigate("/hub")} data-testid="schedule-back" className="flex items-center gap-1.5 text-sm font-semibold"><ArrowLeft className="w-4 h-4" /> Back</button>
        <h1 className="text-sm font-semibold ml-4 flex items-center gap-2"><Calendar className="w-4 h-4" /> Crew Schedule · {rigLabel(rigId)}</h1>
      </header>
      <div className="print:hidden"><RigSelector /></div>

      <div className="flex-1 p-3 pb-10 overflow-auto">
        <div className="max-w-6xl mx-auto space-y-3">
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-3 flex items-center gap-2 flex-wrap print:hidden">
            <button data-testid="schedule-prev" onClick={() => setAnchor(isoDate(addDays(anchor, -14)))} className="p-1 rounded hover:bg-[#F0F9F3]"><ChevronLeft className="w-4 h-4" /></button>
            <div className="text-[13px] font-bold">{new Date(days[0]).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {new Date(days[days.length-1]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
            <button data-testid="schedule-next" onClick={() => setAnchor(isoDate(addDays(anchor, 14)))} className="p-1 rounded hover:bg-[#F0F9F3]"><ChevronRight className="w-4 h-4" /></button>
            <button data-testid="schedule-today" onClick={() => setAnchor(isoDate(new Date()))} className="text-[11px] font-semibold text-[#0D6535] hover:underline">Today</button>
            <div className="ml-auto flex gap-2">
              <button data-testid="schedule-print" onClick={printSchedule} className="text-[11px] font-bold text-[#0D6535] border border-[#0D6535] px-2 py-1 rounded flex items-center gap-1"><Printer className="w-3.5 h-3.5" /> Print / PDF</button>
              <button data-testid="schedule-add-open" onClick={() => setShowAdd((v) => !v)} className="text-[11px] font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-2 py-1 rounded flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> New shift</button>
            </div>
          </div>

          {showAdd && (
            <div className="bg-white border border-[#D4D4D4] rounded-lg p-3 space-y-2 print:hidden" data-testid="schedule-add-form">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input data-testid="sched-name" placeholder="Crew member *" value={form.crew_member_name} onChange={(e) => setForm({ ...form, crew_member_name: e.target.value })} className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                <select data-testid="sched-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select data-testid="sched-tour" value={form.tour} onChange={(e) => setForm({ ...form, tour: e.target.value })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm">
                  <option value="day">Day tour</option>
                  <option value="night">Night tour</option>
                </select>
                <select data-testid="sched-pattern" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm">
                  {PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <div className="col-span-2 grid grid-cols-2 gap-2">
                  <input data-testid="sched-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                  {form.pattern === "one_off" ? (
                    <input data-testid="sched-end" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                  ) : (
                    <input data-testid="sched-cycles" type="number" min="1" max="24" placeholder="Cycles" value={form.repeat_cycles} onChange={(e) => setForm({ ...form, repeat_cycles: e.target.value })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                  )}
                </div>
                {form.pattern === "custom" && (
                  <>
                    <input placeholder="Days on" type="number" value={form.rotation_days_on} onChange={(e) => setForm({ ...form, rotation_days_on: parseInt(e.target.value, 10) || 0 })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                    <input placeholder="Days off" type="number" value={form.rotation_days_off} onChange={(e) => setForm({ ...form, rotation_days_off: parseInt(e.target.value, 10) || 0 })} className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                  </>
                )}
                <input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="col-span-full px-2 py-1.5 border border-[#CCC] rounded text-sm" />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAdd(false)} className="text-xs text-[#595959] px-3 py-1.5">Cancel</button>
                <button data-testid="schedule-save" disabled={saving || !form.crew_member_name?.trim()} onClick={create} className="text-xs font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-4 py-1.5 rounded disabled:opacity-50">
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Create shifts"}
                </button>
              </div>
              {error && <div className="text-[11px] text-[#721C24]">{error}</div>}
            </div>
          )}

          {/* Printable schedule sheet */}
          <div className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden print:border-0" id="schedule-print-area">
            <div className="px-3 py-2 border-b border-[#E5E7EB] flex items-center justify-between print:border-0">
              <div className="text-[13px] font-bold text-[#0D6535]">{rigLabel(rigId)} · 14-day crew schedule</div>
              <div className="text-[10px] text-[#595959]">{new Date(days[0]).toLocaleDateString()} – {new Date(days[days.length-1]).toLocaleDateString()}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-2 py-1.5 bg-[#F9FAFB] border-b border-[#E5E7EB] sticky left-0">Crew / Role</th>
                    {days.map((d) => (
                      <th key={isoDate(d)} className={`text-center px-1 py-1 bg-[#F9FAFB] border-b border-[#E5E7EB] font-normal ${[0,6].includes(d.getDay()) ? "text-[#C00000]" : "text-[#262626]"}`} style={{ minWidth: 34 }}>
                        <div className="text-[9px] uppercase">{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                        <div className="text-[10px] font-bold">{d.getDate()}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={days.length + 1} className="p-6 text-center text-[12px] text-[#595959]"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading…</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={days.length + 1} className="p-8 text-center text-[12px] text-[#595959]">No shifts scheduled for {rigLabel(rigId)} in this window.</td></tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.name} data-testid={`sched-row-${r.name}`} className="border-b border-[#F0F0F0]">
                      <td className="px-2 py-1.5 text-[11px] font-bold sticky left-0 bg-white">
                        <div>{r.name}</div>
                        <div className="text-[9px] font-semibold uppercase" style={{ color: ROLE_COLOR[r.role] || "#0D6535" }}>{r.role}</div>
                      </td>
                      {days.map((d) => {
                        const covering = r.shifts.filter((s) => shiftCoversDay(s, d));
                        return (
                          <td key={isoDate(d)} className="p-0 border-l border-[#F0F0F0] align-middle">
                            {covering.length === 0 ? (
                              <div className="h-6" />
                            ) : (
                              <div className="flex flex-col gap-[1px] p-[1px]">
                                {covering.map((s) => (
                                  <button
                                    key={s.shift_id}
                                    onClick={() => remove(s)}
                                    title={`${s.crew_member_name} · ${s.role} · ${s.tour} · ${s.start_date}${s.end_date && s.end_date !== s.start_date ? " → " + s.end_date : ""}${s.note ? " · " + s.note : ""}\n(Click to delete)`}
                                    className="h-5 rounded text-[9px] font-bold text-white flex items-center justify-center print:text-black print:bg-white print:border"
                                    style={{ background: ROLE_COLOR[s.role] || "#0D6535", opacity: s.tour === "night" ? 0.72 : 1 }}
                                    data-testid={`sched-cell-${s.shift_id}`}
                                  >
                                    {s.tour === "night" ? "N" : "D"}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 bg-[#F9FAFB] flex flex-wrap gap-3 text-[10px] print:bg-white">
              {Object.entries(ROLE_COLOR).map(([role, c]) => (
                <span key={role} className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: c }} /> {role}</span>
              ))}
              <span className="ml-auto italic text-[#595959]">D = day tour · N = night tour · click a cell to delete</span>
            </div>
          </div>
        </div>
      </div>

      {/* Print-specific styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .print\\:border-0 { border: 0 !important; }
          .print\\:text-black { color: #000 !important; }
          .print\\:bg-white { background: #fff !important; }
          .print\\:border { border: 1px solid #333 !important; }
          #schedule-print-area { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
};

export default CrewSchedulePage;
