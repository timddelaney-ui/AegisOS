import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, API } from "../context/AuthContext";
import { Check, Star, ArrowLeft, Loader2 } from "lucide-react";
import axios from "axios";

const Pricing = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loadingPlan, setLoadingPlan] = React.useState(null);

  const subscribe = async (lookup_key) => {
    if (!user) {
      navigate("/login");
      return;
    }
    setLoadingPlan(lookup_key);
    try {
      const { data } = await axios.post(
        `${API}/payments/checkout`,
        { lookup_key, origin_url: window.location.origin },
        { withCredentials: true }
      );
      window.location.href = data.checkout_url;
    } catch (e) {
      alert("Failed to start checkout. Please try again.");
      setLoadingPlan(null);
    }
  };

  const features = [
    "All 17 operation sheets",
    "Emergency SOP protocols",
    "Imperial & Metric units",
    "Save unlimited field jobs",
    "Share jobs with your crew",
    "Live simulation diagrams",
    "API 5CT & AER Directive compliant",
  ];

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col">
      <header className="bg-[#107C41] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0">
        <button onClick={() => navigate("/app")} className="flex items-center gap-1.5 text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-sm font-semibold ml-4">Upgrade to Pro</h1>
      </header>

      <div className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-1.5 bg-[#FFF3CD] text-[#856404] px-3 py-1 rounded-full text-xs font-bold mb-3">
              <Star className="w-3.5 h-3.5 fill-[#856404]" />
              FOUNDER'S LAUNCH — LIMITED TIME
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-[#262626] mb-2">Unlock CT Workbook Pro</h2>
            <p className="text-sm text-[#595959]">Full access to every sheet, saved jobs, crew sharing, and Emergency SOPs.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white border border-[#D4D4D4] rounded-lg p-6 shadow-sm">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="text-lg font-bold text-[#262626]">Monthly</h3>
              </div>
              <div className="mb-4">
                <span className="text-4xl font-bold text-[#107C41]">$5</span>
                <span className="text-sm text-[#595959] ml-1">/ month USD</span>
              </div>
              <p className="text-xs text-[#595959] mb-4">Cancel anytime. No commitment.</p>
              <button
                onClick={() => subscribe("ct_pro_monthly")}
                disabled={loadingPlan !== null}
                className="w-full bg-white border-2 border-[#107C41] text-[#107C41] hover:bg-[#F0F9F3] py-2.5 rounded font-bold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loadingPlan === "ct_pro_monthly" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Start Monthly
              </button>
            </div>

            <div className="bg-white border-2 border-[#107C41] rounded-lg p-6 shadow-md relative">
              <div className="absolute -top-3 right-4 bg-[#107C41] text-white text-[10px] font-bold px-2 py-1 rounded">BEST VALUE</div>
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="text-lg font-bold text-[#262626]">Yearly</h3>
              </div>
              <div className="mb-4">
                <span className="text-4xl font-bold text-[#107C41]">$60</span>
                <span className="text-sm text-[#595959] ml-1">/ year USD</span>
              </div>
              <p className="text-xs text-[#595959] mb-4">One payment. Full year of access.</p>
              <button
                onClick={() => subscribe("ct_pro_yearly")}
                disabled={loadingPlan !== null}
                className="w-full bg-[#107C41] hover:bg-[#0D6535] text-white py-2.5 rounded font-bold text-sm shadow-md transition-colors flex items-center justify-center gap-2"
              >
                {loadingPlan === "ct_pro_yearly" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Start Yearly
              </button>
            </div>
          </div>

          <div className="bg-white border border-[#D4D4D4] rounded-lg p-5 mt-6">
            <h4 className="text-sm font-bold text-[#262626] mb-3">What's included:</h4>
            <ul className="grid md:grid-cols-2 gap-2">
              {features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#444]">
                  <Check className="w-4 h-4 text-[#107C41] mt-0.5 flex-shrink-0" strokeWidth={3} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] text-center text-[#595959] mt-4">
            Secure payment powered by Stripe. Test mode: use card 4242 4242 4242 4242, any future date, any CVC.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
