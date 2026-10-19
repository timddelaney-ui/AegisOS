import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { useAuth, API } from "./AuthContext";
import {
  TIER_PERSONAL,
  TIER_ORDER,
  tierHasAccess,
  tierShowsLockedTeaser,
  tierHidesCompletely,
  minTierFor,
  FEATURE_SPECS,
} from "../lib/tiers";

/**
 * TierContext — owns the viewer's active plan tier, the global BETA_UNLOCK
 * override from the backend, and the upgrade-modal state.
 *
 * All feature gating in the app flows through `useTier()` so flipping
 * `BETA_UNLOCK=false` on the backend is the single switch that activates
 * paywalls for everyone.
 */

const TierContext = createContext(null);

export const useTier = () => {
  const ctx = useContext(TierContext);
  if (!ctx) throw new Error("useTier must be used within TierProvider");
  return ctx;
};

export const TierProvider = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [tier, setTier] = useState(TIER_PERSONAL);
  const [betaUnlock, setBetaUnlock] = useState(true); // optimistic default so no flash of locked UI during Beta
  const [loaded, setLoaded] = useState(false);
  const [upgradeFor, setUpgradeFor] = useState(null); // featureId we're prompting to upgrade for

  const refresh = useCallback(async () => {
    if (!user) {
      setLoaded(true);
      return;
    }
    try {
      const { data } = await axios.get(`${API}/me/tier`, { withCredentials: true });
      setTier(data?.tier && TIER_ORDER.includes(data.tier) ? data.tier : TIER_PERSONAL);
      setBetaUnlock(!!data?.beta_unlock);
    } catch (e) {
      // Fail safe to personal + beta-off so the client never silently
      // elevates a user who doesn't legitimately have Enterprise.
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

  // Gate helpers. `canAccess` is the one every feature callsite uses.
  const canAccess = useCallback(
    (featureId) => {
      if (betaUnlock) return true;             // Field Beta — nothing is locked
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

  // Open the upgrade modal for a specific feature. The feature's min tier
  // dictates which plan card gets highlighted on the pricing page.
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
