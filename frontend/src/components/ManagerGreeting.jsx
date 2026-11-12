import React, { useEffect, useMemo, useState } from "react";
import { X, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const FIELD_MANAGER_QUIPS = [
  { headline: "Well, look who rolled in.", body: "The Field Manager just clocked in. Stow the coffee, dust off the JHA, and try to look at least mildly productive." },
  { headline: "Boss on deck.", body: "Field Manager's boots hit the mat. Perfect time to remember that safety meeting we all totally definitely had before shift." },
  { headline: "Alert: adult in the building.", body: "The FM is on-site. Straighten the helmets, look busy, and please — for the love of all that's holy — do NOT mention what happened to the last dropdown wrench." },
  { headline: "Field Manager: activated.", body: "Cape-verified authority just walked in. Best JHA voice engaged. Try not to lean on the coil reel — it's judging you." },
];

const OPS_MANAGER_QUIPS = [
  { headline: "Suits on-site — batten down!", body: "The Ops Manager is watching every rig now. Best behaviour, PPE on straight, and absolutely no one mention the Friday sock-hop incident." },
  { headline: "Big boss just logged in.", body: "Ops Manager is scanning the dashboard. Every check-off, every alert, every low-stock flag. This is your moment — deliver professional-grade output." },
  { headline: "Cross-team eyes are watching.", body: "Master view is live — Rigs 1 through 25, all lit up on their screen. Do your best work today; you're on the wall of glory now." },
  { headline: "The Ops Manager has entered the chat.", body: "Cross-team dashboard is up. Bumped H₂S monitors, signed JHAs, coffee out of the doghouse — you know the drill. Nothing to see here except a picture-perfect operation." },
];

const STORAGE_KEY = (uid) => `ctp_mgr_greet_v1::${uid}`;

/**
 * ManagerGreeting — shows a light-hearted welcome banner when a user with role
 * field_manager or ops_manager (or admin) signs in. Renders once per user per browser day.
 */
const ManagerGreeting = () => {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  const role = user?.role || "crew";
  const isManager = role === "field_manager" || role === "ops_manager";
  const quip = useMemo(() => {
    const pool = role === "ops_manager" ? OPS_MANAGER_QUIPS : FIELD_MANAGER_QUIPS;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [role]);

  useEffect(() => {
    if (!user || !isManager) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const stored = localStorage.getItem(STORAGE_KEY(user.user_id));
      if (stored !== today) setVisible(true);
    } catch { setVisible(true); }
  }, [user, isManager]);

  const dismiss = () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem(STORAGE_KEY(user.user_id), today);
    } catch {}
    setVisible(false);
  };

  if (!visible || !isManager) return null;

  const accent = role === "ops_manager" ? "#C44A08" : "#0056B3";
  const roleTag = role === "ops_manager" ? "OPS MANAGER" : "FIELD MANAGER";

  return (
    <div
      data-testid="manager-greeting"
      className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3"
      onClick={dismiss}
    >
      <div
        className="bg-white w-full max-w-md rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 flex items-center gap-2 text-white" style={{ background: accent }}>
          <ShieldCheck className="w-5 h-5" strokeWidth={2.5} />
          <div className="flex-1">
            <div className="text-[10px] uppercase font-bold tracking-wider text-white/80">{roleTag} · signed in</div>
            <div className="text-sm font-bold">{quip.headline}</div>
          </div>
          <button data-testid="manager-greeting-close" onClick={dismiss} className="text-white/80 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2 items-start">
            <Sparkles className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: accent }} strokeWidth={2.5} />
            <p className="text-[13px] leading-relaxed text-[#262626] italic">"{quip.body}"</p>
          </div>
          <div className="text-[10px] text-[#595959]">— Skipper, on watch</div>
          <button
            data-testid="manager-greeting-dismiss"
            onClick={dismiss}
            className="w-full py-2 text-white font-bold text-sm rounded"
            style={{ background: accent }}
          >
            Let's get to work
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManagerGreeting;
