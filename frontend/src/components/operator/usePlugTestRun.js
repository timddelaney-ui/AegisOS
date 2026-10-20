import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API } from "../../context/AuthContext";

// Test run: drive the sim from surface to TD and log when the bit clears each plug
export function usePlugTestRun({ depth, plugs, maxFt, surveyId, onStart, onEnd }) {
  const [run, setRun] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const runRef = useRef(null);
  runRef.current = run;

  useEffect(() => {
    setLastRun(null);
    if (!surveyId) return;
    axios.get(`${API}/surveys/${surveyId}/plug-runs`, { withCredentials: true })
      .then((r) => setLastRun(r.data?.runs?.[0] || null))
      .catch((e) => console.debug("[Operator] plug-runs load failed", e?.response?.status || e?.message));
  }, [surveyId]);

  const start = useCallback((speed) => {
    const startMd = onStart();
    setRun({ startMs: Date.now(), startMd, speed, passes: [] });
  }, [onStart]);

  const stop = useCallback(() => { setRun(null); onEnd(); toast("Test run aborted"); }, [onEnd]);

  useEffect(() => {
    const r = runRef.current;
    if (!r) return;
    const elapsed = (Date.now() - r.startMs) / 1000;
    const fresh = plugs.filter((p) => depth >= p.end && !r.passes.some((x) => x.plug_id === p.id))
      .map((p) => ({ plug_id: p.id, name: p.name, depth_ft: +depth.toFixed(1), elapsed_s: +elapsed.toFixed(1) }));
    const passes = fresh.length ? [...r.passes, ...fresh] : r.passes;
    if (fresh.length) setRun({ ...r, passes });
    if (depth < maxFt) return;

    const body = { mode: "test", speed: r.speed, start_md_ft: r.startMd, end_md_ft: +depth.toFixed(1), duration_s: +elapsed.toFixed(1), passes };
    setRun(null);
    onEnd();
    const msg = `Test run complete — ${passes.length}/${plugs.length} plugs cleared`;
    if (!surveyId) { setLastRun(body); toast.success(msg); return; }
    axios.post(`${API}/surveys/${surveyId}/plug-runs`, body, { withCredentials: true })
      .then((res) => { setLastRun(res.data); toast.success(msg); })
      .catch((e) => { setLastRun(body); toast.error(e?.response?.data?.detail || "Could not save test run"); });
  }, [depth, plugs, maxFt, surveyId, onEnd]);

  return { run, lastRun, start, stop };
}
