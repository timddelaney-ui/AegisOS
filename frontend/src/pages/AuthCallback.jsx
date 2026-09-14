import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth, API } from "../context/AuthContext";
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
    const match = hash.match(/session_id=([^&]+)/);
    if (!match) {
      navigate("/login");
      return;
    }
    const sessionId = match[1];

    (async () => {
      try {
        const { data } = await axios.post(
          `${API}/auth/session`,
          { session_id: sessionId },
          { withCredentials: true }
        );
        setUser(data);
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/hub", { replace: true, state: { user: data } });
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
        <FileSpreadsheet className="w-10 h-10 text-[#107C41]" strokeWidth={2} />
        {error ? (
          <p className="text-sm text-[#C00000] font-medium">{error}</p>
        ) : (
          <>
            <Loader2 className="w-6 h-6 text-[#107C41] animate-spin" />
            <p className="text-sm text-[#444] font-medium">Signing you in…</p>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;
