import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth, API, setSessionToken } from "../context/AuthContext";
import { FileSpreadsheet, Loader2 } from "lucide-react";

const AuthCallback = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = location.hash;
    const googleCode = hash.match(/auth_code=([^&]+)/);
    const match = googleCode || hash.match(/session_id=([^&]+)/);
    if (!match) {
      navigate("/login");
      return;
    }

    (async () => {
      try {
        const { data } = googleCode
          ? await axios.post(`${API}/auth/google/exchange`, { code: match[1] }, { withCredentials: true })
          : await axios.post(`${API}/auth/session`, { session_id: match[1] }, { withCredentials: true });
        const { session_token: sessionToken, ...profile } = data || {};
        if (sessionToken) setSessionToken(sessionToken);
        setUser(profile);
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/hub", { replace: true, state: { user: profile } });
      } catch (e) {
        setError("Sign-in failed. Please try again.");
        setTimeout(() => navigate("/login"), 2000);
      }
    })();
    // eslint-disable-next-line
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F3F3F3]">
      <div className="bg-white p-8 rounded shadow border border-[#D4D4D4] flex flex-col items-center gap-3 max-w-sm">
        <FileSpreadsheet className="w-10 h-10 text-[#FF6B1A]" strokeWidth={2} />
        {error ? (
          <p className="text-sm text-[#C00000] font-medium">{error}</p>
        ) : (
          <>
            <Loader2 className="w-6 h-6 text-[#FF6B1A] animate-spin" />
            <p className="text-sm text-[#444] font-medium">Signing you in…</p>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;
