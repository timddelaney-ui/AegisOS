import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { API } from "./AuthContext";

const Ctx = createContext({ activeReel: null, reels: [], refresh: () => {}, currentDepth: 0, setCurrentDepth: () => {} });

export const ActiveReelProvider = ({ children }) => {
  const [reels, setReels] = useState([]);
  const [activeReel, setActive] = useState(null);
  const [currentDepth, setCurrentDepth] = useState(() => {
    try { return Number(localStorage.getItem("ctp_current_depth") || 0); } catch { return 0; }
  });

  const refresh = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/reels`, { withCredentials: true });
      setReels(r.data?.reels || []);
      const act = (r.data?.reels || []).find((x) => x.reel_id === r.data?.active_reel_id);
      setActive(act || null);
    } catch (e) { /* ignore for unauthenticated */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    try { localStorage.setItem("ctp_current_depth", String(currentDepth)); } catch { /* storage disabled */ }
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
