import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Bell, MessageSquare, ListChecks, ClipboardList, AlertOctagon, X, Dot } from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";

const POLL_MS = 15000;                               // 15 s background cadence
const SINCE_STORAGE = (rig) => `ctp_notif_since_${rig || "default"}_v1`;
const PERM_STORAGE = "ctp_notif_browser_permission_asked_v1";

const isoNow = () => new Date().toISOString();

/**
 * NotificationCenter — mounted globally. Polls the server every POLL_MS for
 * fresh crew-chat, task, and treatment activity on the user's active rig.
 * Fires sonner toasts for new activity when the user isn't already on the
 * page that would show it, and keeps a bell icon with a badge count that
 * opens a mini drawer summarising what's new.
 */
export default function NotificationCenter() {
  const { user } = useAuth();
  const { rigId } = useRig();
  const navigate = useNavigate();
  const location = useLocation();
  const [digest, setDigest] = useState({ chat: {count:0, latest:[]}, tasks: {count:0, latest:[]}, treatment: {count:0, latest:[], treatment_id:null, treatment_name:null} });
  const [open, setOpen] = useState(false);
  const toastedIds = useRef(new Set());  // de-dupe toast IDs across polls

  const sinceRef = useRef(null);

  // Load last-seen marker from localStorage whenever the active rig changes.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SINCE_STORAGE(rigId));
      sinceRef.current = stored || null;
    } catch { sinceRef.current = null; }
  }, [rigId]);

  // Ask once for browser notification permission (silently fail if denied).
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const asked = localStorage.getItem(PERM_STORAGE);
      if (asked) return;
      if (Notification.permission === "default") {
        // Delay a bit so we don't blast new users on first login.
        setTimeout(() => {
          Notification.requestPermission().catch(() => {});
          try { localStorage.setItem(PERM_STORAGE, "1"); } catch {}
        }, 8000);
      } else {
        try { localStorage.setItem(PERM_STORAGE, "1"); } catch {}
      }
    } catch {}
  }, []);

  const path = location.pathname;
  const onTeamPage      = path.startsWith("/team");
  const onTreatmentPage = path.startsWith("/treatment");

  const notifyUser = useCallback((title, body, onClick) => {
    try {
      if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
        const n = new Notification(title, { body, icon: "/icon-192.png", tag: title });
        n.onclick = () => { window.focus(); onClick?.(); n.close(); };
      }
    } catch {}
  }, []);

  const fetchDigest = useCallback(async () => {
    if (!user) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      const { data } = await axios.get(`${API}/notifications/digest`, {
        params: { rig_id: rigId, since: sinceRef.current || undefined, limit: 5 },
        withCredentials: true,
      });
      setDigest(data);

      // Fire toasts ONLY for messages we haven't toasted yet this session —
      // crucial so a user who leaves the browser tab for an hour doesn't
      // return to 40 stacked toasts.
      const chatLatest = data.chat?.latest || [];
      for (const m of chatLatest) {
        const key = `chat:${m.id || m.message_id || m.created_at}`;
        if (toastedIds.current.has(key)) continue;
        toastedIds.current.add(key);
        if (onTeamPage) continue;  // already looking at the chat
        const sender = m.sender_name || m.sender || "crew";
        const txt = (m.text || "").slice(0, 140);
        if (m.is_alert) {
          toast.error(`⚠ Safety alert on ${rigLabel(rigId)} — ${sender}`, {
            description: txt,
            action: { label: "Open", onClick: () => navigate("/team") },
            duration: 10000,
          });
          notifyUser(`Safety alert · ${rigLabel(rigId)}`, `${sender}: ${txt}`, () => navigate("/team"));
        } else {
          toast(`${sender} — ${rigLabel(rigId)}`, {
            description: txt,
            action: { label: "Reply", onClick: () => navigate("/team") },
            duration: 6000,
          });
          notifyUser(`${sender} · ${rigLabel(rigId)}`, txt, () => navigate("/team"));
        }
      }

      // Tasks (any kind) — a single rolled-up toast per poll so we don't spam
      if (!onTeamPage && (data.tasks?.count || 0) > 0) {
        const t = data.tasks.latest?.[0];
        if (t) {
          const key = `task:${t.item_id || t.created_at}`;
          if (!toastedIds.current.has(key)) {
            toastedIds.current.add(key);
            const n = data.tasks.count;
            toast(`${n} new ${n === 1 ? "task" : "tasks"} on ${rigLabel(rigId)}`, {
              description: `${t.created_by_name || t.created_by || "someone"} added "${(t.name || "").slice(0, 80)}"`,
              action: { label: "Open", onClick: () => navigate("/team") },
              duration: 6000,
            });
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
            toast(`Treatment update — ${data.treatment.treatment_name || rigLabel(rigId)}`, {
              description: `${e.author_name || "crew"}: ${(e.text || "").slice(0, 120)}`,
              action: { label: "View", onClick: () => navigate("/treatment") },
              duration: 6000,
            });
          }
        }
      }
    } catch {
      // Transient — next poll retries
    }
  }, [user, rigId, onTeamPage, onTreatmentPage, navigate, notifyUser]);

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

  // Auto-mark-seen when the user actually visits the relevant page.
  useEffect(() => {
    if (!user) return;
    const shouldClear = (
      (onTeamPage      && (digest.chat.count > 0 || digest.tasks.count > 0)) ||
      (onTreatmentPage && digest.treatment.count > 0)
    );
    if (!shouldClear) return;
    const now = isoNow();
    sinceRef.current = now;
    try { localStorage.setItem(SINCE_STORAGE(rigId), now); } catch {}
    // Zero out local counts so the badge disappears without waiting for next poll.
    setDigest((d) => ({
      ...d,
      chat:  onTeamPage      ? { ...d.chat,  count: 0, latest: [] } : d.chat,
      tasks: onTeamPage      ? { ...d.tasks, count: 0, latest: [] } : d.tasks,
      treatment: onTreatmentPage ? { ...d.treatment, count: 0, latest: [] } : d.treatment,
    }));
  }, [onTeamPage, onTreatmentPage, digest.chat.count, digest.tasks.count, digest.treatment.count, rigId, user]);

  if (!user) return null;

  const total = (digest.chat?.count || 0) + (digest.tasks?.count || 0) + (digest.treatment?.count || 0);
  const hasAlert = !!digest.chat?.has_alert;

  // Avoid colliding with the Workbook's hamburger menu button (also top-right in /app).
  const onWorkbookRoute = path.startsWith("/app");

  const markAllSeen = () => {
    const now = isoNow();
    sinceRef.current = now;
    try { localStorage.setItem(SINCE_STORAGE(rigId), now); } catch {}
    setDigest({ chat:{count:0, has_alert:false, latest:[]}, tasks:{count:0, latest:[]}, treatment:{count:0, latest:[], treatment_id:null, treatment_name:null} });
    setOpen(false);
  };

  return (
    <>
      {/* Bell button — fixed in the top-right so every page can see it */}
      <button
        data-testid="notif-bell"
        onClick={() => setOpen((v) => !v)}
        className="fixed z-[60] top-2 w-9 h-9 rounded-full bg-white/95 border border-[#D4D4D4] shadow flex items-center justify-center hover:bg-white tap-44 safe-top"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)", right: onWorkbookRoute ? "52px" : "8px" }}
        aria-label={`Notifications${total ? ` (${total} new)` : ""}`}
      >
        <Bell className={`w-4 h-4 ${total > 0 ? "text-[#0D6535]" : "text-[#595959]"}`} strokeWidth={2.5} />
        {total > 0 && (
          <span
            data-testid="notif-badge"
            className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center ${hasAlert ? "bg-[#C00000] animate-pulse" : "bg-[#0D6535]"}`}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[64] bg-black/20" onClick={() => setOpen(false)} />
          <div
            data-testid="notif-drawer"
            className="fixed z-[65] right-2 top-12 w-[92vw] max-w-sm bg-white border border-[#D4D4D4] rounded-lg shadow-2xl overflow-hidden"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 48px)" }}
          >
            <div className="px-3 py-2 border-b border-[#E5E7EB] bg-[#F0F9F3] flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#0D6535]" strokeWidth={2.5} />
              <div className="text-sm font-bold text-[#0D6535] flex-1">What's new · {rigLabel(rigId)}</div>
              <button data-testid="notif-mark-seen" onClick={markAllSeen} className="text-[10px] font-bold text-[#0D6535] hover:underline">Mark all seen</button>
              <button data-testid="notif-close" onClick={() => setOpen(false)} className="p-1 text-[#8A8A8A] hover:text-[#262626] tap-44"><X className="w-4 h-4" /></button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {total === 0 && (
                <div className="p-6 text-center text-[12px] text-[#595959]">
                  You're caught up. 🫡<br />
                  <span className="text-[11px] italic text-[#8A8A8A]">Pings land here when crew post messages, tasks, or treatment updates.</span>
                </div>
              )}

              {digest.chat.count > 0 && (
                <div className="p-2 border-b border-[#F0F0F0]">
                  <button onClick={() => { setOpen(false); navigate("/team"); }} className="w-full text-left flex items-center gap-2 px-1 py-1 rounded hover:bg-[#F0F9F3]">
                    <MessageSquare className="w-4 h-4 text-[#0D6535] flex-shrink-0" strokeWidth={2.5} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-bold text-[#0D6535]">
                        {digest.chat.count} new chat {digest.chat.count === 1 ? "message" : "messages"}
                        {digest.chat.has_alert && <span className="ml-1 inline-flex items-center gap-0.5 bg-[#F8D7DA] text-[#721C24] text-[9px] font-bold px-1 py-0.5 rounded"><AlertOctagon className="w-2.5 h-2.5" strokeWidth={3} /> ALERT</span>}
                      </div>
                      {digest.chat.latest.slice(0, 3).map((m) => (
                        <div key={m.id || m.message_id || m.created_at} className="text-[11px] text-[#595959] truncate">
                          <strong className="text-[#262626]">{m.sender_name || m.sender}:</strong> {m.text}
                        </div>
                      ))}
                    </div>
                  </button>
                </div>
              )}

              {digest.tasks.count > 0 && (
                <div className="p-2 border-b border-[#F0F0F0]">
                  <button onClick={() => { setOpen(false); navigate("/team"); }} className="w-full text-left flex items-center gap-2 px-1 py-1 rounded hover:bg-[#F0F9F3]">
                    <ListChecks className="w-4 h-4 text-[#0056B3] flex-shrink-0" strokeWidth={2.5} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-bold text-[#0056B3]">
                        {digest.tasks.count} new {digest.tasks.count === 1 ? "task / item" : "tasks / items"}
                      </div>
                      {digest.tasks.latest.slice(0, 3).map((t) => (
                        <div key={t.item_id || t.created_at} className="text-[11px] text-[#595959] truncate">
                          <strong className="text-[#262626]">{t.created_by_name || t.created_by}:</strong> {t.name}
                          <Dot className="w-3 h-3 inline text-[#8A8A8A]" /><span className="text-[10px] uppercase">{t.kind?.replace("_", " ")}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                </div>
              )}

              {digest.treatment.count > 0 && (
                <div className="p-2">
                  <button onClick={() => { setOpen(false); navigate("/treatment"); }} className="w-full text-left flex items-center gap-2 px-1 py-1 rounded hover:bg-[#F0F9F3]">
                    <ClipboardList className="w-4 h-4 text-[#065F46] flex-shrink-0" strokeWidth={2.5} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-bold text-[#065F46]">
                        {digest.treatment.count} new treatment {digest.treatment.count === 1 ? "entry" : "entries"}
                        {digest.treatment.treatment_name && <span className="ml-1 text-[10px] font-semibold text-[#595959] uppercase">· {digest.treatment.treatment_name}</span>}
                      </div>
                      {digest.treatment.latest.slice(0, 3).map((e) => (
                        <div key={e.entry_id || e.created_at} className="text-[11px] text-[#595959] truncate">
                          <strong className="text-[#262626]">{e.author_name || e.author}:</strong> {e.text}
                        </div>
                      ))}
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
