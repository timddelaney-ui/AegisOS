import React, { useState, useEffect, useRef, useMemo } from "react";
import { Pin, Play, Save, Sparkles, Brain, AlertOctagon, X } from "lucide-react";
import axios from "axios";
import { workbookData, getDefaultValue } from "../mock/workbookData";
import SaveJobDialog from "./SaveJobDialog";
import ResultsPanel from "./ResultsPanel";
import AIPanel from "./AIPanel";
import { computeResults } from "../lib/formulas";
import { useAuth, API } from "../context/AuthContext";
import { useRig } from "../context/RigContext";

// Convert current sheet values to normalized Imperial numbers for the watchdog.
// Returns { rih, tagged, surfp, vann_ftmin } — undefined when not applicable.
// Normalize any input value → Imperial for both the server watchdog and the client-side flash checks.
const buildWatchdogPayload = (sheetKey, values, params, unitSystem, results) => {
  const payload = {};
  const pick = (patterns) => {
    for (let i = 0; i < params.length; i++) {
      const l = params[i].toLowerCase();
      if (patterns.some((p) => l.includes(p.toLowerCase()))) {
        const raw = parseFloat(values[i]);
        if (isNaN(raw)) return null;
        if (unitSystem === "met") {
          if (l.includes("(dan)")) return raw * 2.24809;         // daN → lb
          if (l.includes("(mpa)")) return raw * 145.038;         // MPa → psi
          if (l.includes("(kg/m3)")) return raw / 119.826;       // kg/m³ → ppg
          if (l.includes("(l/min)")) return raw / 158.987;       // L/min → BPM
          if (l.includes("(m/hr)")) return raw * 3.28084;        // m/hr → ft/hr
        }
        return raw;
      }
    }
    return null;
  };
  if (["CT_Milling", "CT_Drilling"].includes(sheetKey)) {
    payload.rih = pick(["run-in-hole", "run in hole"]);
    payload.tagged = pick(["weight on gauge", "tagged"]);
    payload.density_ppg = pick(["density"]);
    payload.rate_bpm = pick(["pump rate"]);
  }
  if (sheetKey === "CT_Drilling") {
    payload.rop_ftph = pick(["rop"]);
  }
  if (sheetKey === "Frac_Through_CT" || sheetKey === "Annular_Frac") {
    payload.surfp = pick(["treating p"]);
    payload.density_ppg = pick(["density"]);
  }
  if (sheetKey === "Sand_Cleanout") {
    payload.rate_bpm = pick(["flow rate"]);
    const row = (results?.results || []).find((r) => r.label === "Annular velocity");
    if (row && row.value !== "—") {
      const v = parseFloat(row.value);
      if (!isNaN(v)) payload.vann_ftmin = unitSystem === "met" ? v * 3.28084 : v;
    }
  }
  return payload;
};

// Mirror of the server thresholds so we can flash a quip *instantly*
// (before the 1.5s server-side debounce fires the durable crew-channel alert).
const CLIENT_THRESHOLDS = {
  CT_Milling: [
    { id: "wob_high",   test: (v) => v.rih != null && v.tagged != null && (v.rih - v.tagged) > 2000,
      msg: "WOB > 2000 lb — sinusoidal buckling risk." },
    { id: "density_hi", test: (v) => v.density_ppg != null && v.density_ppg > 15,
      msg: "Density > 15 ppg — verify wellbore balance." },
    { id: "rate_hi",    test: (v) => v.rate_bpm != null && v.rate_bpm > 6,
      msg: "Pump rate > 6 BPM is high for milling." },
  ],
  CT_Drilling: [
    { id: "wob_high",   test: (v) => v.rih != null && v.tagged != null && (v.rih - v.tagged) > 2000,
      msg: "WOB > 2000 lb — sinusoidal buckling risk." },
    { id: "rop_hi",     test: (v) => v.rop_ftph != null && v.rop_ftph > 120,
      msg: "ROP > 120 ft/hr — cuttings load overwhelms annulus." },
  ],
  Frac_Through_CT: [
    { id: "surfp_hi",   test: (v) => v.surfp != null && v.surfp > 10000,
      msg: "Surface pressure > 10,000 psi CT working limit." },
    { id: "surfp_90",   test: (v) => v.surfp != null && v.surfp >= 9000 && v.surfp <= 10000,
      msg: "Surface pressure > 90 % of CT working limit." },
  ],
  Annular_Frac: [
    { id: "surfp_hi",   test: (v) => v.surfp != null && v.surfp > 5000,
      msg: "Annular treating pressure > 5000 psi — check burst rating." },
  ],
  Sand_Cleanout: [
    { id: "vann_low",   test: (v) => v.vann_ftmin != null && v.vann_ftmin < 90,
      msg: "Annular velocity < 90 ft/min — cuttings will fall back." },
  ],
};

const CLIENT_QUIPS = [
  "Whoa — hold up! You're about to twist that string into a pretzel. Back it off.",
  "Steady on. Ease off before the iron starts complaining.",
  "Yikes, those readings are climbing. Pop the pumps down before something goes flying.",
  "Deep breath — shut 'er in for a sec and check the gauges.",
  "That's enough — you're deep in the red. Reset and try again.",
];

const SheetContent = ({ sheetKey, unitSystem, onUnitChange, initialValues, hasTeam }) => {
  const data = workbookData[sheetKey];
  const params = unitSystem === "imp" ? data.imp : data.met;
  const [values, setValues] = useState({});
  const [showAlert, setShowAlert] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState("assistant");
  const [flashAlert, setFlashAlert] = useState(null); // { id, msg, quip, ts }
  const lastFlashRef = useRef({});
  const canvasRef = useRef(null);
  const { user } = useAuth();
  const { rigId } = useRig();

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
      axios.post(`${API}/crew/safety-eval`, { sheet_key: sheetKey, values: payload, rig_id: rigId }, { withCredentials: true }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [sheetKey, values, params, unitSystem, results, hasTeam, rigId]);

  // Client-side INSTANT flash: same threshold logic as the server, but fires immediately with
  // a client-side quip so the tool push sees the hazard before the 1.5s server round-trip.
  // Non-persistent — the durable crew-channel alert is still the server watchdog's job.
  useEffect(() => {
    const payload = buildWatchdogPayload(sheetKey, values, params, unitSystem, results);
    const rules = CLIENT_THRESHOLDS[sheetKey] || [];
    for (const rule of rules) {
      try {
        if (rule.test(payload)) {
          const last = lastFlashRef.current[rule.id] || 0;
          // Only re-flash after 15s per rule so a keystroke storm doesn't spam.
          if (Date.now() - last > 15000) {
            lastFlashRef.current[rule.id] = Date.now();
            const quip = CLIENT_QUIPS[Math.floor(Math.random() * CLIENT_QUIPS.length)];
            setFlashAlert({ id: rule.id, msg: rule.msg, quip, ts: Date.now() });
            // Auto-dismiss after 8s
            setTimeout(() => setFlashAlert((f) => (f && f.id === rule.id ? null : f)), 8000);
          }
          break; // only one flash at a time
        }
      } catch { /* ignore */ }
    }
  }, [sheetKey, values, params, unitSystem, results]);

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
      {flashAlert && (
        <div
          data-testid="skipper-flash-banner"
          className="bg-[#F8D7DA] border-2 border-[#C00000] rounded px-2.5 py-2 text-[12px] text-[#721C24] flex items-start gap-2 shadow-md animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <AlertOctagon className="w-5 h-5 flex-shrink-0 text-[#C00000]" strokeWidth={2.5} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold text-[#C00000] uppercase tracking-wider mb-0.5">SKIPPER — HAZARD</div>
            <div className="italic leading-snug mb-1">"{flashAlert.quip}"</div>
            <div className="text-[11px] font-semibold">{flashAlert.msg}</div>
          </div>
          <button
            data-testid="skipper-flash-dismiss"
            onClick={() => setFlashAlert(null)}
            className="text-[#721C24] hover:bg-[#F5C6CB] rounded p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="bg-[#FFF1E6] border-l-[3px] border-[#FF6B1A] px-2.5 py-2 text-[11px] font-semibold text-[#C44A08] rounded-r flex items-center gap-1.5">
        <Pin className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
        <span>{data.sop}</span>
      </div>

      <div className="flex justify-between items-center bg-white px-2.5 py-1.5 border border-[#D4D4D4] rounded">
        <span className="text-xs font-semibold text-[#555]">Unit System:</span>
        <select
          value={unitSystem}
          onChange={(e) => onUnitChange(e.target.value)}
          className="bg-[#FAFAFA] border border-[#CCC] px-2 py-1 rounded-sm text-xs font-semibold outline-none focus:border-[#FF6B1A] focus:ring-2 focus:ring-[#FF6B1A]/10"
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
            <tr key={param} className="border-b border-[#EFEFEF] last:border-b-0">
              <td className="px-2.5 py-2 text-[13px] font-medium text-[#444]">{param}</td>
              <td className="px-2.5 py-2">
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="-?[0-9]*[.,]?[0-9]*"
                  value={values[idx] || ""}
                  onChange={(e) => handleInputChange(idx, e.target.value)}
                  data-testid={`sheet-input-${idx}`}
                  className="w-full bg-[#FAFAFA] border border-[#CCC] px-2 py-1.5 rounded-sm text-[13px] font-semibold text-[#111] outline-none focus:border-[#FF6B1A] focus:bg-white focus:ring-2 focus:ring-[#FF6B1A]/10"
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
          className="bg-white border border-[#FF6B1A] text-[#FF6B1A] hover:bg-[#FFF7EF] py-2 rounded text-[12px] font-bold flex items-center justify-center gap-1.5 shadow-sm"
        >
          <Brain className="w-4 h-4" strokeWidth={2.5} /> Explain Results
        </button>
        <button
          onClick={() => openAI("program")}
          className="bg-white border border-[#FF6B1A] text-[#FF6B1A] hover:bg-[#FFF7EF] py-2 rounded text-[12px] font-bold flex items-center justify-center gap-1.5 shadow-sm"
        >
          <Sparkles className="w-4 h-4" strokeWidth={2.5} /> Draft Job Program
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={runMacro}
          className="col-span-3 bg-[#FF6B1A] hover:bg-[#C44A08] active:bg-[#C44A08] text-white py-3 rounded text-[13px] font-bold uppercase shadow-md transition-colors flex items-center justify-center gap-2"
        >
          <Play className="w-4 h-4 fill-white" strokeWidth={2.5} />
          Execute Macro
        </button>
        <button
          onClick={() => setShowSaveDialog(true)}
          className="bg-white border border-[#FF6B1A] text-[#FF6B1A] hover:bg-[#FFF7EF] py-3 rounded text-[13px] font-bold uppercase shadow-sm transition-colors flex items-center justify-center gap-1.5"
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
        className="fixed bottom-16 right-4 z-40 bg-[#FF6B1A] hover:bg-[#C44A08] text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105"
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
