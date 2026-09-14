import React, { useState, useMemo } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ShieldAlert,
  Zap,
  HardHat,
  Snowflake,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Users,
  Sparkles,
} from "lucide-react";
import { emergencyProtocols, emergencyCategories } from "../mock/workbookData";
import AIPanel from "./AIPanel";

const severityStyles = {
  critical: {
    badge: "bg-[#C00000] text-white",
    label: "CRITICAL",
    cardBorder: "border-l-[#C00000]",
    cardBg: "bg-[#FFF5F5]",
  },
  high: {
    badge: "bg-[#DC7633] text-white",
    label: "HIGH",
    cardBorder: "border-l-[#DC7633]",
    cardBg: "bg-[#FEF5E7]",
  },
  medium: {
    badge: "bg-[#F1C40F] text-[#5D4E00]",
    label: "MEDIUM",
    cardBorder: "border-l-[#F1C40F]",
    cardBg: "bg-[#FEFBE7]",
  },
};

const categoryIcon = {
  "Well Control": ShieldAlert,
  HSE: HardHat,
  Equipment: Zap,
  "Winter Ops": Snowflake,
};

const EmergencyCard = ({ protocol }) => {
  const [open, setOpen] = useState(false);
  const s = severityStyles[protocol.severity] || severityStyles.medium;
  const CatIcon = categoryIcon[protocol.category] || AlertTriangle;

  return (
    <div
      className={`${s.cardBg} border border-[#E5E5E5] border-l-4 ${s.cardBorder} rounded shadow-sm overflow-hidden`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2 p-3 text-left hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex-shrink-0 mt-0.5">
          <CatIcon className="w-4 h-4 text-[#444]" strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1.5 mb-1">
            <span className={`text-[9px] font-bold px-1.5 py-[2px] rounded ${s.badge}`}>
              {s.label}
            </span>
            <span className="text-[9px] font-semibold text-[#595959] bg-white border border-[#E5E5E5] px-1.5 py-[2px] rounded">
              {protocol.category.toUpperCase()}
            </span>
          </div>
          <h3 className="text-[13px] font-bold text-[#262626] leading-snug">
            {protocol.title}
          </h3>
          <p className="text-[10px] text-[#595959] mt-1 flex items-center gap-1">
            <BookOpen className="w-2.5 h-2.5" strokeWidth={2.2} /> {protocol.reference}
          </p>
        </div>
        <div className="flex-shrink-0 mt-1 text-[#595959]">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-[#E5E5E5] bg-white p-3 space-y-3">
          <div>
            <h4 className="text-[10px] font-bold uppercase text-[#C00000] mb-1.5 flex items-center gap-1">
              <AlertOctagon className="w-3 h-3" strokeWidth={2.5} />
              Immediate Actions
            </h4>
            <ol className="space-y-1 pl-0">
              {protocol.immediate.map((step, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-[#333] leading-relaxed">
                  <span className="flex-shrink-0 w-4 h-4 rounded-sm bg-[#C00000] text-white text-[9px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h4 className="text-[10px] font-bold uppercase text-[#0D6535] mb-1.5 flex items-center gap-1">
              <Users className="w-3 h-3" strokeWidth={2.5} />
              Operator Actions · OH&amp;S / Safe Work Practice
            </h4>
            <ul className="space-y-1 pl-0">
              {protocol.operator.map((step, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-[#333] leading-relaxed">
                  <span className="flex-shrink-0 w-1 h-1 rounded-full bg-[#0D6535] mt-2" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

const EmergencySheet = () => {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [aiOpen, setAiOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return emergencyProtocols.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.reference.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [category, query]);

  const criticalCount = emergencyProtocols.filter((p) => p.severity === "critical").length;

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-[#FFC7CE] text-[#9C0006] px-3 py-2.5 rounded border border-[#F5C6CB] flex items-start gap-2">
        <AlertOctagon className="w-5 h-5 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
        <div>
          <p className="text-xs font-bold uppercase tracking-wide">
            Emergency Well Control &amp; HSE Protocols
          </p>
          <p className="text-[11px] mt-0.5">
            {emergencyProtocols.length} scenarios · {criticalCount} critical · AER / OH&amp;S / CSA aligned
          </p>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search scenarios, references, categories…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full bg-white border border-[#D4D4D4] rounded px-3 py-2 text-sm outline-none focus:border-[#107C41] focus:ring-2 focus:ring-[#107C41]/10"
      />

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        {emergencyCategories.map((cat) => {
          const isActive = category === cat;
          return (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                isActive
                  ? "bg-[#107C41] text-white border-[#107C41]"
                  : "bg-white text-[#444] border-[#D4D4D4] hover:border-[#107C41]"
              }`}
            >
              {cat}
              {cat !== "All" && (
                <span
                  className={`ml-1 text-[10px] ${isActive ? "text-white/80" : "text-[#595959]"}`}
                >
                  ({emergencyProtocols.filter((p) => p.category === cat).length})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-white border border-[#D4D4D4] rounded p-6 text-center text-sm text-[#595959]">
            No scenarios match your search.
          </div>
        ) : (
          filtered.map((p) => <EmergencyCard key={p.id} protocol={p} />)
        )}
      </div>

      <p className="text-[10px] text-[#595959] text-center mt-2 px-2 leading-relaxed">
        These protocols are guidance aligned with Alberta OH&amp;S Code, AER Directives 019 / 036 /
        037, and CSA Z662. They do not replace site-specific ERPs, JHAs, or licensee well-control
        procedures. Always follow your company's ERP and applicable jurisdiction regulations.
      </p>

      {/* Floating AI trigger for emergency scenarios */}
      <button
        onClick={() => setAiOpen(true)}
        className="fixed bottom-16 right-4 z-40 bg-[#C00000] hover:bg-[#8B0000] text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105"
        title="Ask AI about emergency scenarios"
      >
        <Sparkles className="w-5 h-5" strokeWidth={2.5} />
      </button>

      <AIPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        initialMode="emergency"
        contextBuilder={() => ({
          sheet_key: "EMERGENCY",
          sheet_title: "Emergency Well Control & HSE",
          scenarios: emergencyProtocols.map((p) => p.title).join("; "),
        })}
      />
    </div>
  );
};

export default EmergencySheet;
