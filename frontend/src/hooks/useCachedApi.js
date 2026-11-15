import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "../context/AuthContext";
import { getStateSync, setState } from "../lib/fieldStore";

function cached(key) {
  const snapshot = getStateSync(key, null);
  return { key, data: snapshot?.data ?? null, savedAt: snapshot?.savedAt, status: snapshot ? "cached" : "loading", error: null };
}

export function useCachedApi(path, params = {}, enabled = true) {
  const { user } = useAuth();
  const paramsJSON = JSON.stringify(params);
  const key = `api_cache:${user?.user_id}:${path}:${paramsJSON}`;
  const [state, setResult] = useState(() => cached(key));
  const activeKey = useRef(key);
  const request = useRef(0);
  activeKey.current = key;
  const invalidateRequests = useCallback(() => { request.current++; }, []);
  const refresh = useCallback(async () => {
    if (!enabled || !path) return;
    const currentRequest = ++request.current;
    try {
      const { data } = await axios.get(`${API}${path}`, { params: JSON.parse(paramsJSON), withCredentials: true });
      if (activeKey.current !== key || currentRequest !== request.current) return;
      const savedAt = new Date().toISOString();
      await setState(key, { data, savedAt });
      if (activeKey.current === key && currentRequest === request.current) setResult({ key, data, savedAt, status: "fresh", error: null });
    } catch (error) {
      console.warn("[Job] resource unavailable", path, error?.message);
      if (activeKey.current !== key || currentRequest !== request.current) return;
      setResult((previous) => {
        const snapshot = previous.key === key ? previous : cached(key);
        return { ...snapshot, status: snapshot.data !== null ? "cached" : "error", error: error?.response?.data?.detail || "Unavailable offline or unable to load. Retry when connected." };
      });
    }
  }, [key, path, paramsJSON, enabled]);
  useEffect(() => {
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => { invalidateRequests(); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
  }, [refresh, invalidateRequests]);
  const result = state.key === key ? state : cached(key);
  return { ...result, status: enabled ? result.status : "disabled", refresh };
}
