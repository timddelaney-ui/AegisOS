import React from "react";
import {
  Calculator,
  AlertTriangle,
  AlertOctagon,
  BookOpen,
  Info,
  CheckCircle2,
} from "lucide-react";

const warningStyle = {
  danger: {
    bg: "bg-[#F8D7DA]",
    border: "border-[#C00000]",
    text: "text-[#721C24]",
    Icon: AlertOctagon,
  },
  warn: {
    bg: "bg-[#FFF3CD]",
    border: "border-[#856404]",
    text: "text-[#856404]",
    Icon: AlertTriangle,
  },
};

const ResultsPanel = ({ data }) => {
  if (!data) return null;
  const { results = [], warnings = [], formula, reference } = data;

  return (
    <div className="bg-white border border-[#D4D4D4] rounded shadow-sm">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#D4D4D4] flex items-center gap-2 bg-[#F8F9FA]">
        <Calculator className="w-3.5 h-3.5 text-[#107C41]" strokeWidth={2.5} />
        <span className="text-[11px] font-bold text-[#107C41] uppercase tracking-wide">
          Calculated Results
        </span>
        {warnings.length === 0 && results.length > 0 && (
          <span className="ml-auto text-[10px] text-[#0D6535] font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" strokeWidth={3} />
            Within safe limits
          </span>
        )}
      </div>

      {/* Warnings first */}
      {warnings.length > 0 && (
        <div className="px-3 py-2 space-y-1.5 border-b border-[#EFEFEF]">
          {warnings.map((w) => {
            const s = warningStyle[w.level] || warningStyle.warn;
            const Icon = s.Icon;
            return (
              <div
                key={`${w.level || "warn"}-${w.msg}`}
                className={`${s.bg} border-l-[3px] ${s.border} ${s.text} px-2.5 py-1.5 rounded-r flex items-start gap-2`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                <p className="text-[11px] leading-snug font-medium">{w.msg}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Results table */}
      <table className="w-full border-collapse">
        <tbody>
          {results.map((r) => (
            <tr
              key={r.label}
              className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#FAFAFA]"
            >
              <td className="px-3 py-2 text-[12px] text-[#444] font-medium align-top w-[55%]">
                {r.label}
                {r.formula && (
                  <div className="text-[10px] font-mono text-[#107C41] mt-0.5 opacity-80">
                    {r.formula}
                  </div>
                )}
                {r.note && (
                  <div className="text-[10px] text-[#595959] mt-0.5 italic">{r.note}</div>
                )}
              </td>
              <td className="px-3 py-2 text-right align-top">
                <div className="text-[13px] font-bold text-[#111] tabular-nums">
                  {r.value}
                </div>
                <div className="text-[10px] text-[#595959]">{r.unit}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Formula & Reference footer */}
      {(formula || reference) && (
        <div className="px-3 py-2 border-t border-[#D4D4D4] bg-[#F8F9FA] space-y-1">
          {formula && (
            <div className="flex items-start gap-1.5">
              <Info className="w-3 h-3 text-[#107C41] flex-shrink-0 mt-0.5" strokeWidth={2.5} />
              <p className="text-[10px] font-mono text-[#333] leading-snug">{formula}</p>
            </div>
          )}
          {reference && (
            <div className="flex items-start gap-1.5">
              <BookOpen className="w-3 h-3 text-[#595959] flex-shrink-0 mt-0.5" strokeWidth={2.5} />
              <p className="text-[10px] text-[#595959] leading-snug">{reference}</p>
            </div>
          )}
        </div>
      )}

      {/* Legal footer */}
      <div className="px-3 py-1.5 bg-[#FFFBEB] border-t border-[#F5E5A0]">
        <p className="text-[9px] text-[#856404] leading-tight">
          <strong>Advisory only.</strong> These calculations use industry-standard
          formulas and safe-limit rules of thumb. They do <strong>not</strong> replace
          engineered job programs, well-specific procedures, or licensee approvals.
          Verify against your string fatigue log, wellhead ratings, and site ERP.
        </p>
      </div>
    </div>
  );
};

export default ResultsPanel;
