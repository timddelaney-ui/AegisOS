import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher, isManagement, planRole } from "../lib/roles";
import { Plus, Trash2, Send, CheckCircle2, XCircle, Download, Layers } from "lucide-react";

const STATUS_COLOR = {
  draft: "bg-[#F3F4F6] text-[#595959]",
  submitted: "bg-[#FEF3C7] text-[#92400E]",
  approved_supervisor: "bg-[#DBEAFE] text-[#1E40AF]",
  approved_payroll: "bg-[#DCFCE7] text-[#065F46]",
  rejected: "bg-[#F8D7DA] text-[#991B1B]",
};

const todayISO = () => new Date().toISOString().slice(0, 10);
// Default activity composition for a typical shift
const DEFAULT_ACTIVITIES = [
  { pay_code: "field_rate", hours: 0, description: "Field hours — on location" },
  { pay_code: "shop_rate", hours: 0, description: "Shop prep" },
  { pay_code: "travel_rate", hours: 0, description: "Travel to/from location" },
  { pay_code: "moving_equipment", hours: 0, description: "Moving equipment" },
];

export default function TimecardsPage() {
  const { user } = useAuth();
  const role = planRole(user);
  const canApproveSup = isSupervisorOrHigher(user);
  const canApprovePayroll = isManagement(user);
  const [lines, setLines] = useState([]);
  const [payCodes, setPayCodes] = useState([]);
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState({});
  const [viewUserId, setViewUserId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(todayISO());

  // Shift composer state
  const [shiftDate, setShiftDate] = useState(todayISO());
  const [shiftJob, setShiftJob] = useState("");
  const [shiftRig, setShiftRig] = useState("");
  const [activities, setActivities] = useState(DEFAULT_ACTIVITIES.map((a) => ({ ...a })));
  const [showQuick, setShowQuick] = useState(false);
  const [quick, setQuick] = useState({ work_date: todayISO(), hours: 12, description: "", job_number: "", pay_code: "regular", rig_id: "" });

  const refresh = async () => {
    try {
      const params = { start: startDate, end: endDate };
      if (statusFilter) params.status = statusFilter;
      if (viewUserId) params.user_id = viewUserId;
      const [l, p, m] = await Promise.all([
        axios.get(`${API}/timecards/lines`, { params, withCredentials: true }).then((r) => r.data?.lines || []),
        axios.get(`${API}/paycodes`, { withCredentials: true }).then((r) => r.data?.paycodes || []),
        axios.get(`${API}/rbac/members`, { withCredentials: true }).then((r) => r.data?.members || []).catch(() => []),
      ]);
      setLines(l); setPayCodes(p); setMembers(m);
    } catch (e) { /* ignore */ }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [statusFilter, viewUserId, startDate, endDate]);

  // Preview total $ for the shift composer
  const payCodeMap = useMemo(() => Object.fromEntries(payCodes.map((p) => [p.code, p])), [payCodes]);
  const base = Number(user?.base_rate_hourly) || 0;
  const previewRate = (code) => {
    const pc = payCodeMap[code];
    if (!pc) return 0;
    if (pc.is_per_diem) return Number(pc.flat_rate_per_day) || 0;
    if (pc.flat_rate_per_hour != null) return Number(pc.flat_rate_per_hour);
    return base * (Number(pc.multiplier) || 1);
  };
  const shiftTotal = activities.reduce((acc, a) => acc + previewRate(a.pay_code) * (Number(a.hours) || 0), 0);
  const shiftHours = activities.reduce((acc, a) => acc + (Number(a.hours) || 0), 0);

  const updateActivity = (i, k, v) => setActivities((prev) => prev.map((a, idx) => idx === i ? { ...a, [k]: v } : a));
  const addActivity = () => setActivities((prev) => [...prev, { pay_code: payCodes[0]?.code || "regular", hours: 0, description: "" }]);
  const removeActivity = (i) => setActivities((prev) => prev.filter((_, idx) => idx !== i));
  const resetShift = () => { setActivities(DEFAULT_ACTIVITIES.map((a) => ({ ...a }))); setShiftJob(""); setShiftRig(""); };

  const submitShift = async () => {
    if (!shiftJob.trim()) return toast.error("Job number required for the shift");
    const active = activities.filter((a) => Number(a.hours) > 0);
    if (active.length === 0) return toast.error("Add hours to at least one activity");
    try {
      const r = await axios.post(`${API}/timecards/shift`, {
        work_date: shiftDate,
        job_number: shiftJob,
        rig_id: shiftRig || undefined,
        activities: active.map((a) => ({
          hours: Number(a.hours),
          pay_code: a.pay_code,
          description: a.description || `${payCodeMap[a.pay_code]?.label || a.pay_code}`,
        })),
      }, { withCredentials: true });
      toast.success(`Shift saved: ${r.data.count} line${r.data.count !== 1 ? "s" : ""} · $${r.data.total.toFixed(2)}`);
      resetShift(); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const addQuick = async () => {
    if (!quick.description.trim() || !quick.job_number.trim()) return toast.error("Description + job number required");
    try {
      await axios.post(`${API}/timecards/lines`, {
        work_date: quick.work_date, hours: Number(quick.hours),
        description: quick.description, job_number: quick.job_number,
        pay_code: quick.pay_code, rig_id: quick.rig_id || undefined,
      }, { withCredentials: true });
      setQuick({ ...quick, description: "" });
      toast.success("Line added"); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const toggleSel = (id) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  const selIds = () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k);

  const act = async (path, successMsg) => {
    const ids = selIds();
    if (ids.length === 0) return toast.error("Select at least one line");
    try {
      const r = await axios.post(`${API}${path}`, { line_ids: ids }, { withCredentials: true });
      toast.success(`${successMsg}: ${r.data.submitted ?? r.data.approved ?? r.data.rejected ?? ids.length}`);
      setSelected({}); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const del = async (id) => {
    try { await axios.delete(`${API}/timecards/lines/${id}`, { withCredentials: true }); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const exportCsv = async (status = "approved_payroll") => {
    try {
      const r = await axios.get(`${API}/timecards/export`, { params: { start: startDate, end: endDate, status }, withCredentials: true });
      const blob = new Blob([r.data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `timecards_${startDate}_${endDate}_${status}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
      toast.success(`Exported ${r.data.row_count} rows`);
    } catch (e) { toast.error(e.response?.data?.detail || "Export failed"); }
  };

  const totals = useMemo(() => {
    const byCode = {};
    let total = 0;
    for (const ln of lines) {
      const code = ln.pay_code;
      if (!byCode[code]) byCode[code] = { label: ln.pay_code_label || code, hours: 0, total: 0 };
      byCode[code].hours += Number(ln.hours || 0);
      byCode[code].total += Number(ln.line_total || 0);
      total += Number(ln.line_total || 0);
    }
    return { byCode, total };
  }, [lines]);

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="Timecards & Payroll" subtitle={`${startDate} → ${endDate} · ${lines.length} line${lines.length !== 1 ? "s" : ""} · $${totals.total.toFixed(2)}`} />
      <div className="max-w-6xl mx-auto p-2 space-y-2">

        {/* Shift Composer — one date, many activities at different rates */}
        <div className="bg-white border border-[#D4D4D4] rounded-lg p-2.5">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-4 h-4 text-[#FF6B1A]" />
            <h3 className="font-bold text-sm">Add Shift — multiple activities at different rates</h3>
            <span className="ml-auto text-[11px] text-[#595959]">Shop/Travel/Field/Moving-Equipment all pay different rates. Enter hours per activity.</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs mb-2">
            <label className="flex flex-col"><span className="text-[10px] font-bold uppercase text-[#595959]">Shift date</span>
              <input data-testid="shift-date" type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className="border rounded px-1.5 py-0.5" />
            </label>
            <label className="flex flex-col"><span className="text-[10px] font-bold uppercase text-[#595959]">Job #</span>
              <input data-testid="shift-job" value={shiftJob} onChange={(e) => setShiftJob(e.target.value)} placeholder="e.g. 25-1234" className="border rounded px-1.5 py-0.5" />
            </label>
            <label className="flex flex-col"><span className="text-[10px] font-bold uppercase text-[#595959]">Rig (optional)</span>
              <input data-testid="shift-rig" value={shiftRig} onChange={(e) => setShiftRig(e.target.value)} placeholder="e.g. 7" className="border rounded px-1.5 py-0.5" />
            </label>
            <div className="flex flex-col"><span className="text-[10px] font-bold uppercase text-[#595959]">Shift Σ hours</span>
              <span className="font-bold tabular-nums text-sm" data-testid="shift-hours">{shiftHours.toFixed(2)}</span>
            </div>
            <div className="flex flex-col"><span className="text-[10px] font-bold uppercase text-[#595959]">Shift Σ USD (preview)</span>
              <span className="font-bold tabular-nums text-sm text-[#065F46]" data-testid="shift-total">${shiftTotal.toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-1 text-[9px] font-bold uppercase text-[#595959] px-1">
              <span className="col-span-3">Activity (pay code)</span>
              <span className="col-span-1 text-right">Hours</span>
              <span className="col-span-1 text-right">Rate</span>
              <span className="col-span-1 text-right">Line $</span>
              <span className="col-span-5">Description</span>
              <span className="col-span-1"></span>
            </div>
            {activities.map((a, i) => {
              const rate = previewRate(a.pay_code);
              const pc = payCodeMap[a.pay_code];
              const lineTotal = rate * (Number(a.hours) || 0);
              return (
                <div key={i} data-testid={`shift-row-${i}`} className="grid grid-cols-12 gap-1 items-center text-xs">
                  <select data-testid={`shift-paycode-${i}`} value={a.pay_code} onChange={(e) => updateActivity(i, "pay_code", e.target.value)} className="col-span-3 border rounded px-1 py-0.5">
                    {payCodes.map((p) => <option key={p.code} value={p.code}>{p.label}{p.is_per_diem ? " (days)" : ""}</option>)}
                  </select>
                  <input data-testid={`shift-hours-${i}`} type="number" step="0.25" min="0" value={a.hours}
                    onChange={(e) => updateActivity(i, "hours", e.target.value)}
                    className="col-span-1 border rounded px-1 py-0.5 text-right tabular-nums" />
                  <span className="col-span-1 text-right tabular-nums text-[#595959]">
                    ${rate.toFixed(2)}{pc?.is_per_diem ? "/d" : "/hr"}
                  </span>
                  <span className="col-span-1 text-right tabular-nums font-bold">${lineTotal.toFixed(2)}</span>
                  <input value={a.description} placeholder="(optional)" onChange={(e) => updateActivity(i, "description", e.target.value)} className="col-span-5 border rounded px-1 py-0.5" />
                  <button data-testid={`shift-remove-${i}`} onClick={() => removeActivity(i)} className="col-span-1 text-[#C00000] p-0.5 justify-self-end" aria-label="remove"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mt-2">
            <button data-testid="shift-add-row" onClick={addActivity} className="text-[11px] text-[#FF6B1A] font-bold flex items-center gap-1 border border-[#FF6B1A] rounded px-2 py-1"><Plus className="w-3 h-3" />Add activity</button>
            <button data-testid="shift-reset" onClick={resetShift} className="text-[11px] text-[#595959] border rounded px-2 py-1">Reset</button>
            <button data-testid="shift-submit" onClick={submitShift} className="ml-auto bg-[#FF6B1A] text-white px-3 py-1 text-xs font-bold rounded">Save shift ({activities.filter((a) => Number(a.hours) > 0).length} line{activities.filter((a) => Number(a.hours) > 0).length !== 1 ? "s" : ""})</button>
          </div>
        </div>

        {/* Collapsible quick add single line */}
        <div className="bg-white border border-[#D4D4D4] rounded-lg">
          <button data-testid="toggle-quick" onClick={() => setShowQuick(!showQuick)} className="w-full px-3 py-1.5 text-left text-xs font-bold text-[#595959] flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" />
            Add single line (quick entry) {showQuick ? "▾" : "▸"}
          </button>
          {showQuick && (
            <div className="px-3 pb-2 border-t border-[#E5E5E5] pt-2">
              <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 text-xs">
                <input data-testid="tc-date" value={quick.work_date} onChange={(e) => setQuick({ ...quick, work_date: e.target.value })} placeholder="YYYY-MM-DD" className="border rounded px-2 py-1" />
                <input data-testid="tc-hours" type="number" step="0.25" value={quick.hours} onChange={(e) => setQuick({ ...quick, hours: e.target.value })} className="border rounded px-2 py-1" />
                <input data-testid="tc-job" placeholder="Job #" value={quick.job_number} onChange={(e) => setQuick({ ...quick, job_number: e.target.value })} className="border rounded px-2 py-1" />
                <select data-testid="tc-paycode" value={quick.pay_code} onChange={(e) => setQuick({ ...quick, pay_code: e.target.value })} className="border rounded px-2 py-1">
                  {payCodes.map((p) => <option key={p.code} value={p.code}>{p.label}{p.is_per_diem ? " (days)" : ""}</option>)}
                </select>
                <input data-testid="tc-desc" placeholder="Description" value={quick.description} onChange={(e) => setQuick({ ...quick, description: e.target.value })} className="border rounded px-2 py-1 sm:col-span-2" />
                <button data-testid="tc-add" onClick={addQuick} className="bg-[#FF6B1A] text-white font-bold rounded px-2 py-1">Add</button>
              </div>
            </div>
          )}
        </div>

        {/* Period filter + batch actions */}
        <div className="bg-white border border-[#D4D4D4] rounded-lg p-1.5 flex gap-2 items-center flex-wrap text-xs">
          <label>From <input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date" className="border rounded px-1 py-0.5 ml-1" /></label>
          <label>To <input value={endDate} onChange={(e) => setEndDate(e.target.value)} type="date" className="border rounded px-1 py-0.5 ml-1" /></label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded px-1 py-0.5">
            <option value="">All statuses</option>
            {Object.keys(STATUS_COLOR).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {canApproveSup && (
            <select data-testid="tc-view-user" value={viewUserId} onChange={(e) => setViewUserId(e.target.value)} className="border rounded px-1 py-0.5">
              <option value="">All crew</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>)}
            </select>
          )}
          <div className="ml-auto flex gap-1 flex-wrap">
            <button data-testid="tc-submit" onClick={() => act("/timecards/submit", "Submitted")} className="bg-[#0056B3] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><Send className="w-3 h-3" />Submit</button>
            {canApproveSup && <button data-testid="tc-approve-sup" onClick={() => act("/timecards/approve-supervisor", "Supervisor approved")} className="bg-[#FF6B1A] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Sup. Approve</button>}
            {canApprovePayroll && <button data-testid="tc-approve-payroll" onClick={() => act("/timecards/approve-payroll", "Payroll approved")} className="bg-[#065F46] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Payroll Approve</button>}
            {canApproveSup && <button data-testid="tc-reject" onClick={() => act("/timecards/reject", "Rejected")} className="bg-[#C00000] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><XCircle className="w-3 h-3" />Reject</button>}
            {canApproveSup && <button data-testid="tc-export" onClick={() => exportCsv()} className="bg-[#262626] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><Download className="w-3 h-3" />CSV</button>}
          </div>
        </div>

        {Object.keys(totals.byCode).length > 0 && (
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-2 grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-[11px]">
            {Object.entries(totals.byCode).map(([code, v]) => (
              <div key={code} className="border rounded p-1.5">
                <p className="text-[9px] font-bold uppercase text-[#595959] truncate">{v.label}</p>
                <p className="text-xs font-bold tabular-nums">{v.hours.toFixed(2)}h · ${v.total.toFixed(2)}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1">
          {lines.length === 0 && <p className="text-sm text-[#595959] text-center py-8">No timecard lines for this period.</p>}
          {lines.map((ln) => (
            <div key={ln.line_id} data-testid={`tc-row-${ln.line_id}`} className="bg-white border border-[#D4D4D4] rounded-lg p-1.5 flex items-center gap-1.5 text-xs flex-wrap">
              <input type="checkbox" data-testid={`tc-sel-${ln.line_id}`} checked={!!selected[ln.line_id]} onChange={() => toggleSel(ln.line_id)} />
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase ${STATUS_COLOR[ln.status]}`}>{ln.status}</span>
              <span className="font-bold tabular-nums w-20">{ln.work_date?.slice(0, 10)}</span>
              <span className="w-24 truncate" title={ln.user_name}>{ln.user_name || ln.user_email}</span>
              <span className="w-16 truncate" title={ln.job_number}>#{ln.job_number}</span>
              <span className="w-28 truncate">{ln.pay_code_label}</span>
              <span className="tabular-nums w-10 text-right">{Number(ln.hours).toFixed(2)}</span>
              <span className="tabular-nums w-16 text-right font-bold">${Number(ln.line_total).toFixed(2)}</span>
              <span className="flex-1 min-w-0 truncate text-[#595959]">{ln.description}</span>
              {(ln.user_id === user?.user_id || canApproveSup) && !["approved_payroll"].includes(ln.status) && (
                <button data-testid={`tc-del-${ln.line_id}`} onClick={() => del(ln.line_id)} className="text-[#C00000] p-0.5"><Trash2 className="w-3 h-3" /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
