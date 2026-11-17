import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Bell, MessageSquare, ListChecks, ClipboardList, X } from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";

const POLL_MS = 15000;
const SINCE_STORAGE = (rig) => `ctp_notif_since_${rig || "default"}_v2`;
const PERM_STORAGE = "ctp_notif_perm_prompted_v2";
const PERM_BANNER_DISMISSED = "ctp_notif_perm_banner_dismissed_v1";
const isoNow = () => new Date().toISOString();

function validateDigest(data) {
  if (!["chat", "tasks", "treatment"].every((key) => {
    const section = data?.[key];
    return Number.isInteger(section?.count) && section.count >= 0 &&
      Array.isArray(section.latest) &&
      section.latest.every((item) => item !== null && typeof item === "object" && !Array.isArray(item));
  })) {
    throw new Error("Invalid notification digest response");
  }
}

/**
 * NotificationCenter (iter 29) — no bell UI. The user asked for banner
 * notifications (sonner toasts) + proper OS-level notifications (Web
 * Notification API) and NO fixed-position bell button cluttering the top-right.
 *
 * Responsibilities:
 *  - Silently poll /notifications/digest every 15s for new chat / tasks / treatment.
 *  - Fire sonner banner toasts for anything the user hasn't seen yet.
 *  - Fire OS-level Notifications when the tab is backgrounded AND permission granted.
 *  - Show a one-time dismissible banner to request permission (never auto-prompt).
 *  - Auto-mark-seen when the user visits the relevant page.
 */
export default function NotificationCenter() {
  const { user } = useAuth();
  const { rigId } = useRig();
  const navigate = useNavigate();
  const location = useLocation();
  const [digest, setDigest] = useState({
    chat: { count: 0, latest: [] },
    tasks: { count: 0, latest: [] },
    treatment: { count: 0, latest: [], treatment_name: null },
  });
  const toastedIds = useRef(new Set());
  const sinceRef = useRef(null);
  const [showPermBanner, setShowPermBanner] = useState(false);
  const [digestUnavailable, setDigestUnavailable] = useState(false);

  // Load last-seen marker whenever the active rig changes.
  useEffect(() => {
    try {
      sinceRef.current = localStorage.getItem(SINCE_STORAGE(rigId)) || null;
    } catch { sinceRef.current = null; }
  }, [rigId]);

  // Decide whether to show the "Turn on notifications" one-time banner.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      if (localStorage.getItem(PERM_BANNER_DISMISSED)) return;
      if (Notification.permission === "default") {
        // Delay so new users see the app first; shows ONCE until dismissed/granted.
        const t = setTimeout(() => setShowPermBanner(true), 6000);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  const requestPermission = async () => {
    try {
      const result = await Notification.requestPermission();
      localStorage.setItem(PERM_STORAGE, result);
      localStorage.setItem(PERM_BANNER_DISMISSED, "1");
      setShowPermBanner(false);
      if (result === "granted") {
        toast.success("Device alerts turned on — you'll ping when crew chat, tasks, or treatment updates arrive.");
      }
    } catch {
      setShowPermBanner(false);
    }
  };
  const dismissBanner = () => {
    try { localStorage.setItem(PERM_BANNER_DISMISSED, "1"); } catch {}
    setShowPermBanner(false);
  };

  const path = location.pathname;
  const onTeamPage = path.startsWith("/team");
  const onTreatmentPage = path.startsWith("/treatment") || path === "/log";

  // Fire an OS notification (only visible when tab is backgrounded).
  const notifyOS = useCallback((title, body, onClick) => {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      if (document.visibilityState === "visible") return;
      const n = new Notification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: title,              // collapse duplicates by title
        renotify: false,
      });
      n.onclick = () => { window.focus(); try { onClick?.(); } catch {} n.close(); };
    } catch {}
  }, []);

  const fetchDigest = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await axios.get(`${API}/notifications/digest`, {
        params: { rig_id: rigId, since: sinceRef.current || undefined, limit: 5 },
        withCredentials: true,
      });
      validateDigest(data);
      setDigest(data);
      setDigestUnavailable(false);

      // Chat banners
      for (const m of data.chat?.latest || []) {
        const key = `chat:${m.id || m.message_id || m.created_at}`;
        if (toastedIds.current.has(key)) continue;
        toastedIds.current.add(key);
        if (onTeamPage) continue;
        const sender = m.sender_name || m.sender || "crew";
        const txt = (m.text || "").slice(0, 140);
        toast(`${sender} · ${rigLabel(rigId)}`, {
          description: txt,
          icon: <MessageSquare className="w-4 h-4 text-[#C44A08]" />,
          action: { label: "Reply", onClick: () => navigate("/team") },
          duration: 7000,
          className: "ctp-banner-chat",
        });
        notifyOS(`${sender} · ${rigLabel(rigId)}`, txt, () => navigate("/team"));
      }

      // Tasks — rolled-up
      if (!onTeamPage && (data.tasks?.count || 0) > 0) {
        const t = data.tasks.latest?.[0];
        if (t) {
          const key = `task:${t.item_id || t.created_at}`;
          if (!toastedIds.current.has(key)) {
            toastedIds.current.add(key);
            const n = data.tasks.count;
            const title = `${n} new ${n === 1 ? "task" : "tasks"} · ${rigLabel(rigId)}`;
            const body = `${t.created_by_name || t.created_by || "someone"} added "${(t.name || "").slice(0, 80)}"`;
            toast(title, {
              description: body,
              icon: <ListChecks className="w-4 h-4 text-[#0056B3]" />,
              action: { label: "Open", onClick: () => navigate("/team") },
              duration: 7000,
              className: "ctp-banner-task",
            });
            notifyOS(title, body, () => navigate("/team"));
          }
        }
      }

      // Treatment entries
      if (!onTreatmentPage && (data.treatment?.count || 0) > 0) {
        const e = data.treatment.latest?.[0];
        if (e) {
          const key = `trt:${e.entry_id || e.created_at}`;
          if (!toastedIds.current.has(key)) {
            toastedIds.current.add(key);
            const title = `Treatment update · ${data.treatment.treatment_name || rigLabel(rigId)}`;
            const body = `${e.author_name || "crew"}: ${(e.text || "").slice(0, 120)}`;
            toast(title, {
              description: body,
              icon: <ClipboardList className="w-4 h-4 text-[#C36600]" />,
              action: { label: "View", onClick: () => navigate("/treatment") },
              duration: 7000,
              className: "ctp-banner-treatment",
            });
            notifyOS(title, body, () => navigate("/treatment"));
          }
        }
      }
    } catch (error) {
      console.warn("[Notifications] digest unavailable", error?.message);
      setDigestUnavailable(true);
    }
  }, [user, rigId, onTeamPage, onTreatmentPage, navigate, notifyOS]);

  // Poll
  useEffect(() => {
    if (!user) return;
    fetchDigest();
    const timer = setInterval(fetchDigest, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") fetchDigest(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [user, fetchDigest]);

  // Auto-mark-seen when the user visits the relevant page.
  useEffect(() => {
    if (!user) return;
    const shouldClear = (
      (onTeamPage && (digest.chat.count > 0 || digest.tasks.count > 0)) ||
      (onTreatmentPage && digest.treatment.count > 0)
    );
    if (!shouldClear) return;
    const now = isoNow();
    sinceRef.current = now;
    try { localStorage.setItem(SINCE_STORAGE(rigId), now); } catch {}
    setDigest((d) => ({
      ...d,
      chat: onTeamPage ? { ...d.chat, count: 0, latest: [] } : d.chat,
      tasks: onTeamPage ? { ...d.tasks, count: 0, latest: [] } : d.tasks,
      treatment: onTreatmentPage ? { ...d.treatment, count: 0, latest: [] } : d.treatment,
    }));
  }, [onTeamPage, onTreatmentPage, digest.chat.count, digest.tasks.count, digest.treatment.count, rigId, user]);

  if (!user) return null;

  if (!showPermBanner && !digestUnavailable) return null;

  return (
    <>
      {digestUnavailable && <p role="status" className="mx-4 my-2 text-sm text-amber-700">Crew alerts are unavailable. Retrying automatically.</p>}
      {showPermBanner && <div
      data-testid="notif-perm-banner"
      className="fixed z-[70] left-1/2 -translate-x-1/2 top-2 sm:top-4 bg-white border border-[#FF6B1A] rounded-xl shadow-xl px-3 py-2 flex items-center gap-2 max-w-[95vw] sm:max-w-sm"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
    >
      <Bell className="w-4 h-4 text-[#FF6B1A] flex-shrink-0" strokeWidth={2.6} />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-bold text-[#262626] leading-tight">Turn on crew alerts?</p>
        <p className="text-[11px] text-[#595959] leading-tight">Get device notifications for chat, tasks and treatment updates.</p>
      </div>
      <button
        data-testid="notif-perm-enable"
        onClick={requestPermission}
        className="px-2.5 py-1 bg-[#FF6B1A] hover:bg-[#C44A08] text-white text-[11px] font-bold rounded"
      >
        Turn on
      </button>
      <button
        data-testid="notif-perm-dismiss"
        onClick={dismissBanner}
        className="p-1 text-[#595959] hover:text-[#262626]"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      </div>}
    </>
  );
}
