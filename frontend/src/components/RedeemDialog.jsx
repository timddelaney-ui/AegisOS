import React, { useEffect, useState } from "react";
import { X, Loader2, Gift, CheckCircle2 } from "lucide-react";
import axios from "axios";
import { API, useAuth } from "../context/AuthContext";

/**
 * RedeemDialog — invite-code redemption modal.
 * Listens for the global "open-redeem" custom event so Hub tiles can trigger it.
 */
const RedeemDialog = () => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const { checkAuth } = useAuth();

  useEffect(() => {
    const openHandler = () => { setOpen(true); setResult(null); setError(null); setCode(""); };
    document.addEventListener("open-redeem", openHandler);
    return () => document.removeEventListener("open-redeem", openHandler);
  }, []);

  const close = () => { setOpen(false); setResult(null); setError(null); setCode(""); };

  const redeem = async () => {
    setBusy(true); setError(null); setResult(null);
    // Aggressive normalization — strip EVERYTHING that isn't A-Z or 0-9 (handles
    // em-dashes, en-dashes, non-breaking spaces, zero-width chars, spaces, the works)
    // then re-insert the canonical CT-XXXX-XXXX / OM-XXXX-XXXX shape.
    const alnum = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    // Pattern: 2 prefix letters + 8 code chars = 10 alnum total.
    let cleaned = alnum;
    if (alnum.length === 10 && /^[A-Z]{2}[A-Z0-9]{8}$/.test(alnum)) {
      cleaned = `${alnum.slice(0, 2)}-${alnum.slice(2, 6)}-${alnum.slice(6, 10)}`;
    }
    if (!cleaned) { setError("Please enter a code."); setBusy(false); return; }
    try {
      const { data } = await axios.post(`${API}/invites/redeem`, { code: cleaned }, { withCredentials: true });
      setResult(data);
      await checkAuth();
    } catch (e) {
      const detail = e.response?.data?.detail;
      const status = e.response?.status;
      if (status === 401) setError("You need to sign in first — refresh the page and log in.");
      else if (status === 404 || detail === "Invalid code") setError(`Invalid code: "${cleaned}". Watch for lookalikes: 0/O · 1/I · 8/B · 5/S · 2/Z. Ask your admin if it still won't take.`);
      else if (detail?.toLowerCase().includes("already")) setError("That code was already redeemed. Ask your admin for a fresh one.");
      else setError(detail || `Redemption failed (HTTP ${status || "?"}). Try again or contact support.`);
    }
    setBusy(false);
  };

  if (!open) return null;

  return (
    <div data-testid="redeem-dialog" className="fixed inset-0 bg-black/40 z-[70] flex items-end sm:items-center justify-center sm:p-4 dialog-sheet" onClick={close}>
      <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl max-w-md w-full dialog-sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#D4D4D4]">
          <h3 className="text-base font-bold text-[#262626] flex items-center gap-2">
            <Gift className="w-4 h-4 text-[#FF6B1A]" /> Redeem Invite Code
          </h3>
          <button data-testid="redeem-close" onClick={close} className="text-[#595959] hover:text-[#262626]"><X className="w-5 h-5" /></button>
        </div>
        {result ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-[#FF6B1A] mx-auto mb-3" strokeWidth={2} />
            <p className="text-base font-bold text-[#262626] mb-1">Pro unlocked!</p>
            <p className="text-sm text-[#595959]" data-testid="redeem-success-message">{result.message} Enjoy the workbook.</p>
            <button data-testid="redeem-close-success" onClick={close} className="mt-4 bg-[#FF6B1A] hover:bg-[#C44A08] text-white px-4 py-2 rounded font-semibold text-sm">Start using Pro</button>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-3">
              <p className="text-sm text-[#595959]">Enter the invite code shared with you (CT- for tester Pro, OM- for Ops Manager).</p>
              <input
                type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && code.trim() && !busy && redeem()}
                placeholder="CT-XXXX-XXXX or OM-XXXX-XXXX" maxLength={20}
                data-testid="redeem-code-input"
                className="w-full bg-[#FAFAFA] border border-[#CCC] px-3 py-2.5 rounded text-lg font-mono tracking-wider uppercase outline-none focus:border-[#FF6B1A] focus:ring-2 focus:ring-[#FF6B1A]/10 text-center"
              />
              {error && <p data-testid="redeem-error" className="text-xs text-[#C00000] text-center">{error}</p>}
            </div>
            <div className="px-4 py-3 border-t border-[#D4D4D4] flex justify-end gap-2">
              <button onClick={close} className="border border-[#D4D4D4] text-[#444] px-4 py-2 rounded text-sm font-semibold">Cancel</button>
              <button data-testid="redeem-submit" onClick={redeem} disabled={busy || !code.trim()} className="bg-[#FF6B1A] hover:bg-[#C44A08] text-white px-4 py-2 rounded text-sm font-semibold flex items-center gap-2 disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Redeem
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default RedeemDialog;
