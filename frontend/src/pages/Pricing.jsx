import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useAuth, API, isProUser } from "../context/AuthContext";

const PLANS = [
  { key: "ct_pro_monthly", price: "$9.99 CAD", period: "/ month", note: null },
  { key: "ct_pro_yearly", price: "$79.99 CAD", period: "/ year", note: "Save 33%", highlight: true },
];

const FEATURES = [
  "All 17 operation sheets",
  "Emergency SOPs",
  "Gemini AI Field Assistant",
  "3D Wellbore viewer, survey CSV upload & plug tracking",
  "Saved jobs and crew team workspaces",
];

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState("");

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
        <h1 className="text-sm font-semibold ml-4">CT Workbook Pro</h1>
      </header>
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-6">
            <h2 className="text-2xl md:text-3xl font-bold text-[#262626] mb-2">Unlock CT Workbook Pro</h2>
            <p className="text-sm text-[#595959]">Pay with PayPal. Cancel anytime. No tax added.</p>
          </div>
          {isProUser(user) && (
            <p className="text-center text-sm font-semibold text-[#107C41] mb-4">You already have an active Pro plan.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PLANS.map((plan) => (
              <div key={plan.key} className={`bg-white rounded-lg p-5 text-center border ${plan.highlight ? "border-[#FF6B1A] shadow-md" : "border-[#D4D4D4]"}`}>
                <p className="text-3xl font-bold text-[#FF6B1A]">{plan.price}</p>
                <p className="text-xs text-[#595959] mb-1">{plan.period}</p>
                <p className="text-xs font-bold text-[#C44A08] h-4 mb-3">{plan.note || ""}</p>
                <button
                  onClick={() => subscribe(plan.key)}
                  disabled={!!loadingPlan}
                  data-testid={`subscribe-${plan.key}`}
                  className="w-full bg-[#FF6B1A] hover:bg-[#C44A08] disabled:opacity-60 text-white py-3 rounded font-bold text-sm flex items-center justify-center gap-2 min-h-11"
                >
                  {loadingPlan === plan.key ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Subscribe with PayPal
                </button>
              </div>
            ))}
          </div>
          {error && <p role="alert" className="text-center text-sm text-[#C00000] mt-4">{error}</p>}
          <ul className="mt-6 space-y-2 max-w-md mx-auto">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-[#444]">
                <Check className="w-4 h-4 text-[#FF6B1A]" strokeWidth={3} />{f}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
