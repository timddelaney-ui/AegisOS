import axios from "axios";
import { API } from "../context/AuthContext";

export async function requestHitlApproval({
  action,
  summary,
  details = "",
  payloadFingerprint = "",
  confirmMessage,
}) {
  const { data: req } = await axios.post(`${API}/hitl/requests`, {
    action,
    summary,
    details: details || null,
    payload_fingerprint: payloadFingerprint || null,
  }, { withCredentials: true });

  const defaultMsg = `Approval required for:\n\n${summary}\n\nProceed?`;
  const approved = window.confirm(confirmMessage || defaultMsg);
  if (!approved) {
    await axios.post(`${API}/hitl/requests/${req.request_id}/decision`, {
      decision: "reject",
      reason: "user_cancelled",
    }, { withCredentials: true });
    throw new Error("Approval cancelled.");
  }

  await axios.post(`${API}/hitl/requests/${req.request_id}/decision`, {
    decision: "approve",
    confirm_text: "APPROVE",
  }, { withCredentials: true });
  return req.request_id;
}

