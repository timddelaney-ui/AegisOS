import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { planRole, ROLE_LABEL } from "../lib/roles";
import { useCockpitSignals } from "../hooks/useCockpitSignals";
import * as Boundaries from "../components/ErrorBoundary";
import StripChart from "../components/cockpit/StripChart";
import EnvelopePanel from "../components/cockpit/EnvelopePanel";
import FatigueCards from "../components/cockpit/FatigueCards";
import { DirectionBadge, EncoderBanner, EncoderCounters } from "../components/cockpit/Indicators";
import JobLogWorkbook from "../components/JobLogWorkbook";

const Boundary = Boundaries.WidgetBoundary || Boundaries.default;
const RIG_KEY = "aegis_cockpit_rig_id";

function Widget({ name, children, className = "" }) {
  return (
    <section className={`bg-[#0F172A] border border-slate-700 rounded-xl p-3 ${className}`} aria-label={name}>
      <Boundary name={name}>{children}</Boundary>
    </section>
  );
}

function CommandBar({ signals }) {
  const { user } = useAuth();
  const [rig, setRig] = useState(() => { try { return localStorage.getItem(RIG_KEY) || "CT-UNIT-04"; } catch { return "CT-UNIT-04"; } });
  const role = planRole(user);
  const online = signals.connection === "CONNECTED · LIVE";
  const speed = signals.speed;
  return (
    <div className="flex flex-col gap-2" data-testid="command-bar">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="text-xs font-mono text-slate-400">ORG <b className="text-[#F8FAFC]" data-testid="org-id">{user?.org_id || user?.team_id || "—"}</b></div>
        <label className="text-xs font-mono text-slate-400">RIG
          <input value={rig} aria-label="Rig ID" onChange={(e) => { setRig(e.target.value); try { localStorage.setItem(RIG_KEY, e.target.value); } catch { /* ignore */ } }}
            className="ml-1 w-28 bg-[#0B1120] border border-slate-600 text-[#F8FAFC] rounded px-1.5 py-0.5" />
        </label>
        <span className={`px-2 py-0.5 rounded border text-xs font-mono font-bold ${online ? "border-emerald-500 text-emerald-300" : "border-amber-500 text-amber-300"}`} data-testid="conn-status">
          <span className={`inline-block w-2 h-2 rounded-full mr-1 ${online ? "bg-emerald-400" : "bg-amber-400"}`} />WS/MQTT {signals.connection}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">INJECTOR v_inj</span>
          <span className="font-mono tabular-nums text-xl font-bold text-[#F8FAFC]" data-testid="v-inj">{speed === null ? "—" : `${speed > 0 ? "+" : ""}${speed.toFixed(1)}`}</span>
          <span className="text-xs text-slate-400">ft/min</span>
          <DirectionBadge direction={signals.direction} />
        </div>
        <EncoderCounters encoders={signals.encoders} consensus={signals.consensus} />
        <span className="ml-auto px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500 text-cyan-300 text-xs font-bold" data-testid="role-badge">{ROLE_LABEL[role] || role}</span>
      </div>
      <EncoderBanner consensus={signals.consensus} />
    </div>
  );
}

export default function OperatorCockpit() {
  const signals = useCockpitSignals();
  return (
    <div className="min-h-screen bg-[#0B1120] text-[#F8FAFC] p-3 flex flex-col gap-3" data-testid="operator-cockpit">
      <Widget name="Telemetry & Command Bar"><CommandBar signals={signals} /></Widget>
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-3">
        <Widget name="Strip Chart" className="lg:col-span-7">
          <StripChart samples={signals.samples} version={signals.version} current={signals} />
        </Widget>
        <div className="lg:col-span-3 flex flex-col gap-3">
          <Widget name="Von Mises Envelope"><EnvelopePanel signals={signals} /></Widget>
          <Widget name="Fatigue"><FatigueCards signals={signals} /></Widget>
        </div>
      </div>
      <Widget name="Job Log Workbook"><JobLogWorkbook signals={signals} /></Widget>
    </div>
  );
}
