import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher } from "../lib/roles";
import { Link2, Copy, X, Trash2, Plus, GraduationCap, Eye } from "lucide-react";

// TTL options — 4h / 24h / 7d / Never. 0 = never expires.
const TTL_OPTIONS = [
  { hours: 4,       label: "4 hours" },
  { hours: 24,      label: "24 hours" },
  { hours: 7 * 24,  label: "7 days" },
  { hours: 0,       label: "Never" },
];

/**
 * Universal share link button. Drops onto any tool page.
 * Props:
 *   scope         'live-ops' | 'stress' | 'fatigue' | 'wellbore' | 'reels' | 'treatment' | 'job' | 'all'
 *   targetId      optional (e.g. active reel_id)
 *   compact       render as icon-only when true
 */
export default function ShareLinksButton({ scope = "live-ops", targetId = null, compact = false }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState([]);
  const [label, setLabel] = useState("Client view");
  const [ttlHours, setTtlHours] = useState(7 * 24);
  const [mode, setMode] = useState("readonly");
  if (!isSupervisorOrHigher(user)) return null;

  const refresh = async () => {
    try { const r = await axios.get(`${API}/share-links`, { withCredentials: true }); setLinks(r.data?.links || []); }
    catch { /* ignore */ }
  };

  const openModal = () => { setOpen(true); refresh(); };

  const create = async () => {
    try {
      const r = await axios.post(`${API}/share-links`, {
        label, ttl_hours: ttlHours, scope, mode, target_id: targetId,
      }, { withCredentials: true });
      const fullUrl = `${window.location.origin}${r.data.share_url_path}`;
      try {
        await navigator.clipboard.writeText(fullUrl);
        const ttlLabel = ttlHours === 0 ? "never expires" : `valid for ${ttlHours >= 24 ? `${ttlHours / 24} day${ttlHours === 24 ? "" : "s"}` : `${ttlHours}h`}`;
        toast.success(`Link copied — ${ttlLabel}${mode === "training" ? " · Training mode" : ""}`);
      } catch { toast.success("Link created — scroll to copy it"); }
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
    catch { toast.error("Failed"); }
  };

  return (
    <>
      <button
        data-testid="share-links-open-btn"
        onClick={openModal}
        className={compact
          ? "p-1.5 rounded hover:bg-white/10 border border-white/20 text-white"
          : "flex items-center gap-1 px-3 py-1 rounded font-bold text-xs bg-white/10 border border-white/20"}
        title="Share this view with your client"
      >
        <Link2 className="w-3.5 h-3.5" />{!compact && "Client link"}
      </button>

      {open && (
        <div onClick={() => setOpen(false)} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3">
          <div onClick={(e) => e.stopPropagation()} data-testid="share-links-modal" className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-[#E5E5E5]">
              <h2 className="font-bold text-sm text-[#262626] flex items-center gap-2"><Link2 className="w-4 h-4" />Share this view</h2>
              <button data-testid="share-close" onClick={() => setOpen(false)} className="hover:bg-[#F3F4F6] rounded p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-3 border-b border-[#E5E5E5] space-y-2.5">
              <p className="text-[11px] text-[#595959]">
                Opens straight into <span className="font-bold">{scope}</span>. No Google sign-in required. Guest cannot see pay, scheduling, DAQ internals, or crew admin.
              </p>

              <input
                data-testid="share-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (e.g. Acme Energy day shift)"
                className="w-full border rounded px-2 py-1.5 text-sm"
              />

              {/* TTL options */}
              <div>
                <label className="text-[10px] font-bold uppercase text-[#595959] block mb-1">Expires</label>
                <div className="flex flex-wrap gap-1">
                  {TTL_OPTIONS.map((opt) => (
                    <button
                      key={opt.hours}
                      type="button"
                      data-testid={`share-ttl-${opt.hours}`}
                      onClick={() => setTtlHours(opt.hours)}
                      className={`text-[11px] font-bold px-2 py-1 rounded border ${ttlHours === opt.hours ? "bg-[#FF6B1A] text-white border-[#FF6B1A]" : "bg-white border-[#D4D4D4] hover:border-[#FF6B1A]"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode toggle */}
              <div>
                <label className="text-[10px] font-bold uppercase text-[#595959] block mb-1">Mode</label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    data-testid="share-mode-readonly"
                    onClick={() => setMode("readonly")}
                    className={`flex-1 text-[11px] font-bold px-2 py-1.5 rounded border flex items-center justify-center gap-1 ${mode === "readonly" ? "bg-[#0056B3] text-white border-[#0056B3]" : "bg-white border-[#D4D4D4]"}`}
                  >
                    <Eye className="w-3 h-3" />Read-only
                  </button>
                  <button
                    type="button"
                    data-testid="share-mode-training"
                    onClick={() => setMode("training")}
                    className={`flex-1 text-[11px] font-bold px-2 py-1.5 rounded border flex items-center justify-center gap-1 ${mode === "training" ? "bg-[#FF6B1A] text-white border-[#FF6B1A]" : "bg-white border-[#D4D4D4]"}`}
                  >
                    <GraduationCap className="w-3 h-3" />Training (AI panel)
                  </button>
                </div>
                <p className="text-[10px] text-[#8A8A8A] mt-1">
                  Training mode adds a &ldquo;TRAINING SIMULATION&rdquo; banner and an embedded AI assistant for what-if questions.
                </p>
              </div>

              <button
                data-testid="share-create"
                onClick={create}
                className="w-full bg-[#FF6B1A] hover:bg-[#C44A08] text-white px-3 py-2 font-bold rounded flex items-center gap-1 justify-center text-sm"
              >
                <Plus className="w-4 h-4" />Create link & copy
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {links.length === 0 && <p className="text-sm text-[#595959] text-center py-4">No links yet.</p>}
              {links.map((l) => {
                const fullUrl = `${window.location.origin}${l.share_url_path}`;
                const dead = l.revoked || l.is_expired;
                return (
                  <div key={l.link_id} data-testid={`share-row-${l.link_id}`} className={`border rounded p-2 ${dead ? "bg-[#F3F4F6] opacity-60" : "bg-white"}`}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-bold">{l.label || "Client view"}</span>
                      {l.mode === "training" && (
                        <span className="text-[9px] font-bold bg-[#FEF3C7] text-[#C36600] px-1 rounded uppercase flex items-center gap-0.5">
                          <GraduationCap className="w-2.5 h-2.5" />Training
                        </span>
                      )}
                      {l.scope && l.scope !== "live-ops" && (
                        <span className="text-[9px] font-bold bg-[#E0E7FF] text-[#3730A3] px-1 rounded uppercase">
                          {l.scope}
                        </span>
                      )}
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
                    <p className="text-[10px] text-[#9CA3AF] mt-0.5">
                      {l.expires_at ? `Expires ${l.expires_at?.slice(0, 10)}` : "Never expires"}
                    </p>
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
