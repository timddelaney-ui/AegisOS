import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { X, Copy, Check, Loader2, FileText, ClipboardCheck, Package, Wrench, ListChecks, MessageSquare, Paperclip } from "lucide-react";
import { API } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";
import AttachmentUploader from "./AttachmentUploader";

const fmt = (iso) => {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

const buildText = (rigLabelStr, s) => {
  if (!s) return "";
  const lines = [];
  lines.push(`HANDOVER SUMMARY — ${rigLabelStr}`);
  lines.push(`Window: last ${s.hours} hours`);
  lines.push(`Generated: ${fmt(s.generated_at)} by ${s.generated_by}`);
  lines.push("");

  lines.push(`COMPLETED TASKS (${s.completed_tasks.length})`);
  if (s.completed_tasks.length === 0) lines.push("  — none");
  for (const t of s.completed_tasks) {
    lines.push(`  • [${(t.tier || "").toUpperCase()}] ${t.item_label} — ${t.user_name} @ ${fmt(t.created_at)}`);
  }
  lines.push("");

  lines.push(`INVENTORY / CONSUMABLES FLAGS (${s.inventory_flags.length})`);
  if (s.inventory_flags.length === 0) lines.push("  — all green");
  for (const it of s.inventory_flags) {
    lines.push(`  • [${it.status}] ${it.name}${it.quantity != null ? ` — ${it.quantity} ${it.unit || ""}`.trimEnd() : ""}${it.location ? ` @ ${it.location}` : ""}`);
  }
  lines.push("");

  lines.push(`OPEN PARTS ORDERS (${s.parts_open.length})`);
  if (s.parts_open.length === 0) lines.push("  — none");
  for (const it of s.parts_open) {
    lines.push(`  • [${it.status}] ${it.name}${it.quantity != null ? ` × ${it.quantity} ${it.unit || ""}`.trimEnd() : ""}${it.note ? ` — ${it.note}` : ""}`);
  }
  lines.push("");

  lines.push(`OPEN TO-DOS (${s.todos_open.length})`);
  if (s.todos_open.length === 0) lines.push("  — none");
  for (const it of s.todos_open) {
    lines.push(`  • [${it.priority || "MED"}] ${it.name}${it.location ? ` @ ${it.location}` : ""}${it.note ? ` — ${it.note}` : ""}`);
  }
  lines.push("");

  lines.push(`CHAT NOTES (${s.chat_notes.length})`);
  if (s.chat_notes.length === 0) lines.push("  — quiet shift");
  for (const c of s.chat_notes.slice().reverse()) {
    lines.push(`  • ${fmt(c.created_at)} ${c.sender_name}: ${c.text.replace(/\n/g, " ")}`);
  }
  lines.push("");
  lines.push("— End of handover —");
  return lines.join("\n");
};

const Section = ({ title, Icon, accent, count, children }) => (
  <div className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
    <div className="px-3 py-2 flex items-center gap-2 border-b border-[#E5E7EB]" style={{ background: `${accent}10` }}>
      <Icon className="w-4 h-4" style={{ color: accent }} strokeWidth={2.5} />
      <span className="text-[13px] font-bold" style={{ color: accent }}>{title}</span>
      <span className="text-[10px] font-bold text-white px-1.5 py-[1px] rounded-full ml-auto" style={{ background: accent }}>{count}</span>
    </div>
    <div className="p-2 text-[12px]">{children}</div>
  </div>
);

const HandoverModal = ({ open, onClose }) => {
  const { rigId } = useRig();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [hours, setHours] = useState(12);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setSummary(null); setCopied(false);
    try {
      const { data } = await axios.get(`${API}/crew/handover-summary`, { params: { rig_id: rigId, hours }, withCredentials: true });
      setSummary(data);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to build summary. Join a team first.");
    } finally {
      setLoading(false);
    }
  }, [rigId, hours]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const text = useMemo(() => buildText(rigLabel(rigId), summary), [rigId, summary]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {}
      document.body.removeChild(ta);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center sm:p-6 dialog-sheet" data-testid="handover-modal">
      <div className="bg-[#F7F7F7] w-full max-w-3xl max-h-[92dvh] rounded-t-2xl sm:rounded-lg shadow-2xl flex flex-col overflow-hidden dialog-sheet-panel">
        <div className="bg-[#107C41] text-white px-4 py-3 flex items-center gap-2 flex-shrink-0">
          <FileText className="w-5 h-5" strokeWidth={2.5} />
          <div className="flex-1">
            <div className="text-sm font-bold">Handover Summary — {rigLabel(rigId)}</div>
            <div className="text-[10px] text-white/80">Shift-change report. Copy to clipboard for the incoming tool push.</div>
          </div>
          <button data-testid="handover-close" onClick={onClose} className="text-white/80 hover:text-white p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-4 py-2 bg-white border-b border-[#E5E7EB] flex items-center gap-3 flex-wrap">
          <label className="text-[11px] font-semibold text-[#444]">Window:</label>
          <select
            data-testid="handover-hours"
            value={hours}
            onChange={(e) => setHours(parseInt(e.target.value, 10))}
            className="text-[11px] border border-[#CCC] rounded px-2 py-1"
          >
            <option value={6}>last 6 h</option>
            <option value={12}>last 12 h (shift)</option>
            <option value={24}>last 24 h</option>
            <option value={48}>last 48 h</option>
            <option value={168}>last 7 days</option>
          </select>
          <button
            data-testid="handover-refresh"
            onClick={load}
            disabled={loading}
            className="text-[11px] font-semibold text-[#107C41] hover:underline disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              data-testid="handover-copy"
              onClick={copy}
              disabled={!summary || loading}
              className="text-[12px] font-bold text-white bg-[#107C41] hover:bg-[#0D6535] px-3 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-50"
            >
              {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy to Clipboard</>}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-12 text-[13px] text-[#595959]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Building shift summary…
            </div>
          )}
          {error && <div className="bg-[#F8D7DA] border border-[#F5C6CB] text-[#721C24] rounded px-3 py-2 text-[12px]">{error}</div>}

          {summary && (
            <>
              <Section title="Completed tasks" Icon={ClipboardCheck} accent="#107C41" count={summary.completed_tasks.length}>
                {summary.completed_tasks.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">No checklist activity in this window.</div>
                ) : (
                  <ul className="divide-y divide-[#F0F0F0]">
                    {summary.completed_tasks.map((t) => (
                      <li key={t.event_id} data-testid="handover-task" className="py-1.5 flex flex-wrap gap-x-2">
                        <span className="text-[10px] font-bold uppercase text-[#0D6535] mr-1">{t.tier}</span>
                        <span className="font-medium text-[#262626]">{t.item_label}</span>
                        <span className="text-[#595959] text-[11px] ml-auto">{t.user_name} • {fmt(t.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Inventory / consumables flags" Icon={Package} accent="#856404" count={summary.inventory_flags.length}>
                {summary.inventory_flags.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">All green.</div>
                ) : (
                  <ul className="divide-y divide-[#F0F0F0]">
                    {summary.inventory_flags.map((it) => (
                      <li key={it.item_id} className="py-1.5 flex flex-wrap gap-x-2">
                        <span className="text-[10px] font-bold uppercase" style={{ color: it.status === "OOS" ? "#C00000" : "#856404" }}>{it.status}</span>
                        <span className="font-medium">{it.name}</span>
                        {it.quantity != null && <span className="text-[#595959]">{it.quantity} {it.unit || ""}</span>}
                        {it.location && <span className="text-[#595959] text-[11px]">@ {it.location}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Open parts orders" Icon={Wrench} accent="#C36600" count={summary.parts_open.length}>
                {summary.parts_open.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">No open orders.</div>
                ) : (
                  <ul className="divide-y divide-[#F0F0F0]">
                    {summary.parts_open.map((it) => (
                      <li key={it.item_id} className="py-1.5">
                        <span className="text-[10px] font-bold uppercase text-[#C36600] mr-1">{it.status}</span>
                        <span className="font-medium">{it.name}</span>
                        {it.quantity != null && <span className="text-[#595959]"> × {it.quantity} {it.unit || ""}</span>}
                        {it.note && <div className="text-[11px] text-[#595959] italic">{it.note}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Open to-dos" Icon={ListChecks} accent="#0056B3" count={summary.todos_open.length}>
                {summary.todos_open.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">Board is clean.</div>
                ) : (
                  <ul className="divide-y divide-[#F0F0F0]">
                    {summary.todos_open.map((it) => (
                      <li key={it.item_id} className="py-1.5">
                        <span className="text-[10px] font-bold uppercase mr-1" style={{ color: it.priority === "HIGH" ? "#C00000" : it.priority === "MED" ? "#856404" : "#595959" }}>
                          {it.priority || "MED"}
                        </span>
                        <span className="font-medium">{it.name}</span>
                        {it.location && <span className="text-[11px] text-[#595959]"> @ {it.location}</span>}
                        {it.note && <div className="text-[11px] text-[#595959] italic">{it.note}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Chat notes" Icon={MessageSquare} accent="#0D6535" count={summary.chat_notes.length}>
                {summary.chat_notes.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">Quiet shift.</div>
                ) : (
                  <ul className="divide-y divide-[#F0F0F0]">
                    {summary.chat_notes.slice().reverse().map((c) => (
                      <li key={c.message_id} className="py-1.5">
                        <div className="text-[11px]"><span className="font-bold">{c.sender_name}</span> <span className="text-[#8A8A8A]">• {fmt(c.created_at)}</span></div>
                        <div className="text-[12px] whitespace-pre-wrap text-[#262626]">{c.text}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Handover attachments" Icon={Paperclip} accent="#7C3AED" count={0}>
                <div className="text-[10px] text-[#595959] mb-1">Photos, cert docs, tickets attached to this rig's handover.</div>
                <AttachmentUploader context="handover" contextRef={rigId} />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default HandoverModal;
