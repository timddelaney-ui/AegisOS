import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, ArrowLeft, Sparkles, Lock } from "lucide-react";
import CoilAegisLogo from "../components/CoilAegisLogo";
import { TIER_SPECS, TIER_ORDER } from "../lib/tiers";

/**
 * CoilAegis Pricing — three-tier edition.
 *   • Personal        — individual engineer
 *   • Small-Med Crew  — teams up to 15 (default highlight)
 *   • Enterprise      — full ops stack, custom quote
 *
 * Pricing is a real commercial flow; no demo override is active.
 */

const Pricing = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const highlight = params.get("highlight") || "smallmed";
  const fromFeature = params.get("from");
  const [billing, setBilling] = useState("annual");

  const isMonthly = billing === "monthly";

  const tiers = useMemo(() => TIER_ORDER.map((id) => TIER_SPECS[id]), []);

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-6 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          data-testid="pricing-back"
          className="text-slate-400 hover:text-white flex items-center gap-1 text-xs font-bold"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex-1 flex items-center justify-center">
          <CoilAegisLogo className="w-7 h-7 text-amber-300" />
          <span className="ml-2 font-bold text-base tracking-wide">CoilAegis</span>
        </div>
        <div className="w-16" />
      </div>

      {fromFeature && (
        <div className="max-w-6xl mx-auto px-6 pb-4">
          <div data-testid="pricing-from-feature" className="rounded-lg bg-amber-400/10 border border-amber-300/30 px-4 py-2 text-amber-200 text-xs flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span><b>{decodeURIComponent(fromFeature)}</b> is included in the <b className="text-amber-300">{TIER_SPECS[highlight]?.label || "upgraded"}</b> plan and above.</span>
          </div>
        </div>
      )}
