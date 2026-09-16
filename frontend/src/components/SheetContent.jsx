import React, { useState, useEffect, useRef, useMemo } from "react";
import { Pin, Play, Save, Sparkles, Brain } from "lucide-react";
import axios from "axios";
import { workbookData, getDefaultValue } from "../mock/workbookData";
import SaveJobDialog from "./SaveJobDialog";
import ResultsPanel from "./ResultsPanel";
import AIPanel from "./AIPanel";
import { computeResults } from "../lib/formulas";
import { useAuth, API } from "../context/AuthContext";

// Convert current sheet values to normalized Imperial numbers for the watchdog.
// Returns { rih, tagged, surfp, vann_ftmin } — undefined when not applicable.
const buildWatchdogPayload = (sheetKey, values, params, unitSystem, results) => {
  const payload = {};
  const pick = (patterns) => {
    for (let i = 0; i < params.length; i++) {
      const l = params[i].toLowerCase();
      if (patterns.some((p) => l.includes(p.toLowerCase()))) {
        const raw = parseFloat(values[i]);
        if (isNaN(raw)) return null;
        // The formulas.grab helper already normalizes to Imperial internally — we replicate the daN conversion here.
        if (unitSystem === "met") {
          if (l.includes("(dan)")) return raw * 2.24809;
          if (l.includes("(mpa)")) return raw * 145.038;
        }
        return raw;
      }
    }
    return null;
  };
  if (["CT_Milling", "CT_Drilling"].includes(sheetKey)) {
    payload.rih = pick(["run-in-hole", "run in hole"]);
    payload.tagged = pick(["weight on gauge", "tagged"]);
  }
  if (sheetKey === "Frac_Through_CT") {
    payload.surfp = pick(["treating p"]);
  }
  if (sheetKey === "Sand_Cleanout") {
    // Pull annular velocity out of computed results (Imperial ft/min).
    const row = (results?.results || []).find((r) => r.label === "Annular velocity");
    if (row && row.value !== "—") {
      const v = parseFloat(row.value);
      if (!isNaN(v)) payload.vann_ftmin = unitSystem === "met" ? v * 3.28084 : v;
    }
  }
  return payload;
};

const SheetContent = ({ sheetKey, unitSystem, onUnitChange, initialValues, hasTeam }) => {
  const data = workbookData[sheetKey];
  const params = unitSystem === "imp" ? data.imp : data.met;
  const [values, setValues] = useState({});
  const [showAlert, setShowAlert] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState("assistant");
  const canvasRef = useRef(null);
  const { user } = useAuth();

  useEffect(() => {
    if (initialValues) {
      setValues(initialValues);
      return;
    }
    const initial = {};
    params.forEach((p, i) => {
      initial[i] = getDefaultValue(p, unitSystem);
    });
    setValues(initial);
    // eslint-disable-next-line
  }, [sheetKey, unitSystem, initialValues]);

  const handleInputChange = (idx, val) => {
    setValues((prev) => ({ ...prev, [idx]: val }));
  };

  const runMacro = () => {
    setShowAlert(true);
    setTimeout(() => setShowAlert(false), 2500);
  };

  // Live compute results whenever inputs or unit system change
  const results = useMemo(
    () => computeResults(sheetKey, values, params, unitSystem),
    [sheetKey, values, params, unitSystem]
  );

  // Watchdog: debounced server-side safety-eval; fires Skipper alert into team chat.
  // Only runs when the user is on a team.
  useEffect(() => {
    if (!hasTeam) return;
    const payload = buildWatchdogPayload(sheetKey, values, params, unitSystem, results);
    const hasSignal = Object.values(payload).some((v) => v !== null && v !== undefined && !isNaN(v));
    if (!hasSignal) return;
    const t = setTimeout(() => {
      axios.post(`${API}/crew/safety-eval`, { sheet_key: sheetKey, values: payload }, { withCredentials: true }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [sheetKey, values, params, unitSystem, results, hasTeam]);

  // Build a compact context object for the AI
  const buildAIContext = () => {
    const inputSummary = {};
    params.forEach((label, i) => {
      if (values[i] !== undefined && values[i] !== "") inputSummary[label] = values[i];
    });
    const resultSummary = (results?.results || [])
      .map((r) => `${r.label}: ${r.value} ${r.unit}`)
      .join("; ");
    const warningSummary = (results?.warnings || []).map((w) => w.msg).join(" | ");
    return {
      sheet_key: sheetKey,
      sheet_title: data.title,
      unit_system: unitSystem === "imp" ? "Imperial" : "Metric",
      inputs: inputSummary,
      results: resultSummary,
      warnings: warningSummary,
    };
  };

  const openAI = (mode) => {
    setAiMode(mode);
    setAiOpen(true);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-[#E6F4EA] border-l-[3px] border-[#107C41] px-2.5 py-2 text-[11px] font-semibold text-[#0D6535] rounded-r flex items-center gap-1.5">
        <Pin className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
        <span>{data.sop}</span>
      </div>

      <div className="flex justify-between items-center bg-white px-2.5 py-1.5 border border-[#D4D4D4] rounded">
        <span className="text-xs font-semibold text-[#555]">Unit System:</span>
        <select
          value={unitSystem}
          onChange={(e) => onUnitChange(e.target.value)}
          className="bg-[#FAFAFA] border border-[#CCC] px-2 py-1 rounded-sm text-xs font-semibold outline-none focus:border-[#107C41] focus:ring-2 focus:ring-[#107C41]/10"
        >
          <option value="imp">Imperial (API / Oilfield)</option>
          <option value="met">Metric (SI / Canada)</option>
        </select>
      </div>

      <table className="w-full border-collapse bg-white border border-[#D4D4D4] rounded overflow-hidden shadow-sm">
        <thead>
          <tr>
            <th className="bg-[#F8F9FA] text-[#595959] text-[11px] font-semibold text-left px-2.5 py-2 border-b border-[#D4D4D4] w-[55%]">Parameter (Column A)</th>
            <th className="bg-[#F8F9FA] text-[#595959] text-[11px] font-semibold text-left px-2.5 py-2 border-b border-[#D4D4D4]">Input Value (Column B)</th>
          </tr>
        </thead>
        <tbody>
          {params.map((param, idx) => (
            <tr key={idx} className="border-b border-[#EFEFEF] last:border-b-0">
              <td className="px-2.5 py-2 text-[13px] font-medium text-[#444]">{param}</td>
              <td className="px-2.5 py-2">
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="-?[0-9]*[.,]?[0-9]*"
                  value={values[idx] || ""}
                  onChange={(e) => handleInputChange(idx, e.target.value)}
                  data-testid={`sheet-input-${idx}`}
                  className="w-full bg-[#FAFAFA] border border-[#CCC] px-2 py-1.5 rounded-sm text-[13px] font-semibold text-[#111] outline-none focus:border-[#107C41] focus:bg-white focus:ring-2 focus:ring-[#107C41]/10"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Live-calculated results */}
      <ResultsPanel data={results} />

      {/* AI action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => openAI("interpret")}
          className="bg-white border border-[#107C41] text-[#107C41] hover:bg-[#F0F9F3] py-2 rounded text-[12px] font-bold flex items-center justify-center gap-1.5 shadow-sm"
        >
          <Brain className="w-4 h-4" strokeWidth={2.5} /> Explain Results
        </button>
        <button
          onClick={() => openAI("program")}
          className="bg-white border border-[#107C41] text-[#107C41] hover:bg-[#F0F9F3] py-2 rounded text-[12px] font-bold flex items-center justify-center gap-1.5 shadow-sm"
        >
          <Sparkles className="w-4 h-4" strokeWidth={2.5} /> Draft Job Program
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={runMacro}
          className="col-span-3 bg-[#107C41] hover:bg-[#0D6535] active:bg-[#0D6535] text-white py-3 rounded text-[13px] font-bold uppercase shadow-md transition-colors flex items-center justify-center gap-2"
        >
          <Play className="w-4 h-4 fill-white" strokeWidth={2.5} />
          Execute Macro
        </button>
        <button
          onClick={() => setShowSaveDialog(true)}
          className="bg-white border border-[#107C41] text-[#107C41] hover:bg-[#F0F9F3] py-3 rounded text-[13px] font-bold uppercase shadow-sm transition-colors flex items-center justify-center gap-1.5"
        >
          <Save className="w-4 h-4" strokeWidth={2.5} />
          Save
        </button>
      </div>

      {showSaveDialog && (
        <SaveJobDialog
          sheetKey={sheetKey}
          sheetTitle={data.title}
          unitSystem={unitSystem}
          values={values}
          hasTeam={hasTeam}
          onClose={() => setShowSaveDialog(false)}
          onSaved={() => { /* toast could go here */ }}
        />
      )}

      {/* Floating AI trigger */}
      <button
        onClick={() => openAI("assistant")}
        className="fixed bottom-16 right-4 z-40 bg-[#107C41] hover:bg-[#0D6535] text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105"
        title="Ask CT Field AI"
      >
        <Sparkles className="w-5 h-5" strokeWidth={2.5} />
      </button>

      <AIPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        initialMode={aiMode}
        contextBuilder={buildAIContext}
      />
    </div>
  );
};

export default SheetContent;
