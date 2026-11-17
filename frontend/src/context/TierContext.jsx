import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { useAuth, API } from "./AuthContext";
import {
  TIER_PERSONAL,
  normalizeTier,
  tierHasAccess,
  tierShowsLockedTeaser,
  tierHidesCompletely,
  minTierFor,
  FEATURE_SPECS,
} from "../lib/tiers";
import { getStateSync, setState } from "../lib/fieldStore";

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
      const { data } = await axios.get(`${API}/me/tier`, { withCredentials: true });
      const nextTier = normalizeTier(data?.tier || data?.effective_plan);
      setTier(nextTier);
      setBetaUnlock(Boolean(data?.beta_unlock));
      setState(`offline_tier:${user.user_id}`, { tier: nextTier, betaUnlock: Boolean(data?.beta_unlock) });
    } catch (e) {
      const saved = !e.response ? getStateSync(`offline_tier:${user.user_id}`, null) : null;
      setTier(saved ? normalizeTier(saved.tier) : TIER_PERSONAL);
      setBetaUnlock(!!saved?.betaUnlock);
    } finally {
      setLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    refresh();
  }, [authLoading, refresh]);

  const canAccess = useCallback(
    (featureId) => tierHasAccess(tier, featureId),
    [tier],
  );

  const showsLockedTeaser = useCallback(
    (featureId) => tierShowsLockedTeaser(tier, featureId),
    [tier],
  );

  const hidesCompletely = useCallback(
    (featureId) => tierHidesCompletely(tier, featureId),
    [tier],
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
