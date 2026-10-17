import React, { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { Send, Loader2, MessageSquare, AlertOctagon, Sparkles } from "lucide-react";
import { API } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";
import AttachmentUploader from "./AttachmentUploader";

/**
 * CrewChat — polled, rig-scoped group chat for a team.
 * - Fetches every 3s filtered by active rig_id (legacy null messages included)
 * - Sends messages tagged with rig_id
 * - "hey skipper" triggers Gemini reply server-side
 */
const CrewChat = ({ currentUserId }) => {
  const { rigId, markSeen, refreshActivity } = useRig();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const lastTsRef = useRef(null);

  const fetchNew = useCallback(async () => {
    try {
      const params = { rig_id: rigId };
      if (lastTsRef.current) params.since = lastTsRef.current;
      const { data } = await axios.get(`${API}/crew/chat`, { params, withCredentials: true });
      const list = data?.messages || [];
      if (list.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.message_id));
          const merged = [...prev];
          for (const m of list) if (!seen.has(m.message_id)) merged.push(m);
          return merged;
        });
        lastTsRef.current = list[list.length - 1].created_at;
      }
    } catch (e) {
      // silent
    }
  }, [rigId]);

  // Reset when rig switches
  useEffect(() => {
    setMessages([]);
    lastTsRef.current = null;
    fetchNew();
    markSeen(rigId, "chat");
    const timer = setInterval(fetchNew, 3000);
    return () => clearInterval(timer);
  }, [rigId, fetchNew, markSeen]);

  // Mark chat as seen whenever new messages arrive while user is viewing this tab
  useEffect(() => {
    if (messages.length) markSeen(rigId, "chat");
  }, [messages.length, rigId, markSeen]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setError(null);
    try {
      await axios.post(`${API}/crew/chat`, { text, rig_id: rigId }, { withCredentials: true });
      await fetchNew();
      refreshActivity && refreshActivity();
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to send.");
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      data-testid="crew-chat"
      className="bg-white border border-[#D4D4D4] rounded-lg shadow-sm flex flex-col h-[70dvh] sm:h-[600px] overflow-hidden mt-4"
    >
      <div className="bg-[#0D6535] text-white px-3 py-2 flex items-center gap-2 flex-shrink-0">
        <MessageSquare className="w-4 h-4" strokeWidth={2.5} />
        <span className="text-sm font-bold">Crew Chat — {rigLabel(rigId)}</span>
        <span className="text-[9px] bg-white/20 px-1.5 py-[2px] rounded font-semibold ml-2">SKIPPER WATCHDOG ON</span>
      </div>

      <div className="px-3 py-2 bg-[#F0F9F3] border-b border-[#D4D4D4] text-[11px] text-[#0D6535] flex items-start gap-1.5 flex-shrink-0">
        <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
        <span>Type <strong>hey skipper</strong> to ping the AI hand. Every message is scoped to <strong>{rigLabel(rigId)}</strong>.</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#FAFAFA]">
        {messages.length === 0 && (
          <div className="text-center text-[12px] text-[#595959] py-8">
            No messages on {rigLabel(rigId)} yet. Start the shift with a "hey skipper" or share your first reading.
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender_user_id === currentUserId;
          // (Iter 23) Safety-alert messages are no longer visually highlighted —
          // they now render exactly like any other crew message to keep the chat clean.
          if (m.is_skipper) {
            return (
              <div key={m.message_id} className="bg-white border border-[#107C41]/40 rounded px-2.5 py-2 text-[12px] mr-6 shadow-sm">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#107C41] mb-1">
                  <Sparkles className="w-3 h-3" strokeWidth={2.5} /> {m.sender_name}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed text-[#262626]">{m.text}</div>
                <div className="text-[9px] text-[#595959] mt-1">{new Date(m.created_at).toLocaleString()}</div>
              </div>
            );
          }
          return (
            <div key={m.message_id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] px-2.5 py-1.5 rounded text-[12px] leading-relaxed whitespace-pre-wrap shadow-sm ${
                mine ? "bg-[#107C41] text-white" : "bg-white border border-[#D4D4D4] text-[#262626]"
              }`}>
                {!mine && <div className="text-[10px] font-bold mb-0.5 opacity-80">{m.sender_name}</div>}
                <div>{m.text}</div>
                <div className={`text-[9px] mt-0.5 ${mine ? "text-white/70" : "text-[#595959]"}`}>{new Date(m.created_at).toLocaleString()}</div>
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="px-3 py-1.5 bg-[#F8D7DA] border-t border-[#F5C6CB] text-[11px] text-[#721C24]">{error}</div>}

      <div className="border-t border-[#D4D4D4] p-2 flex flex-col gap-1.5 flex-shrink-0 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            data-testid="chat-input"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={`Message ${rigLabel(rigId)} crew or ask hey skipper…`}
            className="flex-1 bg-[#FAFAFA] border border-[#CCC] px-2.5 py-2 rounded text-sm outline-none focus:border-[#107C41] focus:ring-2 focus:ring-[#107C41]/10"
            disabled={sending}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            data-testid="chat-send-btn"
            className="bg-[#107C41] hover:bg-[#0D6535] text-white px-3 rounded disabled:opacity-50 flex items-center justify-center"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="border-t border-[#F0F0F0] pt-1.5">
          <AttachmentUploader context="chat" contextRef={rigId} />
        </div>
      </div>
    </div>
  );
};

export default CrewChat;
