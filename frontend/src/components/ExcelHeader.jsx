import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileSpreadsheet, Menu, LogOut, Users, FolderOpen, Sparkles, X, Crown, MessageSquarePlus, ShieldAlert, Gift, Ticket, Home } from "lucide-react";
import axios from "axios";
import { useAuth, API } from "../context/AuthContext";
import FeedbackDialog from "./FeedbackDialog";
import RedeemDialog from "./RedeemDialog";

const ExcelHeader = () => {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();
  const isPro = user?.subscription_status === "active";

  useEffect(() => {
    if (!user) return;
    axios.get(`${API}/admin/whoami`, { withCredentials: true }).then((r) => setIsAdmin(r.data.is_admin)).catch(() => {});
  }, [user]);

  return (
    <>
      <header className="bg-[#107C41] text-white h-12 flex items-center justify-between px-3 shadow-md flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileSpreadsheet className="w-4 h-4 flex-shrink-0" strokeWidth={2.5} />
          <h1 className="text-sm font-semibold tracking-wide truncate">CT_Field_Operations.xlsx</h1>
          {isPro && (
            <span className="text-[9px] bg-[#FFD700]/90 text-[#856404] px-1.5 py-[2px] rounded font-bold flex items-center gap-0.5 flex-shrink-0">
              <Crown className="w-2.5 h-2.5" strokeWidth={3} /> PRO
            </span>
          )}
        </div>
        <button onClick={() => setMenuOpen(true)} className="p-1 hover:bg-white/10 rounded">
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setMenuOpen(false)}>
          <div className="absolute top-0 right-0 w-72 h-full bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-[#107C41] text-white">
              <span className="font-semibold text-sm">Menu</span>
              <button onClick={() => setMenuOpen(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            {user && (
              <div className="p-4 border-b border-[#EFEFEF] flex items-center gap-3">
                {user.picture ? <img src={user.picture} alt="" className="w-10 h-10 rounded-full" /> : <div className="w-10 h-10 rounded-full bg-[#D4D4D4] flex items-center justify-center text-sm font-bold">{user.name?.charAt(0)}</div>}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#262626] truncate">{user.name}</p>
                  <p className="text-[11px] text-[#595959] truncate">{user.email}</p>
                </div>
              </div>
            )}
            <nav className="p-2">
              <button onClick={() => { setMenuOpen(false); navigate("/hub"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F0F9F3] rounded text-sm font-medium text-[#262626]">
                <Home className="w-4 h-4 text-[#107C41]" /> Hub
              </button>
              <button onClick={() => { setMenuOpen(false); navigate("/jobs"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F0F9F3] rounded text-sm font-medium text-[#262626]">
                <FolderOpen className="w-4 h-4 text-[#107C41]" /> Saved Jobs
              </button>
              <button onClick={() => { setMenuOpen(false); navigate("/team"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F0F9F3] rounded text-sm font-medium text-[#262626]">
                <Users className="w-4 h-4 text-[#107C41]" /> Crew / Team
              </button>
              <button onClick={() => { setMenuOpen(false); setRedeemOpen(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F0F9F3] rounded text-sm font-medium text-[#262626]">
                <Ticket className="w-4 h-4 text-[#107C41]" /> Redeem Invite Code
              </button>
              <button onClick={() => { setMenuOpen(false); setFeedbackOpen(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F0F9F3] rounded text-sm font-medium text-[#262626]">
                <MessageSquarePlus className="w-4 h-4 text-[#107C41]" /> Send Feedback
              </button>
              {isAdmin && (
                <>
                  <button onClick={() => { setMenuOpen(false); navigate("/admin/feedback"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F0F9F3] rounded text-sm font-medium text-[#262626]">
                    <ShieldAlert className="w-4 h-4 text-[#C00000]" /> Admin: Feedback Inbox
                  </button>
                  <button onClick={() => { setMenuOpen(false); navigate("/admin/invites"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F0F9F3] rounded text-sm font-medium text-[#262626]">
                    <Gift className="w-4 h-4 text-[#C00000]" /> Admin: Invite Codes
                  </button>
                </>
              )}
              {!isPro && (
                <button onClick={() => { setMenuOpen(false); navigate("/pricing"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F0F9F3] rounded text-sm font-medium text-[#262626]">
                  <Sparkles className="w-4 h-4 text-[#856404]" /> Upgrade to Pro
                </button>
              )}
              <div className="border-t border-[#EFEFEF] my-2"></div>
              <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#FFF5F5] rounded text-sm font-medium text-[#C00000]">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </nav>
          </div>
        </div>
      )}

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <RedeemDialog open={redeemOpen} onClose={() => setRedeemOpen(false)} />
    </>
  );
};

export default ExcelHeader;
