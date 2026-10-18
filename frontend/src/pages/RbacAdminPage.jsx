import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher, isManagement, planRole, ROLE_LABEL } from "../lib/roles";
import { ShieldCheck, Users, Globe } from "lucide-react";

export default function RbacAdminPage() {
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);
  const canSetMgmt = isManagement(user);
  const [members, setMembers] = useState([]);
  const [domains, setDomains] = useState([]);
  const [domainInput, setDomainInput] = useState("");

  const refresh = async () => {
    try {
      const [m, d] = await Promise.all([
        axios.get(`${API}/rbac/members`, { withCredentials: true }).then((r) => r.data?.members || []),
        axios.get(`${API}/rbac/workspace/domains`, { withCredentials: true }).then((r) => r.data?.allowed_domains || []).catch(() => []),
      ]);
      setMembers(m); setDomains(d); setDomainInput(d.join(", "));
    } catch {}
  };
  useEffect(() => { refresh(); }, []);

  const setRole = async (user_id, role) => {
    try {
      await axios.post(`${API}/rbac/promote`, { user_id, role }, { withCredentials: true });
      toast.success(`Role → ${role}`); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const setBaseRate = async (user_id) => {
    const rate = window.prompt("Base hourly rate (USD):", "40");
    if (!rate) return;
    try {
      await axios.post(`${API}/paycodes/base-rate`, { user_id, base_rate_hourly: Number(rate) }, { withCredentials: true });
      toast.success(`Base rate set to $${rate}/hr`); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const saveDomains = async () => {
    try {
      const arr = domainInput.split(",").map((s) => s.trim()).filter(Boolean);
      await axios.patch(`${API}/rbac/workspace/domains`, { domains: arr }, { withCredentials: true });
      toast.success("Allowlist saved"); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="Crew Admin · Roles & Workspace" subtitle="Promote crew to Supervisor or Management, set base pay rate, restrict domain." />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
          <h3 className="text-sm font-bold flex items-center gap-1 mb-2"><Globe className="w-4 h-4" />Allowed Email Domains</h3>
          <div className="flex gap-2 items-center">
            <input data-testid="domains-input" placeholder="acme.com, acme-energy.com" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} className="border rounded px-2 py-1 text-xs flex-1" disabled={!canEdit} />
            {canEdit && <button data-testid="domains-save" onClick={saveDomains} className="bg-[#107C41] text-white px-2 py-1 text-xs font-bold rounded">Save</button>}
          </div>
          <p className="text-[10px] text-[#595959] mt-1">Leave empty to allow any Google-signed-in email. Only enforced on team join.</p>
        </div>

        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
          <h3 className="text-sm font-bold flex items-center gap-1 mb-2"><Users className="w-4 h-4" />Members</h3>
          <div className="space-y-1.5">
            {members.map((m) => (
              <div key={m.user_id} data-testid={`member-${m.user_id}`} className="flex items-center gap-2 bg-[#F8FAFC] rounded p-2 text-xs">
                <span className="w-8 h-8 rounded-full bg-[#107C41] text-white font-bold flex items-center justify-center">{(m.name || m.email).charAt(0).toUpperCase()}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">{m.name || m.email}</p>
                  <p className="text-[#595959] truncate">{m.email}</p>
                </div>
                <span className="text-[10px] font-bold uppercase bg-black/5 px-1.5 py-0.5 rounded">{ROLE_LABEL[m.role_plan] || m.role_plan}</span>
                {canEdit && (
                  <div className="flex gap-1">
                    <button data-testid={`promote-crew-${m.user_id}`} onClick={() => setRole(m.user_id, "crew")} className="bg-[#F3F4F6] px-2 py-1 rounded font-bold text-[10px]">Crew</button>
                    <button data-testid={`promote-sup-${m.user_id}`} onClick={() => setRole(m.user_id, "supervisor")} className="bg-[#DBEAFE] px-2 py-1 rounded font-bold text-[10px]">Supervisor</button>
                    {canSetMgmt && <button data-testid={`promote-mgmt-${m.user_id}`} onClick={() => setRole(m.user_id, "management")} className="bg-[#DCFCE7] px-2 py-1 rounded font-bold text-[10px]">Management</button>}
                    <button data-testid={`set-rate-${m.user_id}`} onClick={() => setBaseRate(m.user_id)} className="bg-[#FFF3CD] px-2 py-1 rounded font-bold text-[10px]">$</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
