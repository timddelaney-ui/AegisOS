import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, LogOut, Users, FolderOpen, Sparkles, X, Crown, MessageSquarePlus, ShieldAlert, Gift, Ticket, Home, RefreshCw } from "lucide-react";
import axios from "axios";
import { useAuth, API, isProUser } from "../context/AuthContext";
import CoilAegisLogo from "./CoilAegisLogo";

/**
 * Hard reset the installed PWA: unregister any service worker and nuke caches,
 * then reload. The user comes back on the latest JS/CSS as if freshly installed.
 */
async function hardResetApp() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch {}
  // Full reload (bypass bfcache)
  window.location.replace(window.location.pathname + "?r=" + Date.now());
}

const AppHeader = () => {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();
  const isPro = isProUser(user);

  useEffect(() => {
    if (!user) return;
    axios.get(`${API}/admin/whoami`, { withCredentials: true }).then((r) => setIsAdmin(r.data.is_admin)).catch(() => {});
  }, [user]);

  return (
    <>
      <header
        data-testid="app-header"
        className="bg-[#0D1A24] text-white h-14 flex items-center justify-between px-4 border-b border-black/40 flex-shrink-0 safe-x"
        style={{ boxShadow: "0 1px 0 rgba(255,107,26,0.25)" }}
      >
        <button
          data-testid="brand-home"
          onClick={() => navigate("/hub")}
          className="flex items-center gap-2 min-w-0 hover:opacity-90 transition-opacity"
          aria-label="CoilAegis home"
        >
          <CoilAegisLogo size={26} variant="full" tone="light" />
          {isPro && (
            <span className="ml-1 text-[9px] bg-[#FF6B1A] text-[#0D1A24] px-1.5 py-[2px] rounded font-bold flex items-center gap-0.5 flex-shrink-0">
              <Crown className="w-2.5 h-2.5" strokeWidth={3} /> PRO
            </span>
          )}
        </button>
        <button onClick={() => setMenuOpen(true)} data-testid="menu-open" className="p-2 -mr-1 hover:bg-white/10 rounded tap-44" aria-label="Open menu">
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setMenuOpen(false)}>
          <div className="absolute top-0 right-0 w-72 h-full bg-[#111827] text-white shadow-2xl border-l border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-[#0D1A24] border-b border-white/10">
              <CoilAegisLogo size={20} variant="full" tone="light" />
              <button onClick={() => setMenuOpen(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
            </div>
            {user && (
              <div className="p-4 border-b border-white/10 flex items-center gap-3">
                {user.picture
                  ? <img src={user.picture} alt="" className="w-10 h-10 rounded-full ring-2 ring-[#FF6B1A]/60" />
                  : <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold">{user.name?.charAt(0)}</div>}
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{user.name}</p>
                  <p className="text-[11px] text-white/60 truncate">{user.email}</p>
                </div>
              </div>
            )}
            <nav className="p-2">
              <button onClick={() => { setMenuOpen(false); navigate("/hub"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded text-sm font-medium">
                <Home className="w-4 h-4 text-[#FF6B1A]" /> Hub
              </button>
              <button onClick={() => { setMenuOpen(false); navigate("/jobs"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded text-sm font-medium">
                <FolderOpen className="w-4 h-4 text-[#FF6B1A]" /> Saved Jobs
              </button>
              <button onClick={() => { setMenuOpen(false); navigate("/team"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded text-sm font-medium">
                <Users className="w-4 h-4 text-[#FF6B1A]" /> Crew / Team
              </button>
              <button onClick={() => { setMenuOpen(false); document.dispatchEvent(new CustomEvent("open-redeem")); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded text-sm font-medium">
                <Ticket className="w-4 h-4 text-[#FF6B1A]" /> Redeem Invite Code
              </button>
              <button onClick={() => { setMenuOpen(false); document.dispatchEvent(new CustomEvent("open-feedback")); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded text-sm font-medium">
                <MessageSquarePlus className="w-4 h-4 text-[#FF6B1A]" /> Send Feedback
              </button>
              {isAdmin && (
                <>
                  <button onClick={() => { setMenuOpen(false); navigate("/admin/feedback"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded text-sm font-medium">
                    <ShieldAlert className="w-4 h-4 text-[#F87171]" /> Admin: Feedback Inbox
                  </button>
                  <button onClick={() => { setMenuOpen(false); navigate("/admin/invites"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded text-sm font-medium">
                    <Gift className="w-4 h-4 text-[#F87171]" /> Admin: Invite Codes
                  </button>
                </>
              )}
              {!isPro && (
                <button onClick={() => { setMenuOpen(false); navigate("/pricing"); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded text-sm font-medium">
                  <Sparkles className="w-4 h-4 text-[#FBBF24]" /> Upgrade to Pro
                </button>
              )}
              <div className="border-t border-white/10 my-2"></div>
              <button
                data-testid="menu-reset-app"
                onClick={() => {
                  if (window.confirm("Reset the app? Clears cached files and reloads with the latest version. Your data on the server is unaffected.")) {
                    hardResetApp();
                  }
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4 text-[#FF6B1A]" /> Reset app / clear cache
              </button>
              <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#C00000]/20 rounded text-sm font-medium text-[#F87171]">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </nav>
          </div>
        </div>
      )}
    </>
  );
};

export default AppHeader;
