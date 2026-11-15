import React from "react";
import { fmtDateTime } from "../lib/timeFormat";

export default function LocalLogDrafts({ drafts, active, onUpload, onDiscard, uploading }) {
  if (!drafts.length) return null;
  return (
    <section className="job-card" aria-label="Unsent local log entries">
      <h2 className="font-bold">Unsent local entries ({drafts.length})</h2>
      <p className="job-muted">These are saved on this device, not in the shared rig log. Review the destination before uploading.</p>
      {drafts.map((draft) => <div key={draft.entry_id} className="border-t border-slate-600 py-3 mt-2">
        <p className="job-muted">{fmtDateTime(draft.event_at)} / {draft.sync_status === "uploaded" ? "Uploaded / local cleanup pending - do not retry" : draft.sync_status === "uncertain" ? "Delivery unconfirmed - review server log before retrying" : "Local only"}</p>
        <p className="whitespace-pre-wrap break-words">{draft.text}</p>
        <p className="job-muted">{draft.telemetry_snapshot?.source || "Manual entry"}</p>
        <button className="job-secondary mt-2" disabled={uploading || draft.sync_status === "uploaded" || !active || (draft.treatment_id && draft.treatment_id !== active.treatment_id)}
          onClick={() => onUpload(draft)}>{active ? `Review / upload to ${active.name}` : "Start a treatment online to upload"}</button>
        <button className="job-secondary mt-2" disabled={uploading} onClick={() => onDiscard(draft)}>Remove device draft</button>
      </div>)}
    </section>
  );
}
