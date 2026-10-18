import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher } from "../lib/roles";
import { Plus, Trash2 } from "lucide-react";

const CATEGORIES = [
  ["lifting", "Lifting"],
  ["iron", "Iron / Hoses"],
  ["pce", "PCE (Pressure Control)"],
  ["ct_unit", "CT Unit"],
  ["snubbing", "Snubbing"],
  ["h2s", "H2S"],
  ["first_aid", "First Aid"],
  ["other", "Other"],
];

export default function CertificationsPage() {
  const { user } = useAuth();
  const canEditOthers = isSupervisorOrHigher(user);
  const [members, setMembers] = useState([]);
  const [certs, setCerts] = useState([]);
  const [viewUserId, setViewUserId] = useState(user?.user_id || null);
  const [form, setForm] = useState({ category: "lifting", issuing_body: "", cert_number: "", issue_date: "", expiry_date: "", notes: "" });

  const refresh = async () => {
    const uid = viewUserId || user?.user_id;
    try {
      const [m, c] = await Promise.all([
        axios.get(`${API}/rbac/members`, { withCredentials: true }).then((r) => r.data?.members || []).catch(() => []),
        axios.get(`${API}/certifications`, { params: uid ? { user_id: uid } : {}, withCredentials: true }).then((r) => r.data?.certifications || []),
      ]);
      setMembers(m); setCerts(c);
    } catch {}
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [viewUserId]);
  useEffect(() => { setViewUserId(user?.user_id); }, [user?.user_id]);

  const addCert = async () => {
    if (!form.issue_date || !form.expiry_date) return toast.error("Issue + expiry date required (YYYY-MM-DD)");
    try {
      await axios.post(`${API}/certifications`, { ...form, user_id: viewUserId || user.user_id }, { withCredentials: true });
      toast.success("Cert added"); setForm({ category: "lifting", issuing_body: "", cert_number: "", issue_date: "", expiry_date: "", notes: "" });
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };

  const deleteCert = async (id) => {
    if (!window.confirm("Delete cert?")) return;
    try { await axios.delete(`${API}/certifications/${id}`, { withCredentials: true }); refresh(); toast.success("Deleted"); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const canAddForTarget = useMemo(() => viewUserId === user?.user_id || canEditOthers, [viewUserId, user?.user_id, canEditOthers]);
  const summary = useMemo(() => {
    const expired = certs.filter((c) => c.status === "expired").length;
    const amber = certs.filter((c) => c.status === "amber").length;
    const green = certs.filter((c) => c.status === "green").length;
    return { expired, amber, green };
  }, [certs]);

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="Crew Certifications" subtitle={`${summary.green} green · ${summary.amber} ≤30d · ${summary.expired} expired`} />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        {canEditOthers && members.length > 0 && (
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-2">
            <label className="text-xs font-bold text-[#595959] mr-2">View crew member:</label>
            <select data-testid="cert-user-select" value={viewUserId || ""} onChange={(e) => setViewUserId(e.target.value)} className="border rounded px-2 py-1 text-xs">
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name || m.email} · {m.role_plan}</option>)}
            </select>
          </div>
        )}

        {canAddForTarget && (
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
            <h3 className="font-bold text-sm mb-2 flex items-center gap-1"><Plus className="w-4 h-4" /> Add Certification</h3>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
              <select data-testid="cert-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="border rounded px-2 py-1">
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input placeholder="Issuing body" value={form.issuing_body} onChange={(e) => setForm({ ...form, issuing_body: e.target.value })} className="border rounded px-2 py-1" />
              <input placeholder="Cert #" value={form.cert_number} onChange={(e) => setForm({ ...form, cert_number: e.target.value })} className="border rounded px-2 py-1" />
              <input data-testid="cert-issue" placeholder="Issue YYYY-MM-DD" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="border rounded px-2 py-1" />
              <input data-testid="cert-expiry" placeholder="Expiry YYYY-MM-DD" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className="border rounded px-2 py-1" />
              <button data-testid="cert-add" onClick={addCert} className="bg-[#FF6B1A] text-white px-2 py-1 font-bold rounded">Add</button>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {certs.length === 0 && <p className="text-sm text-[#595959] text-center py-8">No certifications on file.</p>}
          {certs.map((c) => {
            const bg = c.status === "expired" ? "bg-[#F8D7DA] border-[#F5C6CB]" : c.status === "amber" ? "bg-[#FFF3CD] border-[#FFE69C]" : "bg-white border-[#D4D4D4]";
            return (
              <div key={c.cert_id} data-testid={`cert-row-${c.cert_id}`} className={`${bg} border rounded-lg p-2 flex items-center justify-between gap-2`}>
                <div className="flex-1">
                  <p className="text-sm font-bold text-[#262626]">
                    {CATEGORIES.find((x) => x[0] === c.category)?.[1] || c.category}
                    <span className="ml-2 text-[10px] font-bold uppercase bg-black/5 px-1 rounded">{c.status}</span>
                  </p>
                  <p className="text-[11px] text-[#595959]">
                    {c.issuing_body || "—"} · {c.cert_number || "—"} · exp {c.expiry_date?.slice(0, 10)}
                    {c.days_to_expiry != null && (c.days_to_expiry < 0 ? ` · ${-c.days_to_expiry} d overdue` : ` · ${c.days_to_expiry} d left`)}
                  </p>
                </div>
                {(c.user_id === user?.user_id || canEditOthers) && (
                  <button data-testid={`cert-delete-${c.cert_id}`} onClick={() => deleteCert(c.cert_id)} className="text-[#C00000] p-1 hover:bg-[#F8D7DA] rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
