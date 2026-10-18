import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Layers } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { planRole, ROLE_LABEL } from "../lib/roles";
import { useActiveReel } from "../context/ActiveReelContext";
import CoilAegisLogo from "./CoilAegisLogo";

export const Phase1PageHeader = ({ title, subtitle, right, "data-testid": testId }) => {
  const nav = useNavigate();
  const { user } = useAuth();
  const { activeReel, currentDepth } = useActiveReel();
  const role = planRole(user);
  return (
    <div
      data-testid={testId || "phase1-header"}
      className="sticky top-0 z-10 bg-[#0D1A24] text-white border-b border-white/5"
      style={{ boxShadow: "0 1px 0 rgba(255,107,26,0.2)" }}
    >
      <div className="max-w-6xl mx-auto px-3 py-2 flex items-center gap-2">
        <button
          data-testid="phase1-back-btn"
          onClick={() => nav("/hub")}
          className="w-8 h-8 rounded bg-white/5 hover:bg-[#FF6B1A]/20 hover:text-[#FF6B1A] flex items-center justify-center flex-shrink-0 transition-colors"
          aria-label="Back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <CoilAegisLogo size={18} variant="icon" tone="light" className="hidden xs:inline-flex" />
        <div className="flex-1 min-w-0">
          <h1 className="text-[13px] font-extrabold truncate tracking-tight leading-tight">{title}</h1>
          {subtitle && <p className="text-[10px] text-white/55 truncate leading-tight tabular-nums">{subtitle}</p>}
        </div>
        {activeReel && (
          <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-white/70 whitespace-nowrap">
            <Layers className="w-3 h-3 text-[#FF6B1A]" />
            <span className="font-bold text-white">{activeReel.name}</span>
            <span className="tabular-nums">· {currentDepth} ft</span>
          </span>
        )}
        {right}
        <span
          className="hidden sm:inline-flex items-center text-[9px] font-bold uppercase bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30 px-1.5 py-0.5 rounded tracking-wider"
        >
          {ROLE_LABEL[role]}
        </span>
      </div>
    </div>
  );
};

