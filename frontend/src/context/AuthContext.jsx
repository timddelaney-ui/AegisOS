import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import axios from "axios";

const DEFAULT_BACKEND_ORIGIN = "http://localhost:8000";

const getBrowserOrigin = () => {
  if (typeof window === "undefined") return DEFAULT_BACKEND_ORIGIN;
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
};

const normalizeBackendUrl = (rawValue) => {
  if (!rawValue || typeof rawValue !== "string") {
    return getBrowserOrigin();
  }

  const value = rawValue.trim();
  if (!value) return getBrowserOrigin();

  try {
    const url = new URL(value);
    if (!url.protocol || !url.host) {
      throw new Error("Backend URL is missing protocol or host");
    }
    return `${url.protocol}//${url.host}`.replace(/\/$/, "");
  } catch (error) {
    console.warn("REACT_APP_BACKEND_URL is invalid; falling back to current browser origin.", {
      rawValue,
      error: error?.message || String(error),
    });
    return getBrowserOrigin();
  }
};

const BACKEND_URL = normalizeBackendUrl(process.env.REACT_APP_BACKEND_URL);
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
    [user, loading, checkAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export { API, BACKEND_URL };

export const isProUser = (user) => {
  if (!user) return false;
  if (user.subscription_tier === "enterprise") return true;
  if (user.subscription_status === "active") return true;
  return false;
};
