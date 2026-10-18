import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useLocation } from "react-router-dom";
import {
  MessageSquareText, X, Send, Loader2, Bug, Lightbulb, AlertOctagon,
  Sparkles, Check, ClipboardList, Flame,
} from "lucide-react";
import { API, useAuth } from "../context/AuthContext";

/**
 * Floating In-App Beta Feedback drawer.
 * - A right-edge "Feedback" tab is visible on every authenticated page
 * - Opens a slide-in panel with sentiment (👍 😐 👎), category chips,
 *   free-text, and automatic page/user-agent capture
 * - Submissions kept in a 5-item recent list so the user sees what they've sent
 * - Listens to the legacy "open-feedback" custom event so the hamburger menu
 *   still works
 */

const RECENTS_KEY = "coilaegis_feedback_recent_v1";

const CATEGORIES = [
  { id: "bug",            label: "Bug",            Icon: Bug,          color: "#DC2626" },
  { id: "idea",           label: "Feature",        Icon: Lightbulb,    color: "#F59E0B" },
  { id: "field_incident", label: "Field incident", Icon: AlertOctagon, color: "#B91C1C" },
  { id: "ux",             label: "UX",             Icon: Sparkles,     color: "#06B6D4" },
  { id: "other",          label: "Other",          Icon: ClipboardList, color: "#6B7280" },
];

const SENTIMENTS = [
  { id: "positive", label: "Love it",   emoji: "👍" },
  { id: "neutral",  label: "It's ok",   emoji: "😐" },
  { id: "negative", label: "Painful",   emoji: "👎" },
];

const BetaFeedbackDrawer = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("bug");
  const [sentiment, setSentiment] = useState(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"); }
    catch { return []; }
  });
  const panelRef = useRef(null);

  // Legacy "open-feedback" event (from the hamburger menu) wires here too
  useEffect(() => {
    const h = () => setOpen(true);
    document.addEventListener("open-feedback", h);
    return () => document.removeEventListener("open-feedback", h);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", h), 50);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", h); };
  }, [open]);

  if (!user) return null;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!message.trim()) {
      toast.error("Tell us what happened — a sentence is plenty");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        category,
        subject: subject.trim() || `${CATEGORIES.find((c) => c.id === category)?.label || category} · ${new Date().toLocaleDateString()}`,
        message: message.trim(),
        page: location.pathname + location.search,
        sentiment,
        user_agent: `${navigator.userAgent}`.slice(0, 290),
      };
      const r = await axios.post(`${API}/feedback`, payload, { withCredentials: true });
      toast.success("Thanks — logged to the beta queue");
      const next = [{
        at: new Date().toISOString(),
        category, subject: payload.subject, message: payload.message,
        feedback_id: r.data?.feedback_id,
        sentiment,
      }, ...recents].slice(0, 5);
      setRecents(next);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch {}
      setMessage("");
      setSubject("");
      setSentiment(null);
      setCategory("bug");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  const chipColor = (id) => CATEGORIES.find((c) => c.id === id)?.color || "#6B7280";

  return (
    <>
      {/* Floating tab — hidden on login/share routes */}
      {!open && (
        <button
          data-testid="beta-feedback-tab"
          onClick={() => setOpen(true)}
          aria-label="Open beta feedback"
          className="fixed right-0 top-1/2 -translate-y-1/2 z-[55] bg-[#F59E0B] hover:bg-[#C36600] text-[#0F172A] font-bold shadow-lg flex items-center gap-1 origin-right"
          style={{
            writingMode: "vertical-rl",
            transform: "translateY(-50%) rotate(180deg)",
            padding: "10px 6px",
            borderTopLeftRadius: 6, borderBottomLeftRadius: 6,
            fontSize: 11, letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          <Flame className="w-3 h-3" />Beta feedback
        </button>
      )}

      {/* Drawer */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[55]" aria-hidden />
          <div
            data-testid="beta-feedback-drawer"
            ref={panelRef}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md z-[60] bg-[#0F172A] text-white shadow-2xl flex flex-col"
            style={{ boxShadow: "-20px 0 60px rgba(0,0,0,0.5)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div>
                <h2 className="text-base font-extrabold flex items-center gap-2">
                  <Flame className="w-4 h-4 text-[#F59E0B]" />Beta feedback
                </h2>
                <p className="text-[10px] text-white/50">Field hands, tool pushes, trainees — all input lands in the beta queue.</p>
              </div>
              <button data-testid="beta-feedback-close" onClick={() => setOpen(false)} className="text-white/60 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={submit} className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Sentiment */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">How did it feel?</label>
                <div className="mt-1.5 flex gap-1">
                  {SENTIMENTS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      data-testid={`beta-sentiment-${s.id}`}
                      onClick={() => setSentiment(sentiment === s.id ? null : s.id)}
                      className={`flex-1 py-2 rounded-lg border transition-all text-[11px] font-bold ${sentiment === s.id ? "bg-[#F59E0B] border-[#F59E0B] text-[#0F172A]" : "bg-white/5 border-white/10 hover:border-white/30"}`}
                    >
                      <span className="text-xl block leading-none">{s.emoji}</span>
                      <span className="mt-0.5 block">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Category chips */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">What is it?</label>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {CATEGORIES.map((c) => {
                    const active = category === c.id;
                    const Icon = c.Icon;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        data-testid={`beta-category-${c.id}`}
                        onClick={() => setCategory(c.id)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-full border flex items-center gap-1 transition-colors"
                        style={active
                          ? { background: c.color, borderColor: c.color, color: "#0F172A" }
                          : { background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.75)" }}
                      >
                        <Icon className="w-3 h-3" strokeWidth={2.6} />{c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">Subject (optional)</label>
                <input
                  data-testid="beta-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  placeholder='e.g. "Von Mises alarm stuck on"'
                  className="mt-1.5 w-full bg-black/40 border border-white/15 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#F59E0B]"
                />
              </div>

              {/* Message */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                  What happened? <span className="text-[#F59E0B]">*</span>
                </label>
                <textarea
                  data-testid="beta-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={5000}
                  placeholder="A sentence is plenty. Field incidents welcome — crew name + rig name + what happened."
                  className="mt-1.5 w-full bg-black/40 border border-white/15 rounded px-2.5 py-2 text-sm focus:outline-none focus:border-[#F59E0B] resize-none"
                  autoFocus
                />
                <p className="text-[10px] text-white/40 mt-1">
                  Auto-captured: page = <code className="text-[#F59E0B]">{location.pathname}</code>, user, browser.
                </p>
              </div>

              <button
                data-testid="beta-submit"
                type="submit"
                disabled={busy || !message.trim()}
                className="w-full flex items-center justify-center gap-2 bg-[#F59E0B] hover:bg-[#C36600] disabled:opacity-40 text-[#0F172A] font-bold py-2.5 rounded-lg text-sm"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {busy ? "Logging…" : "Send to beta queue"}
              </button>

              {/* Recents */}
              {recents.length > 0 && (
                <div className="border-t border-white/10 pt-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-2">
                    Your recent submissions
                  </p>
                  <ul className="space-y-1.5">
                    {recents.map((r, i) => (
                      <li
                        key={i}
                        data-testid={`beta-recent-${i}`}
                        className="bg-white/5 border border-white/10 rounded p-2 text-[11px]"
                      >
                        <div className="flex items-center gap-1 mb-0.5">
                          <span
                            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                            style={{ background: `${chipColor(r.category)}30`, color: chipColor(r.category) }}
                          >
                            {CATEGORIES.find((c) => c.id === r.category)?.label || r.category}
                          </span>
                          <span className="text-white/80 font-semibold truncate flex-1">{r.subject}</span>
                          <Check className="w-3 h-3 text-[#10B981] flex-shrink-0" />
                        </div>
                        <p className="text-white/60 line-clamp-2">{r.message}</p>
                        <p className="text-[9px] text-white/40 mt-0.5 tabular-nums">
                          {new Date(r.at).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </form>

            <div className="px-4 py-2 border-t border-white/10 text-[10px] text-white/40 text-center">
              CoilAegis is in Field Test Beta. Every item in the queue gets read. Thanks for shipping it with us.
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default BetaFeedbackDrawer;
