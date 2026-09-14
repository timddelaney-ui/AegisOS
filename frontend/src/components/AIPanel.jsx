import React, { useState, useRef, useEffect } from "react";
import { X, Send, Loader2, Sparkles, Brain, AlertOctagon, FileText, Wrench, MessageSquare, GraduationCap } from "lucide-react";
import axios from "axios";
import { API, useAuth } from "../context/AuthContext";

const MODES = [
  { id: "assistant", label: "Field Assistant", Icon: MessageSquare, blurb: "Ask anything about the current sheet — pump rates, safe limits, procedures." },
  { id: "interpret", label: "Explain Results", Icon: Brain, blurb: "Plain-field interpretation of the calculated numbers, risks, and next steps." },
  { id: "troubleshoot", label: "Troubleshoot", Icon: Wrench, blurb: "Diagnose downhole scenarios (stuck pipe, kick, lost circulation) per industry SOPs." },
  { id: "training", label: "Training", Icon: GraduationCap, blurb: "New hand? Get plain-English explanations of what's happening downhole and why the numbers matter." },
  { id: "program", label: "Job Program", Icon: FileText, blurb: "Draft a step-by-step CT job procedure from the current parameters." },
  { id: "emergency", label: "Emergency", Icon: AlertOctagon, blurb: "Well-control and HSE emergency guidance per OH&S, AER, IWCF." },
];

const AIPanel = ({ open, onClose, contextBuilder, initialMode = "assistant" }) => {
  const { user } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    // reset conversation when mode changes
    setMessages([]);
    setSessionId(null);
  }, [mode]);

  const send = async (overrideText) => {
    const text = overrideText || input.trim();
    if (!text || sending) return;
    setInput("");
    const context = contextBuilder ? contextBuilder() : null;
    const newUserMsg = { role: "user", content: text };
    setMessages((m) => [...m, newUserMsg]);
    setSending(true);
    try {
      const { data } = await axios.post(
        `${API}/ai/chat`,
        { mode, message: text, session_id: sessionId, context },
        { withCredentials: true }
      );
      setSessionId(data.session_id);
      setMessages((m) => [...m, { role: "assistant", content: data.response }]);
    } catch (e) {
      const msg = e.response?.data?.detail || "AI error — try again.";
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${msg}`, error: true }]);
    } finally {
      setSending(false);
    }
  };

  const currentMode = MODES.find((m) => m.id === mode) || MODES[0];
  const quickPrompts = {
    assistant: ["What's the safe pump rate here?", "Any red flags with these inputs?", "Explain the buoyancy calc"],
    interpret: ["Interpret these results"],
    troubleshoot: ["Stuck at TD, hoseline pressure dropped", "Losing returns, what next?", "Kick detected during POOH"],
    training: ["Walk me through what happens downhole", "What is WOB and why does it matter?", "Why does the friction go up with rate?", "What does 'tag bottom' mean?"],
    program: ["Draft the full job program from these inputs"],
    emergency: ["H2S alarm just triggered", "Uncontrolled descent — walk me through it", "BOP won't close"],
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-end" onClick={onClose}>
      <div
        className="bg-white w-full sm:w-[440px] h-[85vh] sm:h-[85vh] sm:mr-4 sm:mb-4 rounded-t-lg sm:rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#107C41] text-white px-3 py-2.5 rounded-t-lg flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" strokeWidth={2.5} />
            <span className="text-sm font-bold">CT Field AI</span>
            <span className="text-[9px] bg-white/20 px-1.5 py-[2px] rounded font-semibold">GEMINI 2.5 FLASH</span>
          </div>
          <button onClick={onClose} className="hover:bg-white/10 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>

        {/* Mode tabs */}
        <div className="border-b border-[#D4D4D4] px-2 py-1.5 flex gap-1 overflow-x-auto flex-shrink-0">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold whitespace-nowrap ${
                mode === id ? "bg-[#107C41] text-white" : "bg-[#F0F9F3] text-[#0D6535] hover:bg-[#E6F4EA]"
              }`}
            >
              <Icon className="w-3 h-3" strokeWidth={2.5} />
              {label}
            </button>
          ))}
        </div>

        {/* Mode blurb */}
        <div className="px-3 py-2 bg-[#F8F9FA] border-b border-[#EFEFEF] flex items-start gap-2 flex-shrink-0">
          <currentMode.Icon className="w-3.5 h-3.5 text-[#107C41] mt-0.5 flex-shrink-0" strokeWidth={2.5} />
          <p className="text-[11px] text-[#595959] leading-snug">{currentMode.blurb}</p>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#FAFAFA]">
          {messages.length === 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-[#595959] font-semibold mb-1">Quick prompts:</p>
              {(quickPrompts[mode] || []).map((q, i) => (
                <button
                  key={i}
                  onClick={() => send(q)}
                  className="w-full text-left text-[12px] bg-white border border-[#D4D4D4] hover:border-[#107C41] hover:bg-[#F0F9F3] rounded px-2.5 py-1.5 text-[#333]"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`px-2.5 py-2 rounded text-[12px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-[#107C41] text-white ml-6 self-end"
                  : m.error
                  ? "bg-[#F8D7DA] border border-[#F5C6CB] text-[#721C24] mr-6"
                  : "bg-white border border-[#D4D4D4] text-[#262626] mr-6 shadow-sm"
              }`}
            >
              {m.content}
            </div>
          ))}
          {sending && (
            <div className="bg-white border border-[#D4D4D4] mr-6 rounded px-2.5 py-2 flex items-center gap-2 text-[12px] text-[#595959]">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#107C41]" /> Thinking…
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-[#D4D4D4] p-2 flex gap-2 flex-shrink-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask the AI anything about this operation…"
            className="flex-1 bg-[#FAFAFA] border border-[#CCC] px-2.5 py-2 rounded text-sm outline-none focus:border-[#107C41] focus:ring-2 focus:ring-[#107C41]/10"
            disabled={sending}
          />
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="bg-[#107C41] hover:bg-[#0D6535] text-white px-3 rounded disabled:opacity-50 flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
