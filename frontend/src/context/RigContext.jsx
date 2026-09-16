import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import axios from "axios";
import { API } from "./AuthContext";

const STORAGE_KEY = "ctp_active_rig_v2";
const LAST_SEEN_KEY = "ctp_rig_last_seen_v1"; // { [rigId]: { chat: iso, checklist: iso } }

// 25 numbered rigs + Yard. Colours cycle across a curated field-safe palette
// so each rig looks distinct at a glance.
const PALETTE = ["#107C41", "#0056B3", "#C36600", "#7C3AED", "#DB2777", "#059669", "#B91C1C", "#0891B2", "#4338CA", "#CA8A04"];
export const RIGS = [
  ...Array.from({ length: 25 }, (_, i) => ({
    id: `RIG${i + 1}`,
    label: `Rig ${i + 1}`,
    accent: PALETTE[i % PALETTE.length],
  })),
  { id: "YARD", label: "Yard", accent: "#6B7280" },
];

const RigContext = createContext({
  rigId: "RIG1",
  setRigId: () => {},
  activity: {},
  lastSeen: {},
  markSeen: () => {},
  unreadFor: () => ({ chat: false, checklist: false }),
});

function readLastSeen() {
  try { return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "{}"); } catch { return {}; }
}
function writeLastSeen(v) {
  try { localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(v)); } catch {}
}

export const RigProvider = ({ children }) => {
  const [rigId, setRigIdState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || "RIG1"; } catch { return "RIG1"; }
  });
  const [activity, setActivity] = useState({}); // { [rigId]: { last_chat_at, last_checklist_at } }
  const [lastSeen, setLastSeen] = useState(readLastSeen);
  const timerRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, rigId); } catch {} }, [rigId]);
  const setRigId = (id) => { if (RIGS.some((r) => r.id === id)) setRigIdState(id); };

  const fetchActivity = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/crew/activity-summary`, { withCredentials: true });
      setActivity(data?.rigs || {});
    } catch { /* silent — solo mode / not signed in */ }
  }, []);

  useEffect(() => {
    fetchActivity();
    timerRef.current = setInterval(fetchActivity, 15000);
    return () => clearInterval(timerRef.current);
  }, [fetchActivity]);

  const markSeen = useCallback((rid, channel) => {
    setLastSeen((prev) => {
      const nowIso = new Date().toISOString();
      const next = { ...prev, [rid]: { ...(prev[rid] || {}), [channel]: nowIso } };
      writeLastSeen(next);
      return next;
    });
  }, []);

  const unreadFor = useCallback((rid) => {
    const act = activity[rid] || {};
    const seen = lastSeen[rid] || {};
    const chat = act.last_chat_at && (!seen.chat || new Date(act.last_chat_at) > new Date(seen.chat));
    const checklist = act.last_checklist_at && (!seen.checklist || new Date(act.last_checklist_at) > new Date(seen.checklist));
    return { chat: Boolean(chat), checklist: Boolean(checklist) };
  }, [activity, lastSeen]);

  return (
    <RigContext.Provider value={{ rigId, setRigId, activity, lastSeen, markSeen, unreadFor, refreshActivity: fetchActivity }}>
      {children}
    </RigContext.Provider>
  );
};

export const useRig = () => useContext(RigContext);
export const rigAccent = (id) => (RIGS.find((r) => r.id === id) || RIGS[0]).accent;
export const rigLabel  = (id) => (RIGS.find((r) => r.id === id) || RIGS[0]).label;
