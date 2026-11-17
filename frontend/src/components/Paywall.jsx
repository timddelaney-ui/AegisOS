import React from "react";
import { Lock, Sparkles, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Paywall = ({ sheetTitle }) => {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-3">
      <div className="px-2.5 py-2 text-[11px] font-semibold rounded-r flex items-center gap-1.5 border-l-[3px] bg-[#FFF3CD] border-[#856404] text-[#856404]">
        <Lock className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
        <span>PRO FEATURE — Upgrade to unlock</span>
      </div>
      <div className="bg-white border border-[#D4D4D4] rounded-lg p-5 md:p-7 shadow-sm text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 bg-[#FFF3CD]">
          <Lock className="w-7 h-7 text-[#856404]" strokeWidth={2} />
        </div>
        <h3 className="text-lg font-bold text-[#262626] mb-1">
          {`${sheetTitle} is Pro`}
        </h3>
        <p className="text-sm text-[#595959] mb-5">
          Upgrade for advanced offline notes, personal field logs, multi-device sync, and team collaboration.
        </p>
        <div className="bg-[#F8F9FA] border border-[#D4D4D4] rounded p-4 mb-4 text-left">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-[#FF6B1A]" strokeWidth={2.5} />
            <span className="text-xs font-bold text-[#856404] uppercase">Rollout Pricing</span>
          </div>
          <p className="text-2xl font-bold text-[#FF6B1A]">$9.99 USD</p>
          <p className="text-[10px] text-[#595959]">/ user / month</p>
          <ul className="mt-4 space-y-1.5">
            {["Advanced offline notes and personal logs", "Multi-device sync", "Team and crew collaboration"].map((f) => (
              <li key={f} className="flex items-center gap-2 text-xs text-[#444]"><Check className="w-3.5 h-3.5 text-[#FF6B1A]" strokeWidth={3} />{f}</li>
            ))}
          </ul>
        </div>
        <button onClick={() => navigate("/pricing")} className="w-full bg-[#FF6B1A] hover:bg-[#C44A08] text-white py-3 rounded font-bold text-sm shadow-md flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4" strokeWidth={2.5} /> Upgrade to Pro
        </button>
      </div>
    </div>
  );
};

export default Paywall;
