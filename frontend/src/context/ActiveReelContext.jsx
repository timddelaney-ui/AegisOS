import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { API } from "./AuthContext";
import { getStateSync, setState, walAppend } from "../lib/fieldStore";
import { useActiveJobSelection, useJobActions } from "./ActiveJobContext";

const ReelContext = createContext({ activeReel: null, reels: [], refresh: () => {} });
const DepthContext = createContext({ currentDepth: 0, setCurrentDepth: () => {} });

export const ActiveReelProvider = ({ children }) => {
  // Seed from the last snapshot so the reel + depth are present instantly, even with no signal.
  const snap = useMemo(() => getStateSync("active_reel_snapshot", null), []);
  const [reels, setReels] = useState(snap?.reels || []);
  const { activeReel } = useActiveJobSelection();
  const { updateJob } = useJobActions();
  const selectionRef = useRef(activeReel);
  selectionRef.current = activeReel;
  const [currentDepth, setCurrentDepth] = useState(() => {
    const saved = getStateSync("current_depth", null);
    if (Number.isFinite(saved)) return saved;
    try { return Number(localStorage.getItem("ctp_current_depth") || 0); } catch { return 0; }
  });

  const refresh = useCallback(async ({ adoptActive = false } = {}) => {
    try {
      const r = await axios.get(`${API}/reels`, { withCredentials: true });
      setReels(r.data?.reels || []);
      const id = adoptActive || !selectionRef.current ? r.data?.active_reel_id : selectionRef.current.reel_id;
      const act = (r.data?.reels || []).find((x) => x.reel_id === id);
      if (act && JSON.stringify(act) !== JSON.stringify(selectionRef.current)) updateJob({ activeReel: act });
      setState("active_reel_snapshot", { reels: r.data?.reels || [], activeReel: act || null });
    } catch (e) { console.debug("[ActiveReel] keeping offline reel snapshot", e?.message); }
  }, [updateJob]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    try { localStorage.setItem("ctp_current_depth", String(currentDepth)); } catch { /* storage disabled */ }
    setState("current_depth", currentDepth);
    walAppend("depth", { depth_ft: currentDepth });
  }, [currentDepth]);

  // Memoised context value — prevents every ActiveReelContext consumer from
  // re-rendering on parent re-renders when the actual data hasn't changed.
  const value = useMemo(
    () => ({ activeReel, reels, refresh }),
    [activeReel, reels, refresh],
  );
  const depthValue = useMemo(() => ({ currentDepth, setCurrentDepth }), [currentDepth]);

  return (
    <ReelContext.Provider value={value}>
      <DepthContext.Provider value={depthValue}>{children}</DepthContext.Provider>
    </ReelContext.Provider>
  );
};

export const useReelMetadata = () => useContext(ReelContext);
export const useCurrentDepth = () => useContext(DepthContext);
export const useActiveReel = () => ({ ...useReelMetadata(), ...useCurrentDepth() });
