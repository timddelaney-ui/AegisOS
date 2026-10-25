import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import axios from "axios";
import { API } from "../config/env";

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/auth/me`, { withCredentials: true });
      setUser(data || null);
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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

export { API };

export const isProUser = (user) => {
  if (!user) return false;
  if (user.is_pro === true) return true;
  if (user.subscription_tier === "enterprise") return true;
  return false;
};
