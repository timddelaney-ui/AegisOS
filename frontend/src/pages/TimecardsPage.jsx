import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher, isManagement, planRole } from "../lib/roles";
import { Plus, Trash2, Send, CheckCircle2, XCircle, Download } from "lucide-react";

const STATUS_COLOR = {
  draft: "bg-[#F3F4F6] text-[#595959]",
  submitted: "bg-[#FEF3C7] text-[#92400E]",
  approved_supervisor: "bg-[#DBEAFE] text-[#1E40AF]",
  approved_payroll: "bg-[#DCFCE7] text-[#065F46]",
  rejected: "bg-[#F8D7DA] text-[#991B1B]",
};

const todayISO = () => new Date().toISOString().slice(0, 10);

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
  const [form, setForm] = useState({ work_date: todayISO(), hours: 12, description: "", job_number: "", pay_code: "regular", rig_id: "" });

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

  const addLine = async () => {
    if (!form.description.trim() || !form.job_number.trim()) return toast.error("Description + job number required");
    try {
      await axios.post(`${API}/timecards/lines`, {
        work_date: form.work_date,
        hours: Number(form.hours),
        description: form.description,
        job_number: form.job_number,
        pay_code: form.pay_code,
        rig_id: form.rig_id || undefined,
      }, { withCredentials: true });
      setForm({ ...form, description: "" });
      toast.success("Line added");
      refresh();
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
      <Phase1PageHeader title="Timecards & Payroll" subtitle={`Period ${startDate} → ${endDate} · ${lines.length} line${lines.length !== 1 ? "s" : ""} · $${totals.total.toFixed(2)}`} />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
          <h3 className="text-sm font-bold mb-2 flex items-center gap-1"><Plus className="w-4 h-4" />Add timecard line</h3>
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 text-xs">
            <input data-testid="tc-date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} placeholder="YYYY-MM-DD" className="border rounded px-2 py-1" />
            <input data-testid="tc-hours" type="number" step="0.25" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} className="border rounded px-2 py-1" />
            <input data-testid="tc-job" placeholder="Job #" value={form.job_number} onChange={(e) => setForm({ ...form, job_number: e.target.value })} className="border rounded px-2 py-1" />
            <select data-testid="tc-paycode" value={form.pay_code} onChange={(e) => setForm({ ...form, pay_code: e.target.value })} className="border rounded px-2 py-1">
              {payCodes.map((p) => <option key={p.code} value={p.code}>{p.label}{p.is_per_diem ? " (days)" : ""}</option>)}
            </select>
            <input data-testid="tc-desc" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="border rounded px-2 py-1 sm:col-span-2" />
            <button data-testid="tc-add" onClick={addLine} className="bg-[#107C41] text-white font-bold rounded px-2 py-1">Add</button>
          </div>
          <p className="text-[10px] text-[#595959] mt-1">Enter days (not hours) when using the per-diem pay code.</p>
        </div>

        <div className="bg-white border border-[#D4D4D4] rounded-lg p-2 flex gap-2 items-center flex-wrap text-xs">
          <label>From <input value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border rounded px-1 py-0.5 ml-1" /></label>
          <label>To <input value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border rounded px-1 py-0.5 ml-1" /></label>
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
          <div className="ml-auto flex gap-1">
            <button data-testid="tc-submit" onClick={() => act("/timecards/submit", "Submitted")} className="bg-[#0056B3] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><Send className="w-3 h-3" />Submit</button>
            {canApproveSup && <button data-testid="tc-approve-sup" onClick={() => act("/timecards/approve-supervisor", "Supervisor approved")} className="bg-[#107C41] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Sup. Approve</button>}
            {canApprovePayroll && <button data-testid="tc-approve-payroll" onClick={() => act("/timecards/approve-payroll", "Payroll approved")} className="bg-[#065F46] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Payroll Approve</button>}
            {canApproveSup && <button data-testid="tc-reject" onClick={() => act("/timecards/reject", "Rejected")} className="bg-[#C00000] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><XCircle className="w-3 h-3" />Reject</button>}
            {canApproveSup && <button data-testid="tc-export" onClick={() => exportCsv()} className="bg-[#262626] text-white px-2 py-1 font-bold rounded flex items-center gap-1"><Download className="w-3 h-3" />CSV</button>}
          </div>
        </div>

        {/* Totals by pay code */}
        {Object.keys(totals.byCode).length > 0 && (
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {Object.entries(totals.byCode).map(([code, v]) => (
              <div key={code} className="border rounded p-2">
                <p className="text-[10px] font-bold uppercase text-[#595959]">{v.label}</p>
                <p className="text-sm font-bold tabular-nums">{v.hours.toFixed(2)} · ${v.total.toFixed(2)}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1">
          {lines.length === 0 && <p className="text-sm text-[#595959] text-center py-8">No timecard lines for this period.</p>}
          {lines.map((ln) => (
            <div key={ln.line_id} data-testid={`tc-row-${ln.line_id}`} className="bg-white border border-[#D4D4D4] rounded-lg p-2 flex items-center gap-2 text-xs">
              <input type="checkbox" data-testid={`tc-sel-${ln.line_id}`} checked={!!selected[ln.line_id]} onChange={() => toggleSel(ln.line_id)} />
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_COLOR[ln.status]}`}>{ln.status}</span>
              <span className="font-bold tabular-nums w-20">{ln.work_date?.slice(0, 10)}</span>
              <span className="w-28 truncate" title={ln.user_name}>{ln.user_name || ln.user_email}</span>
              <span className="w-20 truncate" title={ln.job_number}>#{ln.job_number}</span>
              <span className="w-24 truncate">{ln.pay_code_label}</span>
              <span className="tabular-nums w-14 text-right">{Number(ln.hours).toFixed(2)}</span>
              <span className="tabular-nums w-20 text-right font-bold">${Number(ln.line_total).toFixed(2)}</span>
              <span className="flex-1 min-w-0 truncate text-[#595959]">{ln.description}</span>
              {(ln.user_id === user?.user_id || canApproveSup) && !["approved_payroll"].includes(ln.status) && (
                <button data-testid={`tc-del-${ln.line_id}`} onClick={() => del(ln.line_id)} className="text-[#C00000] p-1"><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
