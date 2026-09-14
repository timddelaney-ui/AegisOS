import React from "react";
import { Lock, Sparkles, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Paywall = ({ sheetTitle }) => {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-[#FFF3CD] border-l-[3px] border-[#856404] px-2.5 py-2 text-[11px] font-semibold text-[#856404] rounded-r flex items-center gap-1.5">
        <Lock className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
        <span>PRO SHEET — Upgrade to unlock</span>
      </div>

      <div className="bg-white border border-[#D4D4D4] rounded-lg p-5 md:p-7 shadow-sm text-center">
        <div className="w-14 h-14 bg-[#FFF3CD] rounded-full flex items-center justify-center mx-auto mb-3">
          <Lock className="w-7 h-7 text-[#856404]" strokeWidth={2} />
        </div>
        <h3 className="text-lg font-bold text-[#262626] mb-1">{sheetTitle} is Pro</h3>
        <p className="text-sm text-[#595959] mb-5">Unlock this sheet plus every other operation, Emergency SOPs, and saved jobs across your crew.</p>

        <div className="bg-[#F8F9FA] border border-[#D4D4D4] rounded p-4 mb-4 text-left">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-[#107C41]" strokeWidth={2.5} />
            <span className="text-xs font-bold text-[#856404] uppercase">Founder's Launch</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-white border border-[#D4D4D4] rounded p-2">
              <p className="text-2xl font-bold text-[#107C41]">$5</p>
              <p className="text-[10px] text-[#595959]">per month</p>
            </div>
            <div className="bg-white border border-[#107C41] rounded p-2">
              <p className="text-2xl font-bold text-[#107C41]">$60</p>
              <p className="text-[10px] text-[#595959]">per year</p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5">
            {["All 17 operation sheets", "Emergency SOP protocols", "Save & share unlimited jobs", "Cancel anytime"].map((f, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-[#444]"><Check className="w-3.5 h-3.5 text-[#107C41]" strokeWidth={3} />{f}</li>
            ))}
          </ul>
        </div>

        <button
          onClick={() => navigate("/pricing")}
          className="w-full bg-[#107C41] hover:bg-[#0D6535] text-white py-3 rounded font-bold text-sm shadow-md flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4" strokeWidth={2.5} /> Upgrade to Pro
        </button>
      </div>
    </div>
  );
};

export default Paywall;
