import React, { useState, useRef, useEffect } from "react";
import { X, Send, Loader2, Sparkles, Brain, AlertOctagon, FileText, Wrench, MessageSquare, GraduationCap, ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import axios from "axios";
import { API, useAuth } from "../context/AuthContext";

const MODES = [
  { id: "assistant", label: "Field Assistant", Icon: MessageSquare, blurb: "Ask anything about the current sheet — pump rates, safe limits, procedures." },
  { id: "interpret", label: "Explain Results", Icon: Brain, blurb: "Plain-field interpretation of the calculated numbers, risks, and next steps." },
  { id: "sop_erp", label: "SOP / ERP", Icon: ShieldCheck, blurb: "Compliance-grade SOP + Safe-work + ERP guidance tied to this scenario — every answer cites API / AER / OH&S / CSA / IWCF." },
  { id: "troubleshoot", label: "Troubleshoot", Icon: Wrench, blurb: "Diagnose downhole scenarios (stuck pipe, kick, lost circulation) per industry SOPs." },
  { id: "training", label: "Training", Icon: GraduationCap, blurb: "New hand? Get plain-English explanations of what's happening downhole and why the numbers matter." },
  { id: "program", label: "Job Program", Icon: FileText, blurb: "Draft a step-by-step CT job procedure from the current parameters." },
  { id: "emergency", label: "Emergency", Icon: AlertOctagon, blurb: "Well-control and HSE emergency guidance per OH&S, AER, IWCF." },
];

// Parse assistant response into labelled sections.
// Supports the 2-section (ACTION NOW / WHY DETAILS) and 3-section
// (ACTION NOW / SOP CHECKLIST / ERP TRIGGERS & ESCALATION) formats.
const parseAiResponse = (raw) => {
  if (!raw || typeof raw !== "string") return { action: raw || "", sections: [] };
  const text = raw.replace(/\*\*/g, "");
  // Capture headers: ACTION NOW · WHY/DETAILS · SOP CHECKLIST · ERP TRIGGERS…
  const headerRegex = /(?:^|\n)\s*(ACTION\s*NOW|WHY\s*\/?\s*DETAILS|WHY\s*&\s*DETAILS|WHY|DETAILS|SOP\s*CHECKLIST|ERP\s*TRIGGERS(?:\s*&\s*ESCALATION)?)\s*:?\s*\n/gi;
  const matches = [...text.matchAll(headerRegex)];
  if (matches.length === 0) return { action: text.trim(), sections: [] };

  const chunks = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const label = m[1].toUpperCase().replace(/\s+/g, " ").trim();
    chunks.push({ label, body: text.slice(start, end).trim() });
  }
  // Action = whatever lives under ACTION NOW (or everything before first other header)
  const actionChunk = chunks.find((c) => c.label.startsWith("ACTION"));
  const action = actionChunk ? actionChunk.body : text.slice(0, matches[0].index).trim();
  const sections = chunks.filter((c) => !c.label.startsWith("ACTION"));
  return { action, sections };
};

const SECTION_META = {
  "WHY / DETAILS": { tone: "neutral", label: "WHY / DETAILS" },
  "WHY/DETAILS":   { tone: "neutral", label: "WHY / DETAILS" },
  "WHY & DETAILS": { tone: "neutral", label: "WHY / DETAILS" },
  "WHY":           { tone: "neutral", label: "WHY" },
  "DETAILS":       { tone: "neutral", label: "DETAILS" },
  "SOP CHECKLIST": { tone: "sop",     label: "SOP CHECKLIST" },
  "ERP TRIGGERS":  { tone: "erp",     label: "ERP TRIGGERS & ESCALATION" },
  "ERP TRIGGERS & ESCALATION": { tone: "erp", label: "ERP TRIGGERS & ESCALATION" },
};

const AIMessage = ({ content }) => {
  const [open, setOpen] = useState({});
  const { action, sections } = parseAiResponse(content);
  const toggle = (i) => setOpen((o) => ({ ...o, [i]: !o[i] }));
  return (
    <div className="bg-white border border-[#D4D4D4] text-[#262626] mr-6 shadow-sm rounded overflow-hidden" data-testid="ai-message-bubble">
      {action && (
        <div className="px-2.5 py-2">
          <div className="text-[10px] font-bold text-[#FF6B1A] tracking-wider mb-1">ACTION NOW</div>
          <div className="text-[12px] leading-relaxed whitespace-pre-wrap">{action}</div>
        </div>
      )}
      {sections.map((s, i) => {
        const meta = SECTION_META[s.label] || { tone: "neutral", label: s.label };
        const tone = meta.tone;
        const expanded = !!open[i];
        const btnBg = tone === "sop"
          ? "hover:bg-[#DBEAFE] text-[#0056B3] bg-[#F0F6FF]"
          : tone === "erp"
            ? "hover:bg-[#FEE2E2] text-[#8B0000] bg-[#FFF2F2]"
            : "hover:bg-[#FFF7EF] text-[#595959] bg-[#FAFAFA]";
        return (
          <div key={`${s.label}-${i}`} className="border-t border-[#EFEFEF]">
            <button
              onClick={() => toggle(i)}
              data-testid={`ai-section-toggle-${i}`}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] font-bold tracking-wider ${btnBg}`}
            >
              <span>{meta.label}</span>
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            {expanded && (
              <div className={`px-2.5 pb-2 pt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-[#333] ${tone === "sop" ? "bg-[#F0F6FF]/40" : tone === "erp" ? "bg-[#FFF2F2]/40" : "bg-[#FAFAFA]"}`}>
                {s.body}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

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
    // Sync mode when parent reopens the panel with a different shortcut
    // (e.g. clicking "Troubleshoot" after previously using "Assistant").
    if (open) setMode(initialMode);
  }, [initialMode, open]);

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
        { withCredentials: true, timeout: 45000 }
      );
      setSessionId(data.session_id);
      setMessages((m) => [...m, { role: "assistant", content: data.response }]);
    } catch (e) {
      const msg = e.code === "ECONNABORTED"
        ? "AI timed out after 45s. Skipper's ol' truck won't start — try again in a sec."
        : (e.response?.data?.detail || e.message || "AI error — try again.");
      setMessages((m) => [...m, { role: "assistant", content: msg, error: true }]);
    } finally {
      setSending(false);
    }
  };

  const currentMode = MODES.find((m) => m.id === mode) || MODES[0];
  const quickPrompts = {
    assistant: ["What's the safe pump rate here?", "Any red flags with these inputs?", "Explain the buoyancy calc"],
    interpret: ["Interpret these results"],
    sop_erp: [
      "Build the SOP + ERP for this scenario",
      "What are the pre-job compliance checks?",
      "ERP triggers and escalation if BHP goes above fracture pressure",
      "H2S handling SOP for this well",
      "Who do I call and when under AER Dir 019?",
      "Required PPE and competencies for this operation",
    ],
    troubleshoot: ["Stuck at TD, hoseline pressure dropped", "Losing returns, what next?", "Kick detected during POOH"],
    training: ["Walk me through what happens downhole", "What is WOB and why does it matter?", "Why does the friction go up with rate?", "What does 'tag bottom' mean?"],
    program: ["Draft the full job program from these inputs"],
    emergency: ["H2S alarm just triggered", "Uncontrolled descent — walk me through it", "BOP won't close"],
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 h-[100dvh] bg-black/40 z-50 flex items-end sm:items-center justify-end" onClick={onClose}>
      <div
        className="bg-white w-full sm:w-[440px] h-[85dvh] sm:h-[85vh] sm:mr-4 sm:mb-4 rounded-t-lg sm:rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#FF6B1A] text-white px-3 py-2.5 rounded-t-lg flex items-center justify-between flex-shrink-0">
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
                mode === id ? "bg-[#FF6B1A] text-white" : "bg-[#FFF7EF] text-[#C44A08] hover:bg-[#FFF1E6]"
              }`}
            >
              <Icon className="w-3 h-3" strokeWidth={2.5} />
              {label}
            </button>
          ))}
        </div>

        {/* Mode blurb */}
        <div className="px-3 py-2 bg-[#F8F9FA] border-b border-[#EFEFEF] flex items-start gap-2 flex-shrink-0">
          <currentMode.Icon className="w-3.5 h-3.5 text-[#FF6B1A] mt-0.5 flex-shrink-0" strokeWidth={2.5} />
          <p className="text-[11px] text-[#595959] leading-snug">{currentMode.blurb}</p>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#FAFAFA]">
          {messages.length === 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-[#595959] font-semibold mb-1">Quick prompts:</p>
              {(quickPrompts[mode] || []).map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="w-full text-left text-[12px] bg-white border border-[#D4D4D4] hover:border-[#FF6B1A] hover:bg-[#FFF7EF] rounded px-2.5 py-1.5 text-[#333]"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => {
            // Messages are append-only within a session; using role+index gives a stable enough
            // key without requiring an id from the server.
            const key = m.id || `${m.role}-${i}`;
            if (m.role === "assistant" && !m.error) {
              return <AIMessage key={key} content={m.content} />;
            }
            return (
              <div
                key={key}
                className={`px-2.5 py-2 rounded text-[12px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-[#FF6B1A] text-white ml-6 self-end"
                    : "bg-[#F8D7DA] border border-[#F5C6CB] text-[#721C24] mr-6"
                }`}
              >
                {m.content}
              </div>
            );
          })}
          {sending && (
            <div className="bg-white border border-[#D4D4D4] mr-6 rounded px-2.5 py-2 flex items-center gap-2 text-[12px] text-[#595959]">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FF6B1A]" /> Thinking…
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
            className="flex-1 bg-[#FAFAFA] border border-[#CCC] px-2.5 py-2 rounded text-sm outline-none focus:border-[#FF6B1A] focus:ring-2 focus:ring-[#FF6B1A]/10"
            disabled={sending}
          />
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="bg-[#FF6B1A] hover:bg-[#C44A08] text-white px-3 rounded disabled:opacity-50 flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
