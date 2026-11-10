import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Activity, HeartPulse, Gauge, ShieldCheck } from "lucide-react";
import { API } from "../context/AuthContext";
import { useActiveReel } from "../context/ActiveReelContext";
import { getStateSync, setState, subscribeOutbox } from "../lib/fieldStore";
import { useShadow } from "../lib/shadow/useShadow";
import { STATUS, summarize } from "../lib/shadow/variance";
import { damageColor } from "../lib/ctPhysics";

function Tile({ icon: Icon, title, accent, children, testId, onClick }) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper type={onClick ? "button" : undefined} onClick={onClick} data-testid={testId}
      className="cab-card min-h-[168px] p-4 text-left transition-colors hover:border-[#FF6B1A]/60">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>
        <Icon className="h-4 w-4" />{title}
      </div>
      {children}
    </Wrapper>
  );
}

const Big = ({ children, color = "#fff" }) => <p className="font-mono text-3xl font-bold tabular-nums" style={{ color }}>{children}</p>;
const Sub = ({ children }) => <p className="mt-1 text-xs text-slate-400">{children}</p>;

export default function ExecutiveDashboard() {
  const navigate = useNavigate();
  const { activeReel, currentDepth } = useActiveReel();
  const { log, enabled } = useShadow();
  const [fatigue, setFatigue] = useState(() => getStateSync("exec_fatigue", null));
  const [pending, setPending] = useState(0);
  const cycles = getStateSync("fatigue_cycles", {}) || {};
  const reelId = activeReel?.reel_id;

  useEffect(() => subscribeOutbox(setPending), []);
  useEffect(() => {
    if (!reelId) return undefined;
    let cancelled = false;
    axios.get(`${API}/fatigue/state`, { params: { reel_id: reelId }, withCredentials: true })
      .then((r) => { if (!cancelled) { setFatigue(r.data); setState("exec_fatigue", { worst_damage: r.data?.worst_damage, derate_warning: r.data?.derate_warning }); } })
      .catch(() => { /* offline: keep last snapshot */ });
    return () => { cancelled = true; };
  }, [reelId]);

  const worst = Number(fatigue?.worst_damage) || 0;
  const life = Math.max(0, 1 - worst) * 100;
  const sh = summarize(log);
  const st = STATUS[sh.overall];
  const totalCycles = Object.values(cycles).reduce((a, b) => a + (Number(b) || 0), 0);

  return (
    <div className="aegis-cabin" data-testid="exec-dashboard">
      <header className="flex items-center gap-3 border-b border-[#22304A] px-4 py-3">
        <button type="button" className="cab-btn cab-btn-ghost" onClick={() => navigate("/hub")} aria-label="Back to hub"><ArrowLeft className="h-4 w-4" /></button>
        <div><h1 className="text-lg font-extrabold text-white">Executive Dashboard</h1><p className="text-xs text-slate-400">Well, string, operations and verification at a glance</p></div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={Activity} title="Active well state" accent="#38BDF8" testId="exec-well">
          <Big>{Math.round(currentDepth || 0).toLocaleString()} ft</Big>
          <Sub>{activeReel ? `Reel ${activeReel.name}` : "No active reel"}</Sub>
        </Tile>
        <Tile icon={HeartPulse} title="String health" accent={damageColor(worst)} testId="exec-string">
          <Big color={worst >= 0.8 ? "#EF4444" : worst >= 0.5 ? "#F59E0B" : "#22C55E"}>{life.toFixed(1)}%</Big>
          <Sub>life remaining (worst node){fatigue?.derate_warning ? " — derate warning" : ""}</Sub>
          <div className="mt-3 h-2 overflow-hidden rounded bg-[#0B1220]"><div className="h-full" style={{ width: `${life}%`, background: damageColor(worst), transition: "width 450ms" }} /></div>
        </Tile>
        <Tile icon={Gauge} title="Operational data" accent="#A78BFA" testId="exec-ops">
          <Big>{totalCycles.toLocaleString()}</Big>
          <Sub>cycles logged on this device · {pending ? `${pending} awaiting sync` : "all synced"}</Sub>
        </Tile>
        <Tile icon={ShieldCheck} title="Shadow verification" accent={st.color} testId="exec-shadow" onClick={() => navigate("/shadow")}>
          <Big color={st.color}>{st.label}</Big>
          <Sub>{enabled ? "Shadow mode ON" : "Shadow mode off"} · {sh.n} comparisons · {sh.alerts} over 2%</Sub>
        </Tile>
      </main>
    </div>
  );
}
