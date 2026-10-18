import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "../context/AuthContext";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export const PaymentSuccess = () => {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [status, setStatus] = useState("polling");
  const [attempts, setAttempts] = useState(0);
  const navigate = useNavigate();
  const { checkAuth } = useAuth();

  useEffect(() => {
    if (!sessionId) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await axios.get(`${API}/payments/status/${sessionId}`);
        if (data.payment_status === "paid") {
          if (!cancelled) {
            setStatus("paid");
            await checkAuth();
            setTimeout(() => navigate("/app"), 2500);
          }
          return;
        }
        if (data.payment_status === "failed" || data.payment_status === "expired") {
          if (!cancelled) setStatus("failed");
          return;
        }
      } catch (e) {
        // Transient — will retry on the next tick; only warn to avoid noisy console during retries.
        console.debug("Payment status poll failed (will retry):", e?.response?.status || e?.message);
      }
      if (attempts >= 20) {
        if (!cancelled) setStatus("timeout");
        return;
      }
      setTimeout(() => setAttempts((a) => a + 1), 2000);
    };
    poll();
    return () => { cancelled = true; };
  }, [attempts, sessionId, navigate, checkAuth]);

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex items-center justify-center p-4">
      <div className="bg-white border border-[#D4D4D4] rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        {status === "polling" && (
          <>
            <Loader2 className="w-12 h-12 text-[#FF6B1A] animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-bold text-[#262626] mb-2">Confirming your payment…</h2>
            <p className="text-sm text-[#595959]">This takes a few seconds. Please don't close this page.</p>
          </>
        )}
        {status === "paid" && (
          <>
            <CheckCircle2 className="w-14 h-14 text-[#FF6B1A] mx-auto mb-4" strokeWidth={2} />
            <h2 className="text-lg font-bold text-[#262626] mb-2">You're in!</h2>
            <p className="text-sm text-[#595959] mb-4">Your subscription is active. Redirecting you to the workbook…</p>
          </>
        )}
        {(status === "failed" || status === "error" || status === "timeout") && (
          <>
            <XCircle className="w-14 h-14 text-[#C00000] mx-auto mb-4" strokeWidth={2} />
            <h2 className="text-lg font-bold text-[#262626] mb-2">Payment not confirmed</h2>
            <p className="text-sm text-[#595959] mb-4">If you were charged, refresh in a moment. Otherwise please try again.</p>
            <button onClick={() => navigate("/pricing")} className="bg-[#FF6B1A] hover:bg-[#C44A08] text-white px-4 py-2 rounded font-semibold text-sm">Back to Pricing</button>
          </>
        )}
      </div>
    </div>
  );
};

export const PaymentCancel = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[#F3F3F3] flex items-center justify-center p-4">
      <div className="bg-white border border-[#D4D4D4] rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        <XCircle className="w-14 h-14 text-[#595959] mx-auto mb-4" strokeWidth={2} />
        <h2 className="text-lg font-bold text-[#262626] mb-2">Payment canceled</h2>
        <p className="text-sm text-[#595959] mb-4">No charge was made. You can subscribe anytime.</p>
        <button onClick={() => navigate("/pricing")} className="bg-[#FF6B1A] hover:bg-[#C44A08] text-white px-4 py-2 rounded font-semibold text-sm">Back to Pricing</button>
      </div>
    </div>
  );
};
