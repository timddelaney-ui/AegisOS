import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API } from "./AuthContext";

const STORAGE_KEY = "ctp_active_rig_v2";
const LAST_SEEN_KEY = "ctp_rig_last_seen_v1"; // { [rigId]: { chat: iso, checklist: iso } }

// 25 numbered rigs + Yard. Colours cycle across a curated field-safe palette
// so each rig looks distinct at a glance.
const PALETTE = ["#FF6B1A", "#0056B3", "#C36600", "#7C3AED", "#DB2777", "#059669", "#B91C1C", "#0891B2", "#4338CA", "#CA8A04"];
export const RIGS = [
  ...Array.from({ length: 25 }, (_, i) => ({
    id: `RIG${i + 1}`,
    label: `Rig ${i + 1}`,
    accent: PALETTE[i % PALETTE.length],
  })),
  { id: "YARD", label: "Yard", accent: "#6B7280" },
];

// Module-level cache of custom labels, kept in sync by RigProvider via refreshLabels().
// All non-hook callers of rigLabel() read from this transparently — so custom names
// propagate across every page/component that already imports `rigLabel`.
let _labelCache = {};
try {
  const stored = localStorage.getItem("ctp_rig_labels_v1");
  if (stored) _labelCache = JSON.parse(stored) || {};
} catch { /* ignore */ }
const _writeLabelCache = (v) => {
  _labelCache = v || {};
  try { localStorage.setItem("ctp_rig_labels_v1", JSON.stringify(_labelCache)); } catch { /* ignore */ }
};

const RigContext = createContext({
  rigId: "RIG1",
  setRigId: () => {},
  activity: {},
  lastSeen: {},
  markSeen: () => {},
  unreadFor: () => ({ chat: false, checklist: false }),
  labels: {},
  refreshLabels: () => {},
});

function readLastSeen() {
  try { return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "{}"); }
  catch (e) { console.warn("RigContext: last-seen read failed", e?.message); return {}; }
}
function writeLastSeen(v) {
  try { localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(v)); }
  catch (e) { console.warn("RigContext: last-seen write failed", e?.message); }
}

export const RigProvider = ({ children }) => {
  const [rigId, setRigIdState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || "RIG1"; }
    catch (e) { console.warn("RigContext: active-rig read failed", e?.message); return "RIG1"; }
  });
  const [activity, setActivity] = useState({}); // { [rigId]: { last_chat_at, last_checklist_at } }
  const [lastSeen, setLastSeen] = useState(readLastSeen);
  const [labels, setLabels] = useState({}); // { RIG1: "North Pad Unit", ... }
  const timerRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, rigId); }
    catch (e) { console.warn("RigContext: active-rig write failed", e?.message); }
  }, [rigId]);
  const setRigId = useCallback((id) => {
    if (RIGS.some((r) => r.id === id)) setRigIdState(id);
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/crew/activity-summary`, { withCredentials: true });
      setActivity(data?.rigs || {});
    } catch (e) {
      // Not signed in / solo mode — activity summary requires auth+team. Log at debug volume only.
      if (e?.response?.status && e.response.status !== 401) {
        console.debug("RigContext: activity-summary fetch failed", e.response.status);
      }
    }
  }, []);

  const refreshLabels = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/rigs/labels`, { withCredentials: true });
      const next = data?.labels || {};
      setLabels(next);
      _writeLabelCache(next);
    } catch (e) {
      if (e?.response?.status && e.response.status !== 401) {
        console.debug("RigContext: labels fetch failed", e.response.status);
      }
    }
  }, []);

  useEffect(() => {
    fetchActivity();
    refreshLabels();
    timerRef.current = setInterval(fetchActivity, 15000);
    return () => clearInterval(timerRef.current);
  }, [fetchActivity, refreshLabels]);

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

  const value = useMemo(
    () => ({ rigId, setRigId, activity, lastSeen, markSeen, unreadFor, refreshActivity: fetchActivity, labels, refreshLabels }),
    [rigId, setRigId, activity, lastSeen, markSeen, unreadFor, fetchActivity, labels, refreshLabels]
  );

  return <RigContext.Provider value={value}>{children}</RigContext.Provider>;
};

export const useRig = () => useContext(RigContext);
export const rigAccent = (id) => (RIGS.find((r) => r.id === id) || RIGS[0]).accent;
// Default (hard-coded) label — "Rig 1" / "Yard".
export const rigDefaultLabel = (id) => (RIGS.find((r) => r.id === id) || RIGS[0]).label;
// Returns the team's custom override if set, else the default. Works outside of
// hooks because it reads a module-level cache that RigProvider keeps in sync.
export const rigLabel = (id) => _labelCache?.[id] || rigDefaultLabel(id);

// Hook that returns the team-override label if set, else the default.
export const useRigLabel = (id) => {
  const { labels } = useRig();
  return labels?.[id] || rigDefaultLabel(id);
};
