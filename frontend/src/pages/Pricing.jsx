import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useAuth, API, effectivePlan } from "../context/AuthContext";

const PLANS = [
  {
    key: "free",
    name: "Free Basic",
    price: "$0",
    period: "/ month",
    description: "For individual field hands, apprentices, and students.",
    features: ["17 offline physics calculators", "Public AER / IWCF emergency SOPs", "Single-user mode; no collaboration or rig connectivity"],
  },
  {
    key: "ct_pro_monthly",
    name: "CT Field Workbook Pro",
    price: "$9.99 USD",
    period: "/ user / month",
    description: "For individual engineers, consultants, and advanced supervisors.",
    features: ["Everything in Free", "Advanced offline notes and personal field logs", "Multi-device sync", "Team and crew collaboration"],
  },
  {
    key: "field_pilot",
    name: "Field Pilot",
    price: "$2,150 CAD",
    period: "/ active month",
    standby: "$715 CAD / standby month",
    description: "For authorized regional service providers on a 60-day pilot.",
    features: ["Modbus TCP, OPC UA, WITS0, WITSML telemetry", "Mission Control and multi-pen strip charts", "Von Mises fatigue tracking", "5-channel fluid totalizers; target rigs only"],
  },
  {
    key: "fleet",
    name: "Fleet Enterprise",
    price: "Contact Sales",
    period: "5+ units",
    description: "For operations managers scaling multi-rig operations.",
    features: ["Everything in Field Pilot", "Multi-tenant RBAC and hash-chained HITL audit logs", "Rig provisioning and engineer assignments", "Fleet dashboards"],
  },
];

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState("");
  const currentPlan = effectivePlan(user);

  const subscribe = async (lookupKey) => {
    if (!user) {
      navigate("/login");
      return;
    }
    setError("");
    setLoadingPlan(lookupKey);
    try {
      const { data } = await axios.post(
        `${API}/payments/checkout`,
        { lookup_key: lookupKey, origin_url: window.location.origin },
        { withCredentials: true },
      );
      window.location.href = data.checkout_url;
    } catch (e) {
      setError(e.response?.data?.detail || "Could not start checkout. Please try again.");
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col" data-testid="pricing-page">
      <header className="bg-[#262626] text-white h-12 flex items-center px-3 flex-shrink-0">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold min-h-11">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-sm font-semibold ml-4">Aegis OS plans</h1>
      </header>
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-6">
            <h2 className="text-2xl md:text-3xl font-bold text-[#262626] mb-2">Choose your field access</h2>
            <p className="text-sm text-[#595959]">Upgrade from individual offline tools to authorized pilot and fleet operations.</p>
            {searchParams.get("from") && <p className="text-sm text-[#595959] mt-2">Upgrade to unlock {searchParams.get("from")}.</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {PLANS.map((plan) => {
              const isCurrent = (plan.key === "free" && currentPlan === "free")
                || (plan.key === "ct_pro_monthly" && currentPlan === "workbook_pro")
                || (plan.key === "field_pilot" && currentPlan === "field_pilot")
                || (plan.key === "fleet" && currentPlan === "aegis_fleet");
              const highlighted = searchParams.get("highlight") === plan.key
                || (searchParams.get("highlight") === "pro" && plan.key === "ct_pro_monthly");
              return (
                <article key={plan.key} className={`bg-white rounded-lg p-5 border flex flex-col ${highlighted ? "border-[#FF6B1A] shadow-md" : "border-[#D4D4D4]"}`}>
                  <h3 className="font-bold text-[#262626] min-h-12">{plan.name}</h3>
                  <p className="text-2xl font-bold text-[#FF6B1A]">{plan.price}</p>
                  <p className="text-xs text-[#595959] min-h-8">{plan.period}</p>
                  {plan.standby && <p className="text-xs font-semibold text-[#595959] mb-2">{plan.standby}</p>}
                  {!plan.standby && <div className="h-5 mb-2" />}
                  <p className="text-sm text-[#595959] mb-4 min-h-12">{plan.description}</p>
                  <button
                    onClick={() => plan.key === "ct_pro_monthly" ? subscribe(plan.key) : undefined}
                    disabled={!!loadingPlan || plan.key !== "ct_pro_monthly" || isCurrent}
                    data-testid={plan.key === "ct_pro_monthly" ? `subscribe-${plan.key}` : `plan-${plan.key}`}
                    className="w-full bg-[#FF6B1A] hover:bg-[#C44A08] disabled:opacity-60 text-white py-3 rounded font-bold text-sm flex items-center justify-center gap-2 min-h-11"
                  >
                    {loadingPlan === plan.key ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {isCurrent ? "Current plan" : plan.key === "ct_pro_monthly" ? "Subscribe with PayPal" : plan.key === "free" ? "Included" : "Provisioned by sales"}
                  </button>
                  <ul className="mt-4 space-y-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-[#444]">
                        <Check className="w-4 h-4 text-[#FF6B1A] mt-0.5 flex-shrink-0" strokeWidth={3} />{feature}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          {error && <p role="alert" className="text-center text-sm text-[#C00000] mt-4">{error}</p>}
        </div>
      </main>
    </div>
  );
}
