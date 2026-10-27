import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { API } from "./AuthContext";
import { getStateSync, setState, walAppend } from "../lib/fieldStore";

const Ctx = createContext({ activeReel: null, reels: [], refresh: () => {}, currentDepth: 0, setCurrentDepth: () => {} });

export const ActiveReelProvider = ({ children }) => {
  // Seed from the last snapshot so the reel + depth are present instantly, even with no signal.
  const snap = useMemo(() => getStateSync("active_reel_snapshot", null), []);
  const [reels, setReels] = useState(snap?.reels || []);
  const [activeReel, setActive] = useState(snap?.activeReel || null);
  const [currentDepth, setCurrentDepth] = useState(() => {
    const saved = getStateSync("current_depth", null);
    if (Number.isFinite(saved)) return saved;
    try { return Number(localStorage.getItem("ctp_current_depth") || 0); } catch { return 0; }
  });

  const refresh = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/reels`, { withCredentials: true });
      setReels(r.data?.reels || []);
      const act = (r.data?.reels || []).find((x) => x.reel_id === r.data?.active_reel_id);
      setActive(act || null);
      setState("active_reel_snapshot", { reels: r.data?.reels || [], activeReel: act || null });
    } catch (e) { /* offline / unauthenticated: keep the last snapshot */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    try { localStorage.setItem("ctp_current_depth", String(currentDepth)); } catch { /* storage disabled */ }
    setState("current_depth", currentDepth);
    walAppend("depth", { depth_ft: currentDepth });
  }, [currentDepth]);

  // Memoised context value — prevents every ActiveReelContext consumer from
  // re-rendering on parent re-renders when the actual data hasn't changed.
  const value = useMemo(
    () => ({ activeReel, reels, refresh, currentDepth, setCurrentDepth }),
    [activeReel, reels, refresh, currentDepth],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
};

export const useActiveReel = () => useContext(Ctx);
