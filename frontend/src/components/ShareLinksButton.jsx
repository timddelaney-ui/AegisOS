import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher } from "../lib/roles";
import { Link2, Copy, X, Trash2, Plus } from "lucide-react";

export default function ShareLinksButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState([]);
  const [label, setLabel] = useState("Client view");
  const [days, setDays] = useState(7);
  if (!isSupervisorOrHigher(user)) return null;

  const refresh = async () => {
    try { const r = await axios.get(`${API}/share-links`, { withCredentials: true }); setLinks(r.data?.links || []); }
    catch { /* ignore */ }
  };

  const openModal = () => { setOpen(true); refresh(); };

  const create = async () => {
    try {
      const r = await axios.post(`${API}/share-links`, { label, days: Math.max(1, Math.min(30, Number(days) || 7)) }, { withCredentials: true });
      const fullUrl = `${window.location.origin}${r.data.share_url_path}`;
      try { await navigator.clipboard.writeText(fullUrl); toast.success("Link copied — valid for 7 days"); }
      catch { toast.success("Link created — scroll to copy it"); }
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const copy = async (link) => {
    const fullUrl = `${window.location.origin}${link.share_url_path}`;
    try { await navigator.clipboard.writeText(fullUrl); toast.success("Copied"); }
    catch { toast.info(fullUrl); }
  };

  const revoke = async (id) => {
    if (!window.confirm("Revoke this link immediately?")) return;
    try { await axios.delete(`${API}/share-links/${id}`, { withCredentials: true }); refresh(); }
    catch (e) { toast.error("Failed"); }
  };

  return (
    <>
      <button
        data-testid="liveops-share-btn"
        onClick={openModal}
        className="flex items-center gap-1 px-3 py-1 rounded font-bold text-xs bg-white/10 border border-white/20"
      >
        <Link2 className="w-3.5 h-3.5" />Client link
      </button>

      {open && (
        <div onClick={() => setOpen(false)} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3">
          <div onClick={(e) => e.stopPropagation()} data-testid="share-links-modal" className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-[#E5E5E5]">
              <h2 className="font-bold text-sm text-[#262626] flex items-center gap-2"><Link2 className="w-4 h-4" />Client Share Links</h2>
              <button onClick={() => setOpen(false)} className="hover:bg-[#F3F4F6] rounded p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-3 border-b border-[#E5E5E5] space-y-2">
              <p className="text-[11px] text-[#595959]">7-day read-only URL. Opens straight into Live Ops. No Google sign-in required. Guest cannot see pay, scheduling, DAQ internals, or crew admin.</p>
              <div className="grid grid-cols-5 gap-2 text-xs">
                <input data-testid="share-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Acme Energy)" className="border rounded px-2 py-1 col-span-3" />
                <input data-testid="share-days" type="number" min="1" max="30" value={days} onChange={(e) => setDays(e.target.value)} className="border rounded px-2 py-1" />
                <button data-testid="share-create" onClick={create} className="bg-[#FF6B1A] text-white px-2 py-1 font-bold rounded flex items-center gap-1 justify-center"><Plus className="w-3 h-3" />Create</button>
              </div>
              <p className="text-[10px] text-[#9CA3AF]">days (1–30)</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {links.length === 0 && <p className="text-sm text-[#595959] text-center py-4">No links yet.</p>}
              {links.map((l) => {
                const fullUrl = `${window.location.origin}${l.share_url_path}`;
                const dead = l.revoked || l.is_expired;
                return (
                  <div key={l.link_id} data-testid={`share-row-${l.link_id}`} className={`border rounded p-2 ${dead ? "bg-[#F3F4F6] opacity-60" : "bg-white"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold">{l.label || "Client view"}</span>
                      {l.revoked && <span className="text-[9px] font-bold bg-[#F8D7DA] text-[#991B1B] px-1 rounded uppercase">Revoked</span>}
                      {!l.revoked && l.is_expired && <span className="text-[9px] font-bold bg-[#F3F4F6] text-[#595959] px-1 rounded uppercase">Expired</span>}
                      {!dead && <span className="text-[9px] font-bold bg-[#DCFCE7] text-[#065F46] px-1 rounded uppercase">Active</span>}
                      <span className="ml-auto text-[10px] text-[#595959]">{l.use_count} use{l.use_count !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-[#595959]">
                      <input readOnly value={fullUrl} data-testid={`share-url-${l.link_id}`} className="flex-1 bg-[#F8FAFC] border rounded px-1.5 py-0.5 font-mono text-[10px] truncate" />
                      <button data-testid={`share-copy-${l.link_id}`} onClick={() => copy(l)} className="p-1 hover:bg-[#F3F4F6] rounded" title="Copy"><Copy className="w-3.5 h-3.5" /></button>
                      {!dead && <button data-testid={`share-revoke-${l.link_id}`} onClick={() => revoke(l.link_id)} className="p-1 text-[#C00000] hover:bg-[#F8D7DA] rounded" title="Revoke"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                    <p className="text-[10px] text-[#9CA3AF] mt-0.5">Expires {l.expires_at?.slice(0, 10)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
