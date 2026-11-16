import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API } from "../../context/AuthContext";
import { useActiveReel } from "../../context/ActiveReelContext";
import { FATIGUE_SECTIONS, estimateFatigueSections } from "../../lib/cockpitTelemetry";
import { intervalAt } from "../../lib/ctPhysics";

const POLL_MS = 30000;
const normalize = (data) => {
  const sec = data?.sections;
  if (!sec || typeof sec !== "object") return null;
  return FATIGUE_SECTIONS.map((s) => {
    const r = sec[s.key] || {};
    return {
      key: s.key,
      cumulative_damage_pct: Number(r.cumulative_damage_pct ?? NaN),
      cycle_count: Number(r.cycle_count ?? NaN),
      governing_depth_ft: r.governing_depth_ft == null ? NaN : Number(r.governing_depth_ft),
    };
  });
};
const color = (p) => (p >= 90 ? "#EF4444" : p >= 60 ? "#F59E0B" : "#22D3EE");

export default function FatigueCards({ signals }) {
  const { activeReel } = useActiveReel();
  const [remote, setRemote] = useState(null);
  const length = Number(activeReel?.total_length_ft) || 0;

  const lengthFt = length || Math.round(signals.depth || 0);
  const seg = useMemo(() => intervalAt(activeReel, signals.depth || 0), [activeReel, signals.depth]);
  const body = useMemo(() => ({
    length_ft: lengthFt, od_in: Number(seg?.od_in) || 1.75, wt_in: Number(seg?.wt_in) || 0.134, smys_psi: Number(seg?.smys_psi) || 90000,
    cycles: Number(activeReel?.trips) || 1, internal_psi: Math.round(signals.pInt || 0),
    ...(Number.isFinite(signals.weight) ? { weight_lbf: Math.round(signals.weight) } : {}),
  }), [lengthFt, seg, activeReel, signals.pInt, signals.weight]);
  const bodyKey = JSON.stringify({ ...body, internal_psi: 0, weight_lbf: 0 });

  useEffect(() => {
    if (!(lengthFt > 0)) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await axios.post(`${API}/fatigue/sections`, body, { withCredentials: true });
        if (!cancelled) setRemote(normalize(r.data));
      } catch { if (!cancelled) setRemote(null); }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey]);

  const estimate = useMemo(() => {
    const s = intervalAt(activeReel, signals.depth || 0);
    const cycles = Object.fromEntries(FATIGUE_SECTIONS.map((x) => [x.key, Number(activeReel?.[`${x.key}_cycles`] ?? activeReel?.trips ?? 0) || 0]));
    return estimateFatigueSections({
      lengthFt: length || signals.depth || 0, odIn: Number(s?.od_in) || 1.75, wtIn: Number(s?.wt_in) || 0.134,
      smys: Number(s?.smys_psi) || 90000, pressurePsi: signals.pInt || 0, cyclesBySection: cycles,
    });
  }, [activeReel, length, signals.depth, signals.pInt]);

  const rows = remote || estimate;
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="fatigue-cards">
      {FATIGUE_SECTIONS.map((s, i) => {
        const r = rows[i]; const pct = Number.isFinite(r.cumulative_damage_pct) ? r.cumulative_damage_pct : 0;
        return (
          <div key={s.key} className="rounded-lg border bg-[#0F172A] p-2" style={{ borderColor: color(pct) }} data-testid={`fatigue-${s.key}`}>
            <div className="text-[10px] uppercase text-slate-400">{s.label} <span className="normal-case">{s.range}</span></div>
            <div className="font-mono tabular-nums text-2xl font-bold" style={{ color: color(pct) }}>{pct.toFixed(1)}%</div>
            <div className="text-[11px] font-mono text-slate-300">{Number.isFinite(r.cycle_count) ? r.cycle_count : "—"} cycles</div>
            <div className="text-[11px] font-mono text-slate-300">gov. {Number.isFinite(r.governing_depth_ft) ? `${Math.round(r.governing_depth_ft).toLocaleString()} ft` : "—"}</div>
            {!remote && <div className="text-[9px] text-amber-400">client estimate</div>}
          </div>
        );
      })}
    </div>
  );
}
