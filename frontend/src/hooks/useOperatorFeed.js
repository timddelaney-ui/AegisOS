import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API } from "../context/AuthContext";
import { SEED_TELEMETRY, simTick, fromDaqSample } from "../lib/operatorConfig";

const SIM_TICK_MS = 500;
const LIVE_POLL_MS = 2000;
const LIVE_RECONNECT_MS = 5000;
const MAX_HISTORY_SAMPLES = 180;
const isFresh = (sample) => {
  const timestamp = sample?.created_at || "";
  const parsed = Date.parse(/Z|[+-]\d\d:??\d\d$/.test(timestamp) ? timestamp : `${timestamp}Z`);
  return Number.isFinite(parsed) && Date.now() - parsed < 5000;
};

// Extracted from MainOperatorScreen: feed timing, freshness and physics remain unchanged.
export function useOperatorFeed({ rigId, feedMode, minFt, maxFt }) {
  const [telemetry, setTelemetry] = useState(SEED_TELEMETRY);
  const [liveStale, setLiveStale] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isSimRunning, setIsSimRunning] = useState(true);
  const [lastLiveSample, setLastLiveSample] = useState(null);
  const historyRef = useRef([]);
  const push = (next) => { historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY_SAMPLES - 1)), next]; return next; };

  useEffect(() => {
    if (feedMode === "STANDBY" || !isSimRunning) return;
    if (feedMode === "LIVE" && !liveStale) return;
    const id = setInterval(() => {
      setLastLiveSample(null);
      setTelemetry((prev) => push(simTick(prev, playbackSpeed, minFt, maxFt)));
    }, SIM_TICK_MS);
    return () => clearInterval(id);
  }, [isSimRunning, feedMode, playbackSpeed, liveStale, minFt, maxFt]);

  useEffect(() => {
    if (feedMode !== "LIVE") { setLiveStale(false); return; }
    let cancelled = false;
    let socket = null;
    let pollTimer = null;
    let reconnectTimer = null;
    let staleTimer = null;
    let lastReceivedAt = 0;
    let lastAcceptedTimestampMs = -Infinity;
    const acceptSample = (sample) => {
      if (cancelled) return;
      if (sample && isFresh(sample)) {
        const timestampMs = Date.parse(sample.event_at ?? sample.ts ?? sample.created_at ?? "");
        if (Number.isFinite(timestampMs) && timestampMs < lastAcceptedTimestampMs) return;
        if (Number.isFinite(timestampMs)) lastAcceptedTimestampMs = timestampMs;
        lastReceivedAt = Date.now();
        setLiveStale(false);
        setLastLiveSample(sample);
        setTelemetry((prev) => push(fromDaqSample(prev, sample)));
      } else {
        setLiveStale(true);
      }
    };
    const poll = async () => {
      try {
        const response = await axios.get(`${API}/liveops/stream`, { params: { limit: 1, rig_id: rigId }, withCredentials: true });
        acceptSample(response.data?.samples?.[0]);
      } catch (error) {
        if (!cancelled) setLiveStale(true);
        console.debug("[Operator] live poll failed", error?.response?.status || error?.message);
      }
    };
    const startPolling = () => {
      if (pollTimer !== null || cancelled) return;
      poll();
      pollTimer = setInterval(poll, LIVE_POLL_MS);
    };
    const connect = () => {
      if (cancelled) return;
      const wsUrl = new URL(`${API}/liveops/ws`);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      if (rigId) wsUrl.searchParams.set("rig_id", rigId);
      try {
        socket = new WebSocket(wsUrl.toString());
      } catch (error) {
        console.debug("[Operator] live WebSocket unavailable", error?.message);
        startPolling();
        reconnectTimer = setTimeout(connect, LIVE_RECONNECT_MS);
        return;
      }
      socket.onopen = () => {
        if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
      };
      socket.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); }
        catch (error) { console.debug("[Operator] invalid live WebSocket message", error?.message); return; }
        if (message.type === "telemetry") acceptSample(message.sample);
        if (message.type === "resync_required") { setLiveStale(true); socket?.close(); }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (cancelled) return;
        startPolling();
        reconnectTimer = setTimeout(connect, LIVE_RECONNECT_MS);
      };
    };
    startPolling();
    connect();
    staleTimer = setInterval(() => {
      if (lastReceivedAt && Date.now() - lastReceivedAt > 5000) setLiveStale(true);
    }, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      if (pollTimer !== null) clearInterval(pollTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (staleTimer !== null) clearInterval(staleTimer);
      socket?.close();
    };
  }, [feedMode, rigId]);
  return useMemo(() => ({ telemetry, setTelemetry, liveStale, playbackSpeed, setPlaybackSpeed, isSimRunning, setIsSimRunning, historyRef, lastLiveSample }),
    [telemetry, liveStale, playbackSpeed, isSimRunning, lastLiveSample]);
}
