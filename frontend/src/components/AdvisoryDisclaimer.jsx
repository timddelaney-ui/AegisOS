import React, { useEffect, useState } from "react";
import { AlertTriangle, X, ShieldCheck } from "lucide-react";
import { useLocation } from "react-router-dom";

const STORAGE_KEY = "ctp_disclaimer_ack_v1";

/**
 * AdvisoryDisclaimer
 * - Persistent slim footer on every screen (always visible)
 * - First-time modal that user must acknowledge (stored per-browser)
 */
export const AdvisoryFooter = () => {
  const location = useLocation();
  // Workbook has its own inline advisory strip; skip the fixed footer there to avoid overlap with SheetTabs
  if (location.pathname === "/app") return null;
  return (
    <div
      data-testid="advisory-footer"
      className="fixed bottom-0 left-0 right-0 z-40 bg-[#FFF3CD] border-t border-[#FFE69C] text-[#856404] text-[10px] leading-tight px-3 py-1 flex items-center justify-center gap-1.5 safe-bottom"
    >
      <AlertTriangle className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
      <span className="text-center">
        <strong>Advisory only.</strong> Educational & computational tool — does not supersede company policy, licensee program, or site ERP. Verify all values before field use.
      </span>
    </div>
  );
};

// Slim inline advisory strip for the Workbook page (Excel-style)
export const AdvisoryStrip = () => (
  <div
    data-testid="advisory-strip"
    className="bg-[#FFF3CD] border-b border-[#FFE69C] text-[#856404] text-[10px] leading-tight px-2 py-1 flex items-center justify-center gap-1.5 flex-shrink-0"
  >
    <AlertTriangle className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
    <span className="truncate">
      <strong>Advisory only</strong> — educational tool, does not supersede company policy or site ERP. Verify all values.
    </span>
  </div>
);

export const AdvisoryModal = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const ack = localStorage.getItem(STORAGE_KEY);
      if (!ack) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const acknowledge = () => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {}
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      data-testid="advisory-modal"
      className="fixed inset-0 bg-black/60 z-[100] flex items-end sm:items-center justify-center p-3"
    >
      <div className="bg-white w-full max-w-md rounded-lg shadow-2xl border-t-4 border-[#F59E0B] overflow-hidden">
        <div className="bg-[#FFF7ED] px-4 py-3 flex items-center gap-2 border-b border-[#FDE68A]">
          <ShieldCheck className="w-5 h-5 text-[#B45309]" strokeWidth={2.5} />
          <h2 className="text-sm font-bold text-[#7C2D12] flex-1">Safety Advisory & Use Notice</h2>
        </div>
        <div className="px-4 py-4 space-y-3 text-[12.5px] text-[#262626] leading-relaxed">
          <p>
            This app is an <strong>educational & computational aid</strong> for coiled-tubing field crews.
            It is <strong>not a licensee program, ERP, or regulator-approved procedure</strong>.
          </p>
          <ul className="list-disc pl-4 space-y-1 text-[12px]">
            <li>All calculations and AI guidance are <strong>advisory only</strong>.</li>
            <li>Nothing here supersedes your company's SOPs, JHAs, HSE policies, or licensee-approved program.</li>
            <li>Always verify inputs and results against the site-specific ERP, tool datasheet, and applicable regulations (AER, OH&S, CSA, API, IWCF).</li>
            <li>Use is at your own risk. The tool push and company man have final authority on-site.</li>
          </ul>
          <p className="text-[11px] text-[#595959] italic">
            By continuing you confirm you understand this is a support tool for safe work practices, not a substitute for training, competency, or company procedure.
          </p>
        </div>
        <div className="bg-[#F9FAFB] px-4 py-3 border-t border-[#E5E7EB] flex justify-end">
          <button
            data-testid="advisory-ack-btn"
            onClick={acknowledge}
            className="bg-[#107C41] hover:bg-[#0D6535] text-white text-sm font-bold px-4 py-2 rounded"
          >
            I understand — Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdvisoryModal;
