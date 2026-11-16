import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { API } from "../context/AuthContext";

export default function AuditLedgerPage() {
  const [verify, setVerify] = useState(null);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [v, e] = await Promise.all([
        api.get(`${API}/approvals/audit/verify`),
        api.get(`${API}/approvals/audit`, { params: { limit: 100 } }).catch(() => ({ data: {} })),
      ]);
      setVerify(v.data);
      setEntries(e.data?.items || []);
    } catch (err) { setError(err.response?.status === 403 ? "Access restricted to Management" : "Could not load the audit ledger"); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const ok = verify?.valid ?? verify?.ok;
  return (
    <div className="mx-auto max-w-4xl p-4" data-testid="audit-page">
      <h1 className="mb-2 text-xl font-bold">Audit Ledger</h1>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {verify && <p data-testid="audit-chain-status" className={`mb-3 text-sm font-semibold ${ok ? "text-green-600" : "text-red-600"}`}>{ok ? `Hash chain verified (${verify.entries} entries)` : `Hash chain verification FAILED at seq ${verify.broken_at_seq}: ${verify.reason}`}</p>}
      <button type="button" onClick={load} className="mb-3 rounded border border-slate-500 px-2 py-1 text-xs font-semibold">Re-verify</button>
      <table className="w-full text-left text-xs">
        <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Hash</th></tr></thead>
        <tbody>{entries.map((e) => (
          <tr key={e.id || e.seq} className="border-t border-slate-200">
            <td>{e.seq}</td><td>{e.ts}</td><td>{e.actor_email || e.actor_user_id}</td><td>{e.action}</td><td>{e.target}</td><td title={e.entry_hash}>{(e.entry_hash || "").slice(0, 10)}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}
