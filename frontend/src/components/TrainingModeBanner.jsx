import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useLocation } from "react-router-dom";
import { GraduationCap, Sparkles, X, Send, Loader2, HelpCircle } from "lucide-react";
import { API } from "../context/AuthContext";

const WHAT_IF_PRESETS = [
  "What happens if wellhead pressure jumps 500 psi?",
  "Explain the Von Mises envelope — why is 80 % the limit?",
  "If skate pressure doubles, how fast does fatigue accumulate?",
  "Walk me through a standpipe-pressure spike response per API RP 5C7.",
];

/**
 * Training Simulation banner + AI assistant panel.
 * Appears whenever the URL carries `?training=1` (set by share-link redirect
 * when the owner picked Training mode) OR when the user clicks the help bubble.
 * Produces a clear READ-ONLY banner so trainees never confuse their session
 * with a live-rig view.
 */
const TrainingModeBanner = () => {
  const location = useLocation();
  const isTraining = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("training") === "1";
  }, [location.search]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "You're in TRAINING SIMULATION mode — the data on screen is read-only. Ask me anything about CoilAegis, API RP 5C7, fatigue, SOPs, or run a what-if." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isTraining) return null;

  const ask = async (prompt) => {
    const q = (prompt || input).trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const r = await axios.post(`${API}/ai/chat`, {
        mode: "field_chat",
        prompt: `${q}\n\n[Context: user is in CoilAegis Training Simulation share link, read-only.]`,
      }, { withCredentials: true });
      const text = r.data?.answer || r.data?.response || "No reply.";
      setMessages((m) => [...m, { role: "assistant", text }]);
    } catch (e) {
      toast.error(e.response?.data?.detail || "AI failed");
      setMessages((m) => [...m, { role: "assistant", text: "⚠ The assistant isn't reachable right now — try again in a moment." }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      {/* Sticky banner */}
      <div
        data-testid="training-banner"
        className="sticky top-0 z-[55] bg-[#FEF3C7] text-[#92400E] border-b-2 border-[#F59E0B] text-center py-1.5 px-3 font-bold text-[11px] uppercase tracking-wider flex items-center justify-center gap-2"
      >
        <GraduationCap className="w-3.5 h-3.5" strokeWidth={2.8} />
        Training Simulation · Read-only field data
        <button
          data-testid="training-ai-open"
          onClick={() => setPanelOpen(true)}
          className="ml-2 bg-[#F59E0B] text-white px-2 py-0.5 rounded flex items-center gap-1 hover:bg-[#C36600] normal-case tracking-normal"
        >
          <Sparkles className="w-3 h-3" />Ask AI
        </button>
      </div>

      {/* Floating AI panel */}
      {panelOpen && (
        <div
          data-testid="training-ai-panel"
          className="fixed bottom-4 right-4 z-[60] w-full max-w-sm bg-[#0D1A24] text-white border border-[#FF6B1A]/40 rounded-lg shadow-2xl flex flex-col max-h-[75vh]"
          style={{ boxShadow: "0 25px 80px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,107,26,0.25)" }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
              <GraduationCap className="w-4 h-4 text-[#FF6B1A]" />Training AI · What-if
            </span>
            <button data-testid="training-ai-close" onClick={() => setPanelOpen(false)} className="text-white/60 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs">
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}-${m.text?.slice(0, 24) || ""}`}
                className={m.role === "user"
                  ? "bg-[#FF6B1A] text-white rounded-lg px-3 py-2 ml-6 self-end"
                  : "bg-white/5 border border-white/10 rounded-lg px-3 py-2 mr-6"}
              >
                {m.text}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-1.5 text-white/60 text-[11px]"><Loader2 className="w-3 h-3 animate-spin" />Thinking…</div>
            )}
          </div>
          <div className="border-t border-white/10 p-2 space-y-1.5">
            <div className="flex flex-wrap gap-1">
              {WHAT_IF_PRESETS.map((p) => (
                <button
                  key={`preset-${p}`}
                  data-testid={`training-preset-${p.slice(0, 24).replace(/\s+/g, "-")}`}
                  disabled={busy}
                  onClick={() => ask(p)}
                  className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 hover:bg-white/10 flex items-center gap-0.5 disabled:opacity-40"
                >
                  <HelpCircle className="w-2.5 h-2.5" />{p.slice(0, 32)}…
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); ask(); }}
              className="flex gap-1"
            >
              <input
                data-testid="training-ai-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a what-if…"
                className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-xs focus:outline-none focus:border-[#FF6B1A]"
                disabled={busy}
              />
              <button
                type="submit"
                data-testid="training-ai-send"
                disabled={busy || !input.trim()}
                className="bg-[#FF6B1A] hover:bg-[#C44A08] text-white px-2 rounded disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default TrainingModeBanner;
