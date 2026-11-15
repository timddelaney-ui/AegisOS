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

// The API is often on a different site than the app, so the session cookie can be
// blocked as third-party. Keep the token from the Google hand-off and send it as
// a Bearer header on API calls.
const SESSION_TOKEN_KEY = "aegis_session_token";
export const getSessionToken = () => {
  try { return localStorage.getItem(SESSION_TOKEN_KEY); } catch { return null; }
};
export const setSessionToken = (token) => {
  try {
    if (token) localStorage.setItem(SESSION_TOKEN_KEY, token);
    else localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch (error) { console.warn("[Auth] session token storage unavailable", error?.message); }
};
axios.interceptors?.request.use((config) => {
  const token = getSessionToken();
  if (token && typeof config.url === "string" && config.url.startsWith(API)) {
    config.headers = config.headers || {};
    if (typeof config.headers.set === "function") config.headers.set("Authorization", `Bearer ${token}`);
    else config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const AuthContext = createContext(null);
const OFFLINE_SESSION_KEY = "aegis_offline_workspace_v1";
function cachedWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(OFFLINE_SESSION_KEY) || "null");
    return saved?.user_id ? saved : null;
  } catch (error) { console.warn("[Auth] offline workspace unavailable", error?.message); return null; }
}

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, updateUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offlineWorkspace, setOfflineWorkspace] = useState(false);
  const setUser = useCallback((data) => {
    updateUser(data);
    setOfflineWorkspace(false);
    if (data?.user_id) {
      const { user_id, name, role, team_id, subscription_tier, subscription_status, trial_expires_at } = data;
      try { localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify({ user_id, name, role, team_id, subscription_tier, subscription_status, trial_expires_at })); }
      catch (error) { console.warn("[Auth] could not cache offline workspace", error?.message); }
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/auth/me`, { withCredentials: true });
      setUser(data || null);
    } catch (e) {
      const saved = !e.response ? cachedWorkspace() : null;
      updateUser(saved);
      setOfflineWorkspace(!!saved);
      if ([401, 403].includes(e.response?.status)) {
        setSessionToken(null);
        try { localStorage.removeItem(OFFLINE_SESSION_KEY); } catch (error) { console.warn("[Auth] cache removal failed", error?.message); }
      }
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    if (/(session_id|auth_code)=/.test(window.location.hash || "")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);
  useEffect(() => {
    window.addEventListener("online", checkAuth);
    return () => window.removeEventListener("online", checkAuth);
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try {
      await axios.post(`${API}/auth/logout`, {}, { withCredentials: true });
    } catch (e) {
      console.warn("Logout call failed (session may already be gone):", e?.message);
    }
    setSessionToken(null);
    setUser(null);
    setOfflineWorkspace(false);
    try { localStorage.removeItem(OFFLINE_SESSION_KEY); } catch (error) { console.warn("[Auth] cache removal failed", error?.message); }
    window.location.href = "/";
  }, [setUser]);

  const value = useMemo(
    () => ({ user, setUser, loading, checkAuth, logout, offlineWorkspace }),
    [user, setUser, loading, checkAuth, logout, offlineWorkspace],
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
