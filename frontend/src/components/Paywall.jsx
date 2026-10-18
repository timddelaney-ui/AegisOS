import React from "react";
import { Lock, Sparkles, Check, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Paywall = ({ sheetTitle, trialExpired = false }) => {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-3">
      <div className={`px-2.5 py-2 text-[11px] font-semibold rounded-r flex items-center gap-1.5 border-l-[3px] ${trialExpired ? "bg-[#F8D7DA] border-[#C00000] text-[#721C24]" : "bg-[#FFF3CD] border-[#856404] text-[#856404]"}`}>
        {trialExpired ? <Clock className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} /> : <Lock className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />}
        <span>{trialExpired ? "30-DAY TRIAL ENDED — Subscribe to keep working" : "PRO SHEET — Upgrade to unlock"}</span>
      </div>
      <div className="bg-white border border-[#D4D4D4] rounded-lg p-5 md:p-7 shadow-sm text-center">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${trialExpired ? "bg-[#F8D7DA]" : "bg-[#FFF3CD]"}`}>
          {trialExpired ? <Clock className="w-7 h-7 text-[#721C24]" strokeWidth={2} /> : <Lock className="w-7 h-7 text-[#856404]" strokeWidth={2} />}
        </div>
        <h3 className="text-lg font-bold text-[#262626] mb-1">
          {trialExpired ? "Your 30-day trial has ended" : `${sheetTitle} is Pro`}
        </h3>
        <p className="text-sm text-[#595959] mb-5">
          {trialExpired ? "Cheaper than a coffee — keep your workbook, saved jobs, all 17 sheets, and the AI assistant." : "Unlock this sheet plus every other operation, Emergency SOPs, AI assistant, and saved jobs across your crew."}
        </p>
        <div className="bg-[#F8F9FA] border border-[#D4D4D4] rounded p-4 mb-4 text-left">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-[#FF6B1A]" strokeWidth={2.5} />
            <span className="text-xs font-bold text-[#856404] uppercase">Rollout Pricing</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-white border border-[#D4D4D4] rounded p-2">
              <p className="text-2xl font-bold text-[#FF6B1A]">$2.99</p>
              <p className="text-[10px] text-[#595959]">per month</p>
            </div>
            <div className="bg-white border border-[#FF6B1A] rounded p-2 relative">
              <div className="absolute -top-2 right-1 bg-[#FF6B1A] text-white text-[8px] font-bold px-1 py-[1px] rounded">-30%</div>
              <p className="text-2xl font-bold text-[#FF6B1A]">$24.99</p>
              <p className="text-[10px] text-[#595959]">per year</p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5">
            {["All 17 operation sheets", "AI Field Assistant + Training mode", "Emergency SOPs & saved jobs", "Cancel anytime"].map((f) => (
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
