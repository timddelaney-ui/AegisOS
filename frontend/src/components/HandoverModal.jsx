import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Copy, Check, Loader2, FileText, ClipboardCheck, Package, Wrench, ListChecks, Paperclip, Mail, Send, Users, Zap } from "lucide-react";
import { API } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";
import AttachmentUploader from "./AttachmentUploader";

// 24-hour military-time display across the handover.
import { fmtDateTime } from "../lib/timeFormat";
const fmt = (iso) => fmtDateTime(iso);

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

  // Crew chat is intentionally omitted — chat stays private to the active crew.
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
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [emailNote, setEmailNote] = useState("");
  const [sending, setSending] = useState(false);
  const [savedContacts, setSavedContacts] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState(new Set());
  const [showContacts, setShowContacts] = useState(false);
  const [sendingShiftEnd, setSendingShiftEnd] = useState(false);

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

  // Load saved crew contacts whenever the modal opens so the "Use crew" option is ready.
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/crew/contacts`, { withCredentials: true });
        const list = data.contacts || [];
        setSavedContacts(list);
        // Pre-select defaults
        const defaults = new Set(list.filter((c) => c.is_default_recipient).map((c) => c.contact_id));
        setSelectedContactIds(defaults);
      } catch { setSavedContacts([]); }
    })();
  }, [open]);

  // When the email panel is opened, auto-populate the recipients field from saved defaults.
  const loadSavedCrew = () => {
    const picked = savedContacts.filter((c) => selectedContactIds.has(c.contact_id));
    const emails = picked.map((c) => c.email);
    const existing = recipients.split(/[,;\s\n]+/).map((r) => r.trim()).filter(Boolean);
    const merged = Array.from(new Set([...existing, ...emails]));
    setRecipients(merged.join(", "));
    setShowContacts(false);
    toast.success(`Added ${emails.length} saved contact${emails.length === 1 ? "" : "s"}`);
  };

  const toggleContact = (cid) => {
    setSelectedContactIds((prev) => {
      const n = new Set(prev);
      if (n.has(cid)) n.delete(cid); else n.add(cid);
      return n;
    });
  };

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

  const sendEmail = async () => {
    const list = recipients
      .split(/[,;\s\n]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (!list.length) { toast.error("Enter at least one recipient email."); return; }
    if (list.length > 5) { toast.error("Max 5 recipients per send."); return; }
    setSending(true);
    try {
      const { data } = await axios.post(`${API}/crew/handover-email`, {
        rig_id: rigId,
        hours,
        recipients: list,
        body_text: text,
        note: emailNote || null,
      }, { withCredentials: true });
      toast.success(`Handover emailed to ${data.recipients.length} recipient${data.recipients.length === 1 ? "" : "s"}.`);
      setEmailOpen(false);
      setRecipients("");
      setEmailNote("");
    } catch (e) {
      const detail = e.response?.data?.detail;
      const status = e.response?.status;
      if (status === 503) toast.error("Email isn't configured yet — ask your admin to add a Resend API key.");
      else toast.error(detail || `Email send failed (HTTP ${status || "?"}).`);
    } finally { setSending(false); }
  };

  // One-click shift-end: auto-generate body server-side, send to default recipients
  const sendShiftEnd = async () => {
    const defaults = savedContacts.filter((c) => c.is_default_recipient);
    if (defaults.length === 0) {
      toast.error("No default-recipient crew contacts yet — add some first.");
      return;
    }
    const confirmMsg = `Send shift-end handover for ${rigLabel(rigId)} (last ${hours}h) to ${defaults.length} default recipient${defaults.length === 1 ? "" : "s"}?\n\n${defaults.map((c) => `• ${c.name} <${c.email}>`).join("\n")}`;
    if (!window.confirm(confirmMsg)) return;
    setSendingShiftEnd(true);
    try {
      const { data } = await axios.post(`${API}/crew/shift-end-handover`, {
        rig_id: rigId,
        hours,
        note: emailNote || null,
      }, { withCredentials: true });
      toast.success(`Shift-end emailed to ${data.recipients.length} recipient${data.recipients.length === 1 ? "" : "s"}`);
    } catch (e) {
      const detail = e.response?.data?.detail;
      const status = e.response?.status;
      if (status === 503) toast.error("Email isn't configured yet — ask your admin to add a Resend API key.");
      else toast.error(detail || `Shift-end send failed (HTTP ${status || "?"}).`);
    } finally { setSendingShiftEnd(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center sm:p-6 dialog-sheet" data-testid="handover-modal">
      <div className="bg-[#F7F7F7] w-full max-w-3xl max-h-[92dvh] rounded-t-2xl sm:rounded-lg shadow-2xl flex flex-col overflow-hidden dialog-sheet-panel">
        <div className="bg-[#FF6B1A] text-white px-4 py-3 flex items-center gap-2 flex-shrink-0">
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
            className="text-[11px] font-semibold text-[#FF6B1A] hover:underline disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              data-testid="handover-shift-end-send"
              onClick={sendShiftEnd}
              disabled={!summary || loading || sendingShiftEnd || savedContacts.filter((c) => c.is_default_recipient).length === 0}
              className="text-[12px] font-bold px-3 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-50 bg-[#C36600] hover:bg-[#A35600] text-white shadow-sm"
              title={savedContacts.filter((c) => c.is_default_recipient).length === 0 ? "Add default-recipient crew contacts first" : "Send a shift-end digest to all default-recipient contacts"}
            >
              {sendingShiftEnd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" strokeWidth={2.6} />}
              <span className="hidden sm:inline">Shift-end send</span>
              <span className="sm:hidden">Shift</span>
            </button>
            <button
              data-testid="handover-email-open"
              onClick={() => setEmailOpen((v) => !v)}
              disabled={!summary || loading}
              className={`text-[12px] font-bold px-3 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-50 ${emailOpen ? "bg-[#C44A08] text-white" : "border border-[#C44A08] text-[#C44A08] hover:bg-[#FFF7EF]"}`}
            >
              <Mail className="w-3.5 h-3.5" /> <span className="hidden xs:inline sm:inline">Email</span>
            </button>
            <button
              data-testid="handover-copy"
              onClick={copy}
              disabled={!summary || loading}
              className="text-[12px] font-bold text-white bg-[#FF6B1A] hover:bg-[#C44A08] px-3 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-50"
            >
              {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Copy to Clipboard</span><span className="sm:hidden">Copy</span></>}
            </button>
          </div>
        </div>

        {emailOpen && (
          <div className="px-3 py-2.5 bg-[#FFF7EF] border-b border-[#D1E7DD] space-y-2" data-testid="handover-email-panel">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Mail className="w-3.5 h-3.5 text-[#C44A08]" />
              <span className="text-[11px] font-bold text-[#C44A08] uppercase tracking-wide">Send handover by email</span>
              {savedContacts.length > 0 && (
                <button
                  data-testid="handover-use-saved-crew"
                  onClick={() => setShowContacts((v) => !v)}
                  className="ml-auto text-[11px] font-bold text-[#C44A08] inline-flex items-center gap-1 border border-[#C44A08] px-2 py-0.5 rounded hover:bg-[#FFF1E6]"
                >
                  <Users className="w-3 h-3" /> Use saved crew ({savedContacts.length})
                </button>
              )}
            </div>
            {showContacts && (
              <div className="bg-white border border-[#D1E7DD] rounded p-2 max-h-40 overflow-y-auto" data-testid="handover-contacts-picker">
                {savedContacts.map((c) => (
                  <label
                    key={c.contact_id}
                    data-testid={`handover-contact-${c.contact_id}`}
                    className="flex items-center gap-2 py-1 px-1 hover:bg-[#FFF7EF] rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedContactIds.has(c.contact_id)}
                      onChange={() => toggleContact(c.contact_id)}
                      className="w-3.5 h-3.5 accent-[#FF6B1A]"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-[#262626] truncate">
                        {c.name}
                        {c.is_default_recipient && <span className="ml-1.5 text-[9px] text-[#C44A08] font-bold">DEFAULT</span>}
                      </p>
                      <p className="text-[10px] text-[#595959] truncate">{c.email}{c.role ? ` · ${c.role}` : ""}</p>
                    </div>
                  </label>
                ))}
                <div className="flex justify-end pt-1 mt-1 border-t border-[#F0F0F0]">
                  <button
                    data-testid="handover-contacts-apply"
                    onClick={loadSavedCrew}
                    className="text-[11px] font-bold text-white bg-[#FF6B1A] hover:bg-[#C44A08] px-2 py-0.5 rounded"
                  >
                    Add {selectedContactIds.size} to recipients
                  </button>
                </div>
              </div>
            )}
            <textarea
              data-testid="handover-recipients"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              rows={2}
              placeholder="Recipient emails — comma, space, or newline separated (max 5)"
              className="w-full px-2 py-1.5 border border-[#CCC] rounded text-[13px] font-mono"
            />
            <input
              data-testid="handover-email-note"
              value={emailNote}
              onChange={(e) => setEmailNote(e.target.value)}
              placeholder="Cover note (optional)"
              className="w-full px-2 py-1.5 border border-[#CCC] rounded text-sm"
              maxLength={400}
            />
            <div className="flex items-center gap-2">
              <button
                data-testid="handover-email-send"
                onClick={sendEmail}
                disabled={sending || !recipients.trim() || !summary}
                className="text-[12px] font-bold text-white bg-[#C44A08] hover:bg-[#0A4F28] px-3 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-50 tap-44"
              >
                {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</> : <><Send className="w-3.5 h-3.5" /> Send email</>}
              </button>
              <span className="text-[10px] text-[#595959] italic">
                Shows your name in the From line · Reply-To is your account email.
              </span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-12 text-[13px] text-[#595959]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Building shift summary…
            </div>
          )}
          {error && <div className="bg-[#F8D7DA] border border-[#F5C6CB] text-[#721C24] rounded px-3 py-2 text-[12px]">{error}</div>}

          {summary && (
            <>
              <Section title="Completed tasks" Icon={ClipboardCheck} accent="#FF6B1A" count={summary.completed_tasks.length}>
                {summary.completed_tasks.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">No checklist activity in this window.</div>
                ) : (
                  <ul className="divide-y divide-[#F0F0F0]">
                    {summary.completed_tasks.map((t) => (
                      <li key={t.event_id} data-testid="handover-task" className="py-1.5 flex flex-wrap gap-x-2">
                        <span className="text-[10px] font-bold uppercase text-[#C44A08] mr-1">{t.tier}</span>
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
