import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { useAuth, API_BASE } from "./AuthContext";
import {
  TIER_PERSONAL,
  TIER_ORDER,
  tierHasAccess,
  tierShowsLockedTeaser,
  tierHidesCompletely,
  minTierFor,
  FEATURE_SPECS,
} from "../lib/tiers";

const TierContext = createContext(null);

export const useTier = () => {
  const ctx = useContext(TierContext);
  if (!ctx) throw new Error("useTier must be used within TierProvider");
  return ctx;
};

export const TierProvider = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [tier, setTier] = useState(TIER_PERSONAL);
  const [betaUnlock, setBetaUnlock] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [upgradeFor, setUpgradeFor] = useState(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setTier(TIER_PERSONAL);
      setBetaUnlock(false);
      setLoaded(true);
      return;
    }

    try {
      const { data } = await axios.get(`${API_BASE}/me/tier`, { withCredentials: true });
      const nextTier = data?.tier && TIER_ORDER.includes(data.tier) ? data.tier : TIER_PERSONAL;
      setTier(nextTier);
      setBetaUnlock(Boolean(data?.beta_unlock));
    } catch (e) {
      setTier(TIER_PERSONAL);
      setBetaUnlock(false);
    } finally {
      setLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    refresh();
  }, [authLoading, refresh]);

  const canAccess = useCallback(
    (featureId) => {
      if (betaUnlock) return true;
      return tierHasAccess(tier, featureId);
    },
    [tier, betaUnlock],
  );

  const showsLockedTeaser = useCallback(
    (featureId) => {
      if (betaUnlock) return false;
      return tierShowsLockedTeaser(tier, featureId);
    },
    [tier, betaUnlock],
  );

  const hidesCompletely = useCallback(
    (featureId) => {
      if (betaUnlock) return false;
      return tierHidesCompletely(tier, featureId);
    },
    [tier, betaUnlock],
  );

  const promptUpgrade = useCallback((featureId) => setUpgradeFor(featureId), []);
  const dismissUpgrade = useCallback(() => setUpgradeFor(null), []);

  const value = useMemo(
    () => ({
      tier,
      betaUnlock,
      loaded,
      refresh,
      canAccess,
      showsLockedTeaser,
      hidesCompletely,
      minTierFor,
      featureLabel: (featureId) => FEATURE_SPECS[featureId]?.label || featureId,
      upgradeFor,
      promptUpgrade,
      dismissUpgrade,
    }),
    [tier, betaUnlock, loaded, refresh, canAccess, showsLockedTeaser, hidesCompletely, upgradeFor, promptUpgrade, dismissUpgrade],
  );

  return <TierContext.Provider value={value}>{children}</TierContext.Provider>;
};
