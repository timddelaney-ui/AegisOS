import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API } from "../../context/AuthContext";

const opts = { withCredentials: true };

// Shared per-survey depth correlation (offset in ft). Nudges are debounced into one log entry.
export function useDepthCorrelation(surveyId) {
  const [offsetFt, setOffsetFt] = useState(0);
  const [moveTarget, setMoveTarget] = useState("ct_string");
  const [log, setLog] = useState([]);
  const timer = useRef(null);
  const pending = useRef(null);
  const stateRef = useRef({ offsetFt: 0, moveTarget: "ct_string" });
  stateRef.current = { offsetFt, moveTarget };

  useEffect(() => {
    setOffsetFt(0); setMoveTarget("ct_string"); setLog([]);
    if (!surveyId) return;
    axios.get(`${API}/surveys/${surveyId}/correlation`, opts)
      .then((r) => { setOffsetFt(r.data.offset_ft || 0); setMoveTarget(r.data.move_target || "ct_string"); setLog(r.data.log || []); })
      .catch((e) => console.debug("[Operator] correlation load failed", e?.response?.status || e?.message));
  }, [surveyId]);

  const persist = useCallback((body) => {
    if (!surveyId) return;
    axios.post(`${API}/surveys/${surveyId}/correlation`, body, opts)
      .then((r) => setLog((l) => [r.data.entry, ...l].slice(0, 20)))
      .catch((e) => toast.error(e?.response?.data?.detail || "Could not save depth correlation"));
  }, [surveyId]);

  const setOffset = useCallback((ft, reason, extra = {}) => {
    const v = Math.round(ft * 100) / 100;
    setOffsetFt(v);
    clearTimeout(timer.current);
    pending.current = { offset_ft: v, move_target: stateRef.current.moveTarget, reason, ...extra };
    const flush = () => { persist(pending.current); pending.current = null; };
    if (reason === "nudge") timer.current = setTimeout(flush, 800);
    else { flush(); if (reason === "tag") toast.success(`Offset set from ${extra.plug_name}`); }
  }, [persist]);

  const setTarget = useCallback((t) => {
    setMoveTarget(t);
    persist({ offset_ft: stateRef.current.offsetFt, move_target: t, reason: "target" });
  }, [persist]);

  useEffect(() => () => { if (pending.current) persist(pending.current); clearTimeout(timer.current); }, [persist]);
  return { offsetFt, moveTarget, log, setOffset, setTarget };
}

const CUSTOM_LS = "coilaegis_custom_channels_v1";

// Per-user channel layout (active job sets, hidden channels, custom channels) synced to server
export function useChannelLayout() {
  const [layout, setLayout] = useState({ active_sets: ["Pressures"], hidden: [], custom: [] });
  const loaded = useRef(false);

  useEffect(() => {
    axios.get(`${API}/me/operator-layout`, opts)
      .then((r) => {
        let legacy = [];
        try { legacy = JSON.parse(localStorage.getItem(CUSTOM_LS)) || []; } catch { legacy = []; }
        const d = r.data || {};
        setLayout({
          active_sets: d.active_sets || ["Pressures"],
          hidden: d.hidden || [],
          custom: d.custom?.length ? d.custom : legacy,
        });
      })
      .catch((e) => console.debug("[Operator] layout load failed", e?.response?.status || e?.message))
      .finally(() => { loaded.current = true; });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      axios.put(`${API}/me/operator-layout`, layout, opts).catch((e) => console.debug("[Operator] layout save failed", e?.message));
    }, 600);
    return () => clearTimeout(t);
  }, [layout]);

  const toggleSet = (set) => setLayout((l) => ({ ...l, active_sets: l.active_sets.includes(set) ? l.active_sets.filter((s) => s !== set) : [...l.active_sets, set] }));
  const hide = (id) => setLayout((l) => ({ ...l, hidden: [...new Set([...l.hidden, id])] }));
  const restore = (id) => setLayout((l) => ({ ...l, hidden: l.hidden.filter((h) => h !== id) }));
  const addCustom = (ch) => setLayout((l) => ({ ...l, custom: [...l.custom, ch], active_sets: l.active_sets.includes(ch.group) ? l.active_sets : [...l.active_sets, ch.group] }));
  const removeCustom = (id) => setLayout((l) => ({ ...l, custom: l.custom.filter((c) => c.id !== id), hidden: l.hidden.filter((h) => h !== id) }));
  return { ...layout, toggleSet, hide, restore, addCustom, removeCustom };
}
