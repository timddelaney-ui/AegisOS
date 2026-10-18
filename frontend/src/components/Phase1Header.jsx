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
      <div className="max-w-6xl mx-auto px-3 py-2 flex items-center gap-3">
        <button
          data-testid="phase1-back-btn"
          onClick={() => nav("/hub")}
          className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 flex items-center justify-center flex-shrink-0"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm sm:text-base font-bold truncate tracking-wide">{title}</h1>
          {subtitle && <p className="text-[11px] text-white/60 truncate">{subtitle}</p>}
        </div>
        {right}
        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-white/10 px-2 py-1 rounded">
          {ROLE_LABEL[role]}
        </span>
      </div>
      {activeReel && (
        <div className="bg-black/40 border-t border-white/10 px-3 py-1.5 flex items-center gap-4 text-[11px] text-white/80 flex-wrap">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-300" />
            <span className="font-bold text-white">{activeReel.name}</span>
          </span>
          <span>Length: <span className="tabular-nums font-semibold text-white">{Math.round(activeReel.total_length_ft)} ft</span></span>
          <span>Grade: <span className="font-semibold text-white">{activeReel.intervals?.[0]?.grade || "—"}</span></span>
          <span>Depth: <span className="tabular-nums font-semibold text-white">{currentDepth} ft</span></span>
        </div>
      )}
    </div>
  );
};
