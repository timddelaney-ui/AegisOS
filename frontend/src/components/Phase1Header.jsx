import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Layers } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { planRole, ROLE_LABEL } from "../lib/roles";
import { useActiveReel } from "../context/ActiveReelContext";

export const Phase1PageHeader = ({ title, subtitle, right, "data-testid": testId }) => {
  const nav = useNavigate();
  const { user } = useAuth();
  const { activeReel, currentDepth } = useActiveReel();
  const role = planRole(user);
  return (
    <div data-testid={testId || "phase1-header"} className="sticky top-0 z-10 bg-[#0D1A24] text-white border-b border-black/30 shadow-sm">
      <div className="max-w-6xl mx-auto px-3 py-1.5 flex items-center gap-2">
        <button
          data-testid="phase1-back-btn"
          onClick={() => nav("/hub")}
          className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center flex-shrink-0"
          aria-label="Back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[13px] font-bold truncate tracking-wide leading-tight">{title}</h1>
          {subtitle && <p className="text-[10px] text-white/60 truncate leading-tight">{subtitle}</p>}
        </div>
        {activeReel && (
          <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-white/70 whitespace-nowrap">
            <Layers className="w-3 h-3 text-amber-300" />
            <span className="font-bold text-white">{activeReel.name}</span>
            <span className="tabular-nums">· {currentDepth} ft</span>
          </span>
        )}
        {right}
        <span className="hidden sm:inline-flex items-center text-[9px] font-bold uppercase bg-white/10 px-1.5 py-0.5 rounded tracking-wider">
          {ROLE_LABEL[role]}
        </span>
      </div>
    </div>
  );
};
