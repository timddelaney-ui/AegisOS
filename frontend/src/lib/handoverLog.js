import axios from "axios";
import { API } from "../context/AuthContext";
import { fmtDateTime } from "./timeFormat";

export async function loadHandoverLog(rigId, hours) {
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const { data } = await axios.get(`${API}/treatments`, { params: { rig_id: rigId }, withCredentials: true });
  const treatments = (data.treatments || []).filter((treatment) => treatment.status === "active" ||
    Date.parse(treatment.created_at) >= Date.parse(cutoff) || Date.parse(treatment.closed_at) >= Date.parse(cutoff));
  const results = await Promise.all(treatments.map((treatment) => axios.get(`${API}/treatments/${treatment.treatment_id}/entries`,
    { params: { since: cutoff }, withCredentials: true })));
  return results.flatMap((result) => result.data.entries || []).sort((a, b) =>
    Date.parse(a.event_at || a.created_at) - Date.parse(b.event_at || b.created_at));
}

export function treatmentLogText(entries) {
  return [
    `TREATMENT / OPERATIONS LOG (${entries.length} entries)`,
    ...entries.map((entry) => `  ${fmtDateTime(entry.event_at || entry.created_at)} ${entry.author_name || "crew"}: ${entry.text}`),
    ...(entries.length ? [] : ["  No entries logged in this rig/time window."]),
  ].join("\n");
}
