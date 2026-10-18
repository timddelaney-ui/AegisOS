import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "../context/AuthContext";
import { Loader2, AlertTriangle } from "lucide-react";

export default function ShareRedeemPage() {
  const { token } = useParams();
  const nav = useNavigate();
  const [error, setError] = useState(null);
  const [label, setLabel] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/share/${token}`, { withCredentials: true });
        setLabel(r.data?.label || "");
        setTimeout(() => nav(r.data?.redirect || "/live-ops", { replace: true }), 500);
      } catch (e) {
        setError(e.response?.data?.detail || "This share link is invalid or expired.");
      }
    })();
  }, [token, nav]);

  return (
    <div className="min-h-screen bg-[#0D1A24] text-white flex items-center justify-center p-6">
      <div className="bg-white/5 border border-white/10 rounded-xl p-6 max-w-sm text-center">
        {!error ? (
          <>
            <Loader2 className="w-10 h-10 mx-auto mb-3 animate-spin text-amber-300" />
            <h1 className="text-lg font-bold">Opening read-only view</h1>
            {label && <p className="text-sm text-white/70 mt-1">{label}</p>}
            <p className="text-[11px] text-white/50 mt-3">Redirecting to Live Ops…</p>
          </>
        ) : (
          <>
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-400" />
            <h1 className="text-lg font-bold">Access denied</h1>
            <p className="text-sm text-white/70 mt-1">{error}</p>
            <p className="text-[11px] text-white/50 mt-3">Ask the supervisor for a fresh link.</p>
          </>
        )}
      </div>
    </div>
  );
}
