import React, { useEffect, useState } from "react";
import { X, Loader2, MessageSquarePlus, Send } from "lucide-react";
import axios from "axios";
import { API } from "../context/AuthContext";

const CATEGORIES = [
  { id: "bug", label: "Bug / Something's wrong" },
  { id: "idea", label: "Feature idea" },
  { id: "ux", label: "UI / UX suggestion" },
  { id: "data_accuracy", label: "Calculation / data accuracy" },
  { id: "other", label: "Other" },
];

/**
 * FeedbackDialog — modal listens for the global "open-feedback" custom event so any
 * Hub tile / footer button can trigger it without prop-drilling.
 * Props (open/onClose/page) are still supported for backward compat with any legacy callers.
 */
const FeedbackDialog = ({ open: propOpen, onClose: propOnClose, page: propPage }) => {
  const [selfOpen, setSelfOpen] = useState(false);
  const [selfPage, setSelfPage] = useState(null);
  const [category, setCategory] = useState("idea");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onOpen = (e) => {
      setSelfOpen(true);
      setSelfPage(e?.detail?.page || window.location.pathname);
      setSent(false);
      setError(null);
    };
    document.addEventListener("open-feedback", onOpen);
    return () => document.removeEventListener("open-feedback", onOpen);
  }, []);

  const isOpen = propOpen ?? selfOpen;
  const close = () => {
    setSelfOpen(false);
    setSent(false);
    setError(null);
    setSubject("");
    setMessage("");
    propOnClose && propOnClose();
  };
  const activePage = propPage || selfPage || window.location.pathname;

  if (!isOpen) return null;

  const submit = async () => {
    if (!subject.trim() || !message.trim()) return;
    setSending(true); setError(null);
    try {
      await axios.post(
        `${API}/feedback`,
        { category, subject: subject.trim(), message: message.trim(), page: activePage },
        { withCredentials: true }
      );
      setSent(true);
      setTimeout(close, 1600);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to send. Try again.");
    }
    setSending(false);
  };

  return (
    <div data-testid="feedback-dialog" className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={close}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#D4D4D4]">
          <h3 className="text-base font-bold text-[#262626] flex items-center gap-2">
            <MessageSquarePlus className="w-4 h-4 text-[#107C41]" /> Send Feedback
          </h3>
          <button data-testid="feedback-close" onClick={close} className="text-[#595959] hover:text-[#262626]"><X className="w-5 h-5" /></button>
        </div>
        {sent ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#E6F4EA] flex items-center justify-center mx-auto mb-3">
              <Send className="w-6 h-6 text-[#107C41]" strokeWidth={2.5} />
            </div>
            <p className="text-sm font-semibold text-[#262626]">Thanks! Feedback logged.</p>
            <p className="text-xs text-[#595959] mt-1">The team reviews every submission.</p>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#444] block mb-1">Category</label>
                <select
                  data-testid="feedback-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-[#FAFAFA] border border-[#CCC] px-3 py-2 rounded text-sm outline-none focus:border-[#107C41]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#444] block mb-1">Subject</label>
                <input
                  data-testid="feedback-subject"
                  type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
                  placeholder="Short summary"
                  className="w-full bg-[#FAFAFA] border border-[#CCC] px-3 py-2 rounded text-sm outline-none focus:border-[#107C41]"
                  maxLength={200}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#444] block mb-1">Message</label>
                <textarea
                  data-testid="feedback-message"
                  value={message} onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="What happened, what you'd like to see, or an idea to make the app better…"
                  className="w-full bg-[#FAFAFA] border border-[#CCC] px-3 py-2 rounded text-sm outline-none focus:border-[#107C41] resize-none"
                  maxLength={5000}
                />
              </div>
              {error && <p data-testid="feedback-error" className="text-xs text-[#C00000]">{error}</p>}
            </div>
            <div className="px-4 py-3 border-t border-[#D4D4D4] flex justify-end gap-2">
              <button onClick={close} className="border border-[#D4D4D4] text-[#444] px-4 py-2 rounded text-sm font-semibold">Cancel</button>
              <button
                data-testid="feedback-submit"
                onClick={submit}
                disabled={sending || !subject.trim() || !message.trim()}
                className="bg-[#107C41] hover:bg-[#0D6535] text-white px-4 py-2 rounded text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                {sending && <Loader2 className="w-4 h-4 animate-spin" />} Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FeedbackDialog;
