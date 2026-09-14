import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "../context/AuthContext";
import { ArrowLeft, Loader2, Plus, Copy, Check, Trash2, Gift, ShieldAlert, Link as LinkIcon } from "lucide-react";

const AdminInvites = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [invites, setInvites] = useState([]);
  const [isAdmin, setIsAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [note, setNote] = useState("");
  const [grantDays, setGrantDays] = useState(30);
  const [maxUses, setMaxUses] = useState(1);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(null);

  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";

  const load = async () => {
    setLoading(true);
    try {
      const w = (await axios.get(`${API}/admin/whoami`, { withCredentials: true })).data;
      setIsAdmin(w.is_admin);
      if (w.is_admin) {
        const { data } = await axios.get(`${API}/admin/invites`, { withCredentials: true });
        setInvites(data);
      }
    } catch (e) { setIsAdmin(false); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    setCreating(true);
    try {
      await axios.post(`${API}/admin/invites`, { note, grant_days: Number(grantDays) || 30, max_uses: Number(maxUses) || 1 }, { withCredentials: true });
      setShowNew(false); setNote(""); setGrantDays(30); setMaxUses(1);
      await load();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to create");
    }
    setCreating(false);
  };

  const revoke = async (code) => {
    if (!window.confirm(`Revoke ${code}? Users who haven't redeemed yet will be blocked.`)) return;
    await axios.delete(`${API}/admin/invites/${code}`, { withCredentials: true });
    load();
  };

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col">
      <header className="bg-[#107C41] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0">
        <button onClick={() => navigate("/app")} className="flex items-center gap-1.5 text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-sm font-semibold ml-4">Invite Codes · Admin</h1>
      </header>
      <div className="flex-1 p-4 overflow-auto">
        <div className="max-w-3xl mx-auto">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#107C41]" /></div>
          ) : !isAdmin ? (
            <div className="bg-white border border-[#D4D4D4] rounded-lg p-6 text-center">
              <ShieldAlert className="w-10 h-10 text-[#C00000] mx-auto mb-2" />
              <h2 className="text-base font-bold">Admin access only</h2>
              <p className="text-sm text-[#595959] mt-1">Add <code>{user?.email}</code> to ADMIN_EMAILS to gain access.</p>
            </div>
          ) : (
            <>
              <div className="bg-white border border-[#D4D4D4] rounded p-3 mb-3 flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-[#107C41]" />
                <span className="text-xs text-[#595959] flex-1">Share app: </span>
                <code className="text-[11px] font-mono text-[#0D6535] truncate">{appOrigin}</code>
                <button onClick={() => copy(appOrigin, "origin")} className="flex items-center gap-1 border border-[#D4D4D4] px-2 py-1 rounded text-xs font-semibold hover:border-[#107C41]">
                  {copied === "origin" ? <><Check className="w-3 h-3 text-[#107C41]" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>

              <div className="flex justify-between items-center mb-3">
                <p className="text-xs text-[#595959]">{invites.length} code{invites.length !== 1 ? "s" : ""} generated</p>
                <button onClick={() => setShowNew(true)} className="bg-[#107C41] hover:bg-[#0D6535] text-white px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> New Invite
                </button>
              </div>

              {invites.length === 0 ? (
                <div className="bg-white border border-[#D4D4D4] rounded p-6 text-center">
                  <Gift className="w-10 h-10 text-[#107C41] mx-auto mb-2" strokeWidth={1.5} />
                  <p className="text-sm text-[#595959]">No invite codes yet. Generate one to hand out exclusive trial access.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {invites.map((inv) => {
                    const used = inv.use_count || 0;
                    const max = inv.max_uses || 1;
                    const status = !inv.is_active ? "revoked" : used >= max ? "used" : "active";
                    const statusColor = status === "active" ? "bg-[#D1E7DD] text-[#0F5132]" : status === "used" ? "bg-[#E2E3E5] text-[#41464B]" : "bg-[#F8D7DA] text-[#721C24]";
                    return (
                      <div key={inv.code} className="bg-white border border-[#D4D4D4] rounded p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-mono text-base font-bold text-[#107C41] tracking-wider">{inv.code}</code>
                          <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded uppercase ${statusColor}`}>{status}</span>
                          <span className="text-[10px] text-[#595959]">{used}/{max} used · {inv.grant_days}d grant</span>
                          <div className="ml-auto flex gap-1">
                            <button onClick={() => copy(inv.code, inv.code)} className="border border-[#D4D4D4] px-2 py-1 rounded text-xs font-semibold hover:border-[#107C41] flex items-center gap-1">
                              {copied === inv.code ? <Check className="w-3 h-3 text-[#107C41]" /> : <Copy className="w-3 h-3" />}
                            </button>
                            {inv.is_active && (
                              <button onClick={() => revoke(inv.code)} className="border border-[#F5C6CB] text-[#C00000] px-2 py-1 rounded text-xs hover:bg-[#FFF5F5]">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        {inv.note && <p className="text-[11px] text-[#595959] mt-1">Note: {inv.note}</p>}
                        {inv.redemptions?.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-[#EFEFEF]">
                            <p className="text-[10px] font-semibold text-[#595959] mb-1">Redeemed by:</p>
                            {inv.redemptions.map((r, i) => (
                              <p key={i} className="text-[11px] text-[#333]">{r.email} — {new Date(r.redeemed_at).toLocaleString()}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {showNew && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
                  <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-base font-bold mb-3 flex items-center gap-2"><Plus className="w-4 h-4 text-[#107C41]" /> New Invite Code</h3>
                    <label className="text-xs font-semibold block mb-1">Recipient / note (only you see)</label>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Jake @ Precision — pilot user" className="w-full mb-3 bg-[#FAFAFA] border border-[#CCC] px-3 py-2 rounded text-sm outline-none focus:border-[#107C41]" />
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs font-semibold block mb-1">Grant days</label>
                        <input type="number" min={1} max={3650} value={grantDays} onChange={(e) => setGrantDays(e.target.value)} className="w-full bg-[#FAFAFA] border border-[#CCC] px-3 py-2 rounded text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold block mb-1">Max uses</label>
                        <input type="number" min={1} max={10000} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} className="w-full bg-[#FAFAFA] border border-[#CCC] px-3 py-2 rounded text-sm" />
                      </div>
                    </div>
                    <p className="text-[10px] text-[#595959] mb-3">Set max uses to 1 for a personal one-time invite, or higher for a shareable code.</p>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowNew(false)} className="border border-[#D4D4D4] px-4 py-2 rounded text-sm font-semibold">Cancel</button>
                      <button onClick={create} disabled={creating} className="bg-[#107C41] hover:bg-[#0D6535] text-white px-4 py-2 rounded text-sm font-semibold flex items-center gap-2">
                        {creating && <Loader2 className="w-4 h-4 animate-spin" />} Generate
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminInvites;
