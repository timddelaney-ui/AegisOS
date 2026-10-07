import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

axios.defaults.withCredentials = true;

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/auth/me`, { withCredentials: true });
      setUser(data);
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = async () => {
    try {
      await axios.post(`${API}/auth/logout`, {}, { withCredentials: true });
    } catch (e) {
      console.warn("Logout call failed (session may already be gone):", e?.message);
    }
    setUser(null);
    window.location.href = "/";
  };

  const value = useMemo(
    () => ({ user, setUser, loading, checkAuth, logout }),
    [user, loading, checkAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export { API, BACKEND_URL };

// Free-for-all mode: user flipped this ON in iter 21 — every logged-in user
// gets full Pro access. To re-enable paid gating, swap this helper back to
// the subscription-aware version below.
export const isProUser = (_user) => true;

// Keep the original logic available so it's a one-line restore later:
//   if (!user || user.subscription_status !== "active") return false;
//   const exp = user.subscription_expires_at;
//   if (!exp) return true;
//   const t = new Date(exp).getTime();
//   return Number.isFinite(t) && t > Date.now();
