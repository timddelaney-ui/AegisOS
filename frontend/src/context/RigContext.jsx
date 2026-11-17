import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API } from "./AuthContext";
import { useActiveJobSelection, useJobActions } from "./ActiveJobContext";

const STORAGE_KEY = "ctp_active_rig_v2";
const LAST_SEEN_KEY = "ctp_rig_last_seen_v1"; // { [rigId]: { chat: iso, checklist: iso } }

// 25 numbered rigs + Yard. Colours cycle across a curated field-safe palette
// so each rig looks distinct at a glance.
const PALETTE = ["#FF6B1A", "#0056B3", "#C36600", "#7C3AED", "#DB2777", "#059669", "#B91C1C", "#0891B2", "#4338CA", "#CA8A04"];
export const RIGS = [
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `CT-UNIT-${String(i + 1).padStart(2, "0")}`,
    label: `CT Unit ${String(i + 1).padStart(2, "0")}`,
    accent: PALETTE[i % PALETTE.length],
  })),
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
let _statusCache = {};
try {
  const stored = localStorage.getItem("ctp_rig_labels_v1");
  if (stored) _labelCache = JSON.parse(stored) || {};
  const storedS = localStorage.getItem("ctp_rig_status_v1");
  if (storedS) _statusCache = JSON.parse(storedS) || {};
} catch { /* ignore */ }
const _writeLabelCache = (v) => {
  _labelCache = v || {};
  try { localStorage.setItem("ctp_rig_labels_v1", JSON.stringify(_labelCache)); } catch { /* ignore */ }
};
const _writeStatusCache = (v) => {
  _statusCache = v || {};
  try { localStorage.setItem("ctp_rig_status_v1", JSON.stringify(_statusCache)); } catch { /* ignore */ }
};

// Rig status palette — matched to field-safe colors.
export const RIG_STATUS_META = {
  running: { label: "Running",  color: "#10B981", bg: "#10B98120", short: "RUN" },
  standby: { label: "Standby",  color: "#F59E0B", bg: "#F59E0B20", short: "STBY" },
  down:    { label: "Down",     color: "#EF4444", bg: "#EF444420", short: "DOWN" },
  yard:    { label: "In Yard",  color: "#6B7280", bg: "#6B728020", short: "YARD" },
};
export const RIG_STATUS_LIST = ["running", "standby", "down", "yard"];

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
  const { rig: rigId } = useActiveJobSelection();
  const { updateJob } = useJobActions();
  const [activity, setActivity] = useState({}); // { [rigId]: { last_chat_at, last_checklist_at } }
  const [lastSeen, setLastSeen] = useState(readLastSeen);
  const [labels, setLabels] = useState({}); // { RIG1: "North Pad Unit", ... }
  const [statuses, setStatuses] = useState({}); // { RIG1: {status, note, updated_by, updated_at}, ... }
  const timerRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, rigId); }
    catch (e) { console.warn("RigContext: active-rig write failed", e?.message); }
  }, [rigId]);
  const setRigId = useCallback((id) => {
    if (RIGS.some((r) => r.id === id)) updateJob({ rig: id });
  }, [updateJob]);

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

  const refreshStatuses = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/rigs/status`, { withCredentials: true });
      const next = data?.statuses || {};
      setStatuses(next);
      _writeStatusCache(next);
    } catch (e) {
      if (e?.response?.status && e.response.status !== 401) {
        console.debug("RigContext: statuses fetch failed", e.response.status);
      }
    }
  }, []);

  useEffect(() => {
    fetchActivity();
    refreshLabels();
    refreshStatuses();
    timerRef.current = setInterval(() => {
      fetchActivity();
      refreshStatuses(); // keep fleet status fresh every 15s
    }, 15000);
    return () => clearInterval(timerRef.current);
  }, [fetchActivity, refreshLabels, refreshStatuses]);

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
    () => ({ rigId, setRigId, activity, lastSeen, markSeen, unreadFor, refreshActivity: fetchActivity, labels, refreshLabels, statuses, refreshStatuses }),
    [rigId, setRigId, activity, lastSeen, markSeen, unreadFor, fetchActivity, labels, refreshLabels, statuses, refreshStatuses]
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

// Returns the team's status for a rig (defaults to 'yard'). Non-hook accessor
// backed by the module-level cache; use useRig().statuses for reactive reads.
export const rigStatus = (id) => (_statusCache?.[id]?.status) || "yard";
export const rigStatusNote = (id) => (_statusCache?.[id]?.note) || null;

// Hook that returns the team-override label if set, else the default.
export const useRigLabel = (id) => {
  const { labels } = useRig();
  return labels?.[id] || rigDefaultLabel(id);
};
