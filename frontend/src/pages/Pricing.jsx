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
 * All checkout is dormant during Field Test Beta (banner at the top makes
 * that explicit). The `?highlight=<tier>` query param scrolls / underlines
 * the tier a user was deep-linked for (from an upgrade CTA).
 */

const Pricing = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const highlight = params.get("highlight") || "smallmed";
  const fromFeature = params.get("from");
  const [billing, setBilling] = useState("annual");  // default to the better value

  const isMonthly = billing === "monthly";

  const tiers = useMemo(() => TIER_ORDER.map((id) => TIER_SPECS[id]), []);

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100">
      {/* Beta banner */}
      <div data-testid="pricing-demo-banner" className="bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 text-black text-center py-2 text-[11px] font-bold tracking-wide uppercase flex items-center justify-center gap-2">
        <Sparkles className="w-3.5 h-3.5" />
        Enterprise demo mode — every tier gets the full stack while the Field Beta is live
        <Sparkles className="w-3.5 h-3.5" />
      </div>

      {/* Header */}
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

      <div className="max-w-6xl mx-auto px-6 pb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-center">Pick the plan that fits your crew</h1>
        <p className="text-slate-400 text-sm text-center mt-2">Three tiers · lower plans never see what the next tier offers until you upgrade.</p>

        {/* Billing toggle */}
        <div className="flex items-center justify-center mt-6">
          <div className="inline-flex rounded-full border border-white/15 p-1 bg-black/40">
            <button
              data-testid="pricing-billing-monthly"
              onClick={() => setBilling("monthly")}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${isMonthly ? "bg-amber-400 text-black" : "text-slate-400 hover:text-white"}`}
            >Monthly</button>
            <button
              data-testid="pricing-billing-annual"
              onClick={() => setBilling("annual")}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${!isMonthly ? "bg-amber-400 text-black" : "text-slate-400 hover:text-white"}`}
            >Annual <span className="opacity-70 ml-1">(save 2 mo)</span></button>
          </div>
        </div>

        {/* Tier cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-8">
          {tiers.map((t) => {
            const isHighlighted = highlight === t.id || t.popular;
            const isCustom = t.price_monthly_usd == null;
            const price = isCustom ? null : (isMonthly ? t.price_monthly_usd : t.price_yearly_usd);
            return (
              <div
                key={t.id}
                data-testid={`pricing-tier-${t.id}`}
                className={`relative rounded-2xl overflow-hidden border-2 transition-transform ${isHighlighted ? "scale-[1.02] shadow-2xl" : "border-white/10"}`}
                style={isHighlighted ? {
                  borderColor: t.accent,
                  boxShadow: `0 10px 40px -10px ${t.glow}, 0 0 0 1px ${t.accent}30`,
                } : undefined}
              >
                {t.popular && (
                  <div className="absolute top-0 right-0 bg-amber-400 text-black text-[9px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-lg">
                    Most popular
                  </div>
                )}
                <div className="p-5 relative"
                     style={{ background: `linear-gradient(180deg, #1E293B 0%, #0F172A 100%)` }}>
                  <div className="absolute inset-0 opacity-20 pointer-events-none"
                       style={{ background: `radial-gradient(ellipse 300px 160px at 80% 20%, ${t.glow}, transparent 60%)` }} />
                  <div className="relative">
                    <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: t.accent }}>{t.label}</div>
                    <div className="text-xs text-slate-400 mt-1">{t.tagline}</div>
                    <div className="mt-4 min-h-[48px]">
                      {isCustom ? (
                        <div className="text-2xl font-bold text-white">Custom quote</div>
                      ) : (
                        <>
                          <span className="text-4xl font-bold text-white tabular-nums">${price}</span>
                          <span className="text-xs text-slate-400 ml-1">{isMonthly ? "/mo" : "/yr"}</span>
                          {!isMonthly && (
                            <div className="text-[10px] text-slate-500 mt-1">That's ~${(t.price_yearly_usd / 12).toFixed(2)}/mo billed yearly</div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">{t.seats}</div>
                    <button
                      data-testid={`pricing-tier-cta-${t.id}`}
                      onClick={() => {
                        if (isCustom) {
                          window.location.href = "mailto:sales@coilaegis.com?subject=Enterprise%20plan%20inquiry";
                        } else {
                          // Beta posture: just send them into the app — paywalls are dormant.
                          navigate("/hub");
                        }
                      }}
                      className="w-full mt-5 px-4 py-2.5 rounded-lg font-bold text-sm text-black hover:brightness-110"
                      style={{ background: t.accent }}
                    >
                      {isCustom ? "Talk to sales" : "Continue"}
                    </button>
                  </div>
                </div>
                <div className="p-5 bg-[#0A1120] space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    What's included
                  </div>
                  {t.highlights.map((h) => (
                    <div key={h} className="flex items-start gap-2 text-xs text-slate-300">
                      <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: t.accent }} />
                      <span>{h}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hide-behavior disclosure */}
        <div className="mt-8 max-w-3xl mx-auto text-center text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
          <Lock className="w-3 h-3" />
          Lower-tier plans never see what higher-tier plans offer in-app — upgrade to reveal.
        </div>
      </div>
    </div>
  );
};

export default Pricing;
