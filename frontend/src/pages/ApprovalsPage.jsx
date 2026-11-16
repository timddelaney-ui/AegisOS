import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../api/client";
import { API, useAuth } from "../context/AuthContext";
import { canView } from "../lib/roles";
import { useOfflineQueue } from "../utils/offlineQueue";
import { parseNumericInput } from "../lib/inputSafety";

const KINDS = [["parts_request", "Parts"], ["consumable", "Consumables"], ["inventory_update", "Inventory"]];
const KIND_LABEL = Object.fromEntries(KINDS);
const btn = "rounded border border-slate-500 px-2 py-1 text-xs font-semibold";

function Section({ title, testid, children }) {
  return (
    <section data-testid={testid} className="mb-6 rounded-lg border border-slate-300 bg-white p-4">
      <h2 className="mb-3 text-base font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function ApprovalsPage() {
  const { user } = useAuth();
  const { pending, enqueue } = useOfflineQueue();
  const [form, setForm] = useState({ kind: "parts_request", title: "", details: "", quantity: "1" });
  const [requests, setRequests] = useState([]);
  const [docs, setDocs] = useState([]);
  const [reason, setReason] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [escalateTo, setEscalateTo] = useState("pending_po");
  const [busy, setBusy] = useState(false);
  const isQueue = canView(user, "approval_queue");
  const isPo = canView(user, "po_signoff");

  const load = useCallback(async () => {
    try { const { data } = await api.get(`${API}/approvals/requests`); setRequests(data?.items || []); }
    catch (e) { console.debug("[Approvals] requests", e?.response?.status); }
    try {
      const { data } = await api.get(`${API}/documents`);
      const base = (data?.documents || []).slice(0, 50);
      const states = await Promise.allSettled(base.map((d) => api.get(`${API}/approvals/documents/${d.doc_id}`)));
      setDocs(base.map((d, i) => ({ ...d, approval_status: states[i].status === "fulfilled" ? states[i].value.data?.status : "draft" })));
    } catch (e) { console.debug("[Approvals] documents", e?.response?.status); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    const qty = parseNumericInput(form.quantity);
    if (!form.title.trim() || qty.error || qty.empty || qty.value <= 0) { toast.error("Enter a title and a quantity above zero"); return; }
    const payload = { kind: form.kind, title: form.title.trim(), details: form.details.trim() || undefined, quantity: qty.value };
    setBusy(true);
    try {
      await api.post(`${API}/approvals/requests`, payload);
      toast.success("Request submitted");
      setForm({ ...form, title: "", details: "", quantity: "1" });
      load();
    } catch (e) {
      if (!e.response) { await enqueue("parts_request", payload); toast.info("Offline: request queued and will sync automatically"); }
      else if (e.response.status !== 403) toast.error(e.response?.data?.detail || "Could not submit request");
    } finally { setBusy(false); }
  };

  const act = async (path, body, label) => {
    try { await api.post(`${API}${path}`, body); toast.success(label); setReason(""); load(); }
    catch (e) { if (e.response?.status !== 403) toast.error(e.response?.data?.detail || "Action failed"); }
  };

  const supervisorDecide = (r, decision, escalate) => act(`/approvals/requests/${r.request_id}/supervisor-decision`,
    { decision, escalate_to: escalate || escalateTo, reason: reason || undefined }, decision === "approve" ? "Request approved" : "Request rejected");
  const managementDecide = (r, decision) => act(`/approvals/requests/${r.request_id}/management-decision`,
    { decision, po_number: poNumber || undefined, reason: reason || undefined }, decision === "approve" ? "PO signed off" : "Request rejected");
  const docAct = (d, action, label) => act(`/approvals/documents/${d.doc_id}/${action}`, action === "reject" ? { reason: reason || undefined } : {}, label);

  const queue = requests.filter((r) => r.status === "pending_supervisor");
  const poQueue = requests.filter((r) => ["pending_po", "pending_management"].includes(r.status));
  const mine = requests.filter((r) => r.created_by_user_id === user?.user_id);

  return (
    <div className="mx-auto max-w-4xl p-4" data-testid="approvals-page">
      <h1 className="mb-1 text-xl font-bold">Approvals &amp; Company Docs</h1>
      {pending > 0 && <p className="mb-2 text-xs text-amber-600">{pending} item(s) waiting to sync</p>}
      <Section title="Request parts / consumables / inventory" testid="approvals-request-form">
        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-4">
          <select aria-label="Request type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input aria-label="Title" placeholder="Item / part number" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="sm:col-span-2" />
          <input aria-label="Quantity" inputMode="decimal" placeholder="Qty" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <textarea aria-label="Details" placeholder="Details" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} className="sm:col-span-3" />
          <button type="submit" disabled={busy} className="rounded bg-[#FF6B1A] px-3 py-2 font-semibold text-white disabled:opacity-50">Submit request</button>
        </form>
        {mine.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm" data-testid="approvals-mine">
            {mine.map((r) => <li key={r.request_id}>{KIND_LABEL[r.kind] || r.kind}: {r.title} × {r.quantity ?? 1} — <em>{r.status}</em></li>)}
          </ul>
        )}
      </Section>
      {(isQueue || isPo) && (
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <input aria-label="Decision reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {isQueue && (
            <select aria-label="Escalate approved requests to" value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)}>
              <option value="pending_po">Approve → PO stage</option>
              <option value="pending_management">Approve → Management</option>
            </select>
          )}
          {isPo && <input aria-label="PO number" placeholder="PO number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />}
        </div>
      )}
      {isQueue && (
        <Section title="Supervisor approval queue" testid="approvals-queue">
          {queue.length === 0 ? <p className="text-sm text-slate-500">No requests awaiting supervisor review.</p> : queue.map((r) => (
            <div key={r.request_id} className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-2 text-sm">
              <span className="flex-1">{KIND_LABEL[r.kind] || r.kind}: {r.title} × {r.quantity ?? 1}</span>
              <button type="button" className={btn} onClick={() => supervisorDecide(r, "approve")}>Approve</button>
              <button type="button" className={btn} onClick={() => supervisorDecide(r, "approve", "pending_management")}>Escalate</button>
              <button type="button" className={btn} onClick={() => supervisorDecide(r, "reject")}>Reject</button>
            </div>
          ))}
        </Section>
      )}
      {isPo && (
        <Section title="Management PO sign-off" testid="approvals-po">
          {poQueue.length === 0 ? <p className="text-sm text-slate-500">Nothing awaiting sign-off.</p> : poQueue.map((r) => (
            <div key={r.request_id} className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-2 text-sm">
              <span className="flex-1">{KIND_LABEL[r.kind] || r.kind}: {r.title} × {r.quantity ?? 1} <em>({r.status})</em></span>
              <button type="button" className={btn} onClick={() => managementDecide(r, "approve")}>Sign off</button>
              <button type="button" className={btn} onClick={() => managementDecide(r, "reject")}>Reject</button>
            </div>
          ))}
        </Section>
      )}
      <Section title="Company documents" testid="approvals-docs">
        {docs.length === 0 ? <p className="text-sm text-slate-500">No company documents.</p> : (
          <ul className="space-y-1 text-sm">{docs.map((d) => {
            const st = d.approval_status;
            return (
              <li key={d.doc_id} className="flex flex-wrap items-center gap-2">
                <span className="flex-1">{d.name || d.filename} <em className="text-slate-500">({st})</em></span>
                {canView(user, "company_docs_upload") && ["draft", "rejected"].includes(st) && <button type="button" className={btn} onClick={() => docAct(d, "submit", "Submitted for approval")}>Submit</button>}
                {isQueue && st === "pending_supervisor" && <button type="button" className={btn} onClick={() => docAct(d, "approve", "Approved")}>Approve</button>}
                {isPo && st === "pending_management" && <button type="button" className={btn} onClick={() => docAct(d, "final-approve", "Final approval recorded")}>Final approve</button>}
                {isQueue && ["pending_supervisor", "pending_management"].includes(st) && <button type="button" className={btn} onClick={() => docAct(d, "reject", "Rejected")}>Reject</button>}
              </li>
            );
          })}</ul>
        )}
        {canView(user, "company_docs_upload") && <Link to="/documents" className="mt-2 inline-block text-sm font-semibold text-[#FF6B1A]">Upload company documents →</Link>}
      </Section>
    </div>
  );
}
