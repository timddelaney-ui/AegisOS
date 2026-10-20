import React from "react";
import { useNavigate } from "react-router-dom";
import { Gauge, Home, MonitorCog } from "lucide-react";
import MainOperatorScreen from "../components/MainOperatorScreen";

export default function OperatorPage() {
  const nav = useNavigate();
  const tab = "flex items-center gap-1.5 px-4 py-1.5 rounded-lg transition-colors";
  return (
    <div className="min-h-screen bg-[#070C14] text-slate-100 flex flex-col font-sans" data-testid="operator-page">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-[#0D1526] border-b border-slate-800 md:sticky md:top-0 z-40">
        <div className="flex items-center gap-3 flex-1 sm:flex-none">
          <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center font-black text-white text-xs">CA</div>
          <div>
            <span className="font-extrabold text-base text-slate-100 tracking-wide">CoilAegis OS</span>
            <div className="text-[10px] text-slate-400 font-mono">mycoiltubingpocketsupports.tech</div>
          </div>
        </div>
        <div className="flex flex-wrap bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
          <button className={`${tab} bg-amber-500 text-slate-950 font-black`} data-testid="nav-operator-view-btn">
            <Gauge className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Main Operator View (Enterprise Demo)</span><span className="sm:hidden">Operator</span>
          </button>
          <button onClick={() => nav("/hub")} title="Home Overview" className={`${tab} text-slate-400 hover:text-slate-200`} data-testid="nav-home-overview-btn">
            <Home className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Home Overview</span>
          </button>
          <button onClick={() => nav("/live-ops/classic")} title="Classic Console" className={`${tab} text-slate-400 hover:text-slate-200`} data-testid="nav-classic-console-btn">
            <MonitorCog className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Classic Console</span>
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono" data-testid="enterprise-demo-indicator">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400 font-bold">ENTERPRISE DEMO LIVE</span>
        </div>
      </header>
      <main className="flex-1">
        <MainOperatorScreen />
      </main>
    </div>
  );
}
