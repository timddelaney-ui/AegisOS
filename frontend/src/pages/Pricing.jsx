import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Zap, Shield, Users, ArrowLeft, Sparkles, Flame } from "lucide-react";
import CoilAegisLogo from "../components/CoilAegisLogo";

/**
 * CoilAegis Pricing — Field Beta edition.
 * All pricing is advertised but DORMANT: no checkout, no card capture. Every
 * tier CTA either continues into the app (returning user) or routes to the
 * Google sign-up (new user). A persistent amber banner at the top makes the
 * 100%-unlocked beta posture clear.
 */

const PLANS = {
  monthly: {
    pro_hand: 19.99,
    ct_unit: 99,
  },
  annual: {
    pro_hand: 179,    // 2 months free
    ct_unit: 999,     // 2 months + change
  },
};

const Pricing = () => {
  const navigate = useNavigate();
  const [billing, setBilling] = useState("annual");  // default to the better value

  const isMonthly = billing === "monthly";
  const period = isMonthly ? "/mo" : "/yr";
  const price = isMonthly ? PLANS.monthly : PLANS.annual;

  // Yearly savings badge computed from the monthly list price × 12
  const savings = (yr, mo) => {
    const full = mo * 12;
    const save = full - yr;
    const pct = Math.round((save / full) * 100);
    return { save, pct };
  };
  const proSave = savings(PLANS.annual.pro_hand, PLANS.monthly.pro_hand);
  const unitSave = savings(PLANS.annual.ct_unit, PLANS.monthly.ct_unit);

  const start = () => navigate("/hub");

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      {/* Field Beta banner */}
      <div
        data-testid="field-beta-banner"
        className="bg-[#F59E0B] text-[#0F172A] text-center py-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.15em] flex items-center justify-center gap-2"
      >
        <Flame className="w-3.5 h-3.5" strokeWidth={2.8} />
        Field Test Beta · 100% unlocked · no card required
      </div>

      {/* Header */}
      <header className="max-w-6xl mx-auto px-5 py-5 flex items-center justify-between">
        <button
          data-testid="pricing-back"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm font-semibold text-white/70 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />Back
        </button>
        <CoilAegisLogo size={26} variant="full" tone="light" />
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(245,158,11,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div
          aria-hidden
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(245,158,11,0.18) 0%, transparent 60%)" }}
        />
        <div className="relative max-w-5xl mx-auto px-5 pt-10 pb-6 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#F59E0B] mb-3">Simple pricing · rig-grade value</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight mb-4">
            Priced for the <span className="text-[#F59E0B]">doghouse</span>, built for the fleet.
          </h1>
          <p className="text-base text-white/60 max-w-2xl mx-auto leading-relaxed">
            Every tier includes the full CoilAegis platform — triaxial stress, Palmgren-Miner fatigue, live telemetry, SOPs, crew hub, timecards, and the AI assistant. The difference is scale.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="relative flex items-center justify-center gap-2 pb-10">
          <button
            data-testid="pricing-toggle-monthly"
            onClick={() => setBilling("monthly")}
            className={`text-sm font-bold px-4 py-2 rounded-lg transition-all ${isMonthly ? "bg-white text-[#0F172A]" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
          >
            Monthly
          </button>
          <button
            data-testid="pricing-toggle-annual"
            onClick={() => setBilling("annual")}
            className={`text-sm font-bold px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${!isMonthly ? "bg-white text-[#0F172A]" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
          >
            Annual
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${!isMonthly ? "bg-[#F59E0B] text-[#0F172A]" : "bg-[#F59E0B]/20 text-[#F59E0B]"}`}>
              Save 25%
            </span>
          </button>
        </div>
      </section>

      {/* Pricing cards */}
      <section className="max-w-6xl mx-auto px-5 pb-20">
        <div className="grid md:grid-cols-3 gap-5" data-testid="pricing-cards">
          {/* Card 1 — Pro Hand */}
          <article
            data-testid="plan-pro-hand"
            className="relative bg-[#111827] border border-white/10 rounded-2xl p-6 flex flex-col hover:border-[#F59E0B]/60 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-5 h-5 text-[#F59E0B]" strokeWidth={2.5} />
              <h2 className="text-lg font-extrabold tracking-tight">Pro Hand</h2>
            </div>
            <p className="text-xs text-white/55 mb-5">Solo hand or lead operator on a single rig.</p>
            <div className="mb-5">
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tabular-nums tracking-tight">${isMonthly ? price.pro_hand : price.pro_hand}</span>
                <span className="text-sm text-white/60 font-bold">{period}</span>
              </div>
              {!isMonthly && (
                <p className="text-[11px] text-[#F59E0B] font-bold mt-1">
                  Save ${proSave.save.toFixed(0)} / year ({proSave.pct}% off)
                </p>
              )}
            </div>
            <button
              data-testid="plan-pro-hand-cta"
              onClick={start}
              className="w-full py-2.5 px-4 rounded-lg font-bold text-sm bg-[#F59E0B] hover:bg-[#C36600] text-[#0F172A] transition-colors mb-5"
            >
              Start free · no card
            </button>
            <ul className="space-y-2 text-xs text-white/75">
              {[
                "Every tool, every SOP, every AI mode",
                "17 calculation sheets + 3D wellbore",
                "Treatment log + playback annotations",
                "Live telemetry · 1 rig",
                "7-day guest share links",
              ].map((f) => (
                <li key={f} className="flex gap-2"><Check className="w-3.5 h-3.5 text-[#F59E0B] flex-shrink-0 mt-0.5" /><span>{f}</span></li>
              ))}
            </ul>
          </article>

          {/* Card 2 — CT Unit Package (highlighted) */}
          <article
            data-testid="plan-ct-unit"
            className="relative bg-gradient-to-b from-[#0E7490]/40 to-[#111827] border-2 border-[#06B6D4] rounded-2xl p-6 flex flex-col shadow-[0_25px_80px_-20px_rgba(6,182,212,0.35)]"
          >
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#06B6D4] text-[#0F172A] text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full flex items-center gap-1">
              <Sparkles className="w-3 h-3" strokeWidth={3} />Most popular
            </span>
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-5 h-5 text-[#06B6D4]" strokeWidth={2.5} />
              <h2 className="text-lg font-extrabold tracking-tight">CT Unit Package</h2>
            </div>
            <p className="text-xs text-white/55 mb-5">Whole crew — tool push, day/night, swamper, trainee.</p>
            <div className="mb-5">
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tabular-nums tracking-tight">${isMonthly ? price.ct_unit : price.ct_unit}</span>
                <span className="text-sm text-white/60 font-bold">{period}</span>
              </div>
              {!isMonthly && (
                <p className="text-[11px] text-[#06B6D4] font-bold mt-1">
                  Save ${unitSave.save.toFixed(0)} / year ({unitSave.pct}% off)
                </p>
              )}
            </div>
            <button
              data-testid="plan-ct-unit-cta"
              onClick={start}
              className="w-full py-2.5 px-4 rounded-lg font-bold text-sm bg-[#06B6D4] hover:bg-[#0891B2] text-[#0F172A] transition-colors mb-5"
            >
              Start free · no card
            </button>
            <ul className="space-y-2 text-xs text-white/80">
              {[
                "Everything in Pro Hand",
                "Unlimited crew seats on 1 CT unit",
                "Shift Composer + batched timecards",
                "Rig-scoped chat, tasks, parts, certs",
                "Real DAQ listeners (WITS 0 / Modbus)",
                "Engineering job audit dossier",
              ].map((f) => (
                <li key={f} className="flex gap-2"><Check className="w-3.5 h-3.5 text-[#06B6D4] flex-shrink-0 mt-0.5" /><span>{f}</span></li>
              ))}
            </ul>
          </article>

          {/* Card 3 — Enterprise */}
          <article
            data-testid="plan-enterprise"
            className="relative bg-[#111827] border border-white/10 rounded-2xl p-6 flex flex-col hover:border-[#06B6D4]/40 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-[#06B6D4]" strokeWidth={2.5} />
              <h2 className="text-lg font-extrabold tracking-tight">Enterprise</h2>
            </div>
            <p className="text-xs text-white/55 mb-5">Multi-fleet operators, country-wide ops centres.</p>
            <div className="mb-5">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tracking-tight">Let&apos;s talk</span>
              </div>
              <p className="text-[11px] text-white/50 mt-1">Custom per-unit pricing · annual contract</p>
            </div>
            <button
              data-testid="plan-enterprise-cta"
              onClick={() => { window.location.href = "mailto:sales@coilaegis.com?subject=CoilAegis%20Enterprise%20Inquiry"; }}
              className="w-full py-2.5 px-4 rounded-lg font-bold text-sm bg-white/10 border border-white/20 hover:bg-white/20 transition-colors mb-5"
            >
              Contact sales
            </button>
            <ul className="space-y-2 text-xs text-white/75">
              {[
                "Everything in CT Unit",
                "Unlimited rigs & crews",
                "Fleet-view admin dashboard",
                "SSO (SAML / OIDC) + SCIM provisioning",
                "99.9% SLA · dedicated success rep",
                "Custom SOP / ERP training on the AI",
                "On-prem option for sensitive customers",
              ].map((f) => (
                <li key={f} className="flex gap-2"><Check className="w-3.5 h-3.5 text-[#06B6D4] flex-shrink-0 mt-0.5" /><span>{f}</span></li>
              ))}
            </ul>
          </article>
        </div>

        {/* Fine print */}
        <div className="max-w-3xl mx-auto mt-10 text-center text-[11px] text-white/40">
          <p>
            During Field Test Beta, every plan is <span className="text-[#F59E0B] font-bold">100% unlocked and free</span> while we validate against your crews.
            Pricing goes live at commercial relaunch. No card captured, no auto-charge, no surprise invoice.
          </p>
          <p className="mt-2">Advisory only — CoilAegis is an educational and computational aid. It does not supersede company policy, licensee program, or site ERP.</p>
        </div>
      </section>
    </div>
  );
};

export default Pricing;
