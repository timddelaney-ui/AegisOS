import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Gauge, Flame, Snowflake, AlertTriangle, Info, CheckCircle2,
  Sliders, Beaker, BookOpen, RotateCcw, Share2, Copy, Printer, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { computeCTDrilling, fmtResult } from "../lib/ctdCalculator";
import ExcelHeader from "../components/ExcelHeader";
import { AdvisoryStrip } from "../components/AdvisoryDisclaimer";
import ScenarioManager from "../components/ctd/ScenarioManager";
import NitrogenPlanner from "../components/ctd/NitrogenPlanner";
import PressureDepthPlot from "../components/ctd/PressureDepthPlot";
import AIPanel from "../components/AIPanel";

// Conversions used only to translate user inputs into internal Imperial.
const conv = {
  m_to_ft: (m) => m * 3.28084,
  mm_to_in: (mm) => mm / 25.4,
  MPa_to_psi: (mpa) => mpa * 145.038,
  Lmin_to_bpm: (L) => L * 0.00628981,
  kgm3_to_ppg: (k) => k / 119.826,
  C_to_F: (c) => (c * 9) / 5 + 32,
  kPa_per_m_to_psi_per_ft: (g) => g / 22.621,
  Sm3min_to_scfm: (s) => s / 0.0283168,
};

const DEFAULT_IMP = {
  mode: "balanced",
  tvd: "5000",
  md: "5500",
  pore_grad: "0.465",         // normal pore pressure
  frac_grad: "0.80",
  ct_od: "2.375",
  ct_wall: "0.190",
  casing_id: "4.892",         // 5.5" 20# casing drift
  rop: "25",
  q_bpm: "1.5",
  rho_ppg: "8.6",
  mu_cp: "20",
  bht_F: "180",
  surf_T_F: "70",
  choke_psi: "200",
  target_UB_psi: "300",
  q_N2_scfm: "900",
};
const DEFAULT_MET = {
  mode: "balanced",
  tvd: "1524",
  md: "1676",
  pore_grad: "10.52",         // kPa/m (≈ 0.465 psi/ft)
  frac_grad: "18.1",
  ct_od: "60.3",
  ct_wall: "4.83",
  casing_id: "124.3",
  rop: "7.6",
  q_bpm: "238",               // L/min
  rho_ppg: "1030",            // kg/m³
  mu_cp: "20",
  bht_F: "82",                // °C
  surf_T_F: "21",             // °C
  choke_psi: "1.38",          // MPa
  target_UB_psi: "2.07",
  q_N2_scfm: "25.5",          // Sm³/min
};

// Convert UI values → internal imperial object
function toInternal(v, u) {
  const num = (k) => (v[k] === "" || v[k] === null || v[k] === undefined ? null : parseFloat(v[k]));
  if (u === "imp") {
    return {
      mode: v.mode,
      tvd: num("tvd"), md: num("md"),
      pore_grad: num("pore_grad"), frac_grad: num("frac_grad"),
      ct_od: num("ct_od"), ct_wall: num("ct_wall"),
      casing_id: num("casing_id"),
      rop: num("rop"),
      q_bpm: num("q_bpm"),
      rho_ppg: num("rho_ppg"),
      mu_cp: num("mu_cp"),
      bht_F: num("bht_F"), surf_T_F: num("surf_T_F"),
      choke_psi: num("choke_psi"),
      target_UB_psi: num("target_UB_psi"),
      q_N2_scfm: num("q_N2_scfm"),
    };
  }
  // Metric → Imperial
  const n = (k, fn) => (v[k] === "" || v[k] == null ? null : fn(parseFloat(v[k])));
  return {
    mode: v.mode,
    tvd: n("tvd", conv.m_to_ft),
    md: n("md", conv.m_to_ft),
    pore_grad: n("pore_grad", conv.kPa_per_m_to_psi_per_ft),
    frac_grad: n("frac_grad", conv.kPa_per_m_to_psi_per_ft),
    ct_od: n("ct_od", conv.mm_to_in),
    ct_wall: n("ct_wall", conv.mm_to_in),
    casing_id: n("casing_id", conv.mm_to_in),
    rop: n("rop", conv.m_to_ft),
    q_bpm: n("q_bpm", conv.Lmin_to_bpm),
    rho_ppg: n("rho_ppg", conv.kgm3_to_ppg),
    mu_cp: n("mu_cp", (x) => x),
    bht_F: n("bht_F", conv.C_to_F),
    surf_T_F: n("surf_T_F", conv.C_to_F),
    choke_psi: n("choke_psi", conv.MPa_to_psi),
    target_UB_psi: n("target_UB_psi", conv.MPa_to_psi),
    q_N2_scfm: n("q_N2_scfm", conv.Sm3min_to_scfm),
  };
}

const Field = ({ label, hint, children, span = 1 }) => (
  <label className={`flex flex-col ${span === 2 ? "sm:col-span-2" : ""}`}>
    <span className="text-[11px] font-semibold text-[#333] mb-0.5 leading-tight">{label}</span>
    {children}
    {hint && <span className="text-[10px] text-[#777] mt-0.5 leading-tight">{hint}</span>}
  </label>
);

const Input = (props) => (
  <input
    {...props}
    type={props.type || "number"}
    step={props.step || "any"}
    inputMode="decimal"
    className={`px-2 py-1.5 border border-[#CCC] rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B1A]/40 focus:border-[#FF6B1A] bg-white ${props.className || ""}`}
  />
);

const Section = ({ title, Icon, color, children }) => (
  <div className="bg-white border border-[#D4D4D4] rounded-xl p-3.5 shadow-sm">
    <div className="flex items-center gap-2 mb-2.5">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center ${color}`}>
        <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
      </div>
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#262626]">{title}</h3>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{children}</div>
  </div>
);

const warnStyle = (level) =>
  level === "danger" ? "bg-[#FEE2E2] border-[#F8BBBB] text-[#8B0000]"
  : level === "warn" ? "bg-[#FFF4D6] border-[#FFE69C] text-[#7A5900]"
  : "bg-[#DBEAFE] border-[#BFDBFE] text-[#0C4A6E]";

const EnvelopeBadge = ({ status }) => {
  const s = (status || "").toLowerCase();
  const isOk = s.includes("within") || s === "balanced";
  const isRisk = s.includes("loss") || s.includes("not") || s.includes("severe") || s.includes("over");
  const cls = isRisk ? "bg-[#8B0000] text-white" : isOk ? "bg-[#FF6B1A] text-white" : "bg-[#C36600] text-white";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {isRisk ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
      {status}
    </span>
  );
};

const CTDrillingCalculator = () => {
  const navigate = useNavigate();
  const [unitSystem, setUnitSystem] = useState("imp");
  const [aiOpen, setAiOpen] = useState(false);
  const [vals, setVals] = useState(DEFAULT_IMP);

  const setField = (k) => (e) => setVals((v) => ({ ...v, [k]: e.target.value }));
  const setMode = (mode) => setVals((v) => ({ ...v, mode }));

  const switchUnits = (next) => {
    if (next === unitSystem) return;
    setUnitSystem(next);
    setVals((prev) => ({ ...(next === "imp" ? DEFAULT_IMP : DEFAULT_MET), mode: prev.mode }));
  };

  const internal = useMemo(() => toInternal(vals, unitSystem), [vals, unitSystem]);
  const result = useMemo(() => computeCTDrilling(internal), [internal]);

  const bhpVal = useMemo(() => {
    const row = result.summary?.find((r) => r.key === "bhp");
    return row ? row.val : null;
  }, [result]);

  const onLoadScenario = ({ values, mode, unit_system }) => {
    // Restore unit system first so default keys line up, then overlay stored values
    const safeUnit = unit_system === "met" ? "met" : "imp";
    const baseline = safeUnit === "imp" ? DEFAULT_IMP : DEFAULT_MET;
    const next = { ...baseline, ...(values || {}), mode: mode || "balanced" };
    setUnitSystem(safeUnit);
    setVals(next);
  };

  const reset = () => setVals(unitSystem === "imp" ? DEFAULT_IMP : DEFAULT_MET);

  const copyReport = async () => {
    const lines = [];
    lines.push(`CT ${vals.mode === "balanced" ? "Balanced" : "Underbalanced"} Drilling Report`);
    lines.push(`Units: ${unitSystem === "imp" ? "Imperial" : "Metric"}`);
    lines.push(`TVD: ${vals.tvd}  MD: ${vals.md}`);
    lines.push(`---`);
    lines.push(`SUMMARY`);
    (result.summary || []).forEach((r) => {
      if (r.kind === "text") lines.push(`${r.label}: ${r.textVal || "—"}`);
      else {
        const { value, unit } = fmtResult(r.val, r.kind, unitSystem);
        lines.push(`${r.label}: ${value} ${unit}`);
      }
    });
    lines.push(`---`);
    lines.push(`DETAIL`);
    (result.detail || []).forEach((r) => {
      const { value, unit } = fmtResult(r.val, r.kind, unitSystem);
      lines.push(`${r.label}: ${value} ${unit}${r.note ? ` (${r.note})` : ""}`);
    });
    if (result.warnings?.length) {
      lines.push(`---`);
      lines.push(`FLAGS`);
      result.warnings.forEach((w) => lines.push(`[${w.level.toUpperCase()}] ${w.msg}`));
    }
    lines.push(`---`);
    lines.push(`Reference: ${result.reference || ""}`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Report copied to clipboard");
    } catch { toast.error("Clipboard blocked by browser"); }
  };

  const share = async () => {
    if (!navigator.share) return copyReport();
    try {
      await navigator.share({
        title: "CT Drilling Calculator Report",
        text: result.summary?.map((r) => {
          if (r.kind === "text") return `${r.label}: ${r.textVal}`;
          const { value, unit } = fmtResult(r.val, r.kind, unitSystem);
          return `${r.label}: ${value} ${unit}`;
        }).join("\n"),
      });
    } catch { /* user cancelled */ }
  };

  const isUBD = vals.mode === "underbalanced";

  // Labels change with units
  const L = unitSystem === "imp"
    ? {
        tvd: "TVD (ft)", md: "MD (ft)", pore_grad: "Pore gradient (psi/ft)", frac_grad: "Frac gradient (psi/ft)",
        ct_od: "CT OD (in)", ct_wall: "CT wall (in)", casing_id: "Hole / casing ID (in)",
        rop: "ROP (ft/hr)", q_bpm: "Liquid rate (BPM)", rho_ppg: "Fluid density (ppg)",
        mu_cp: "Viscosity (cp)", bht_F: "BHT (°F)", surf_T_F: "Surface temp (°F)",
        choke_psi: "Choke back-pressure (psi)", target_UB_psi: "Target underbalance (psi)",
        q_N2_scfm: "N₂ injection rate (SCFM)",
      }
    : {
        tvd: "TVD (m)", md: "MD (m)", pore_grad: "Pore gradient (kPa/m)", frac_grad: "Frac gradient (kPa/m)",
        ct_od: "CT OD (mm)", ct_wall: "CT wall (mm)", casing_id: "Hole / casing ID (mm)",
        rop: "ROP (m/hr)", q_bpm: "Liquid rate (L/min)", rho_ppg: "Fluid density (kg/m³)",
        mu_cp: "Viscosity (cp)", bht_F: "BHT (°C)", surf_T_F: "Surface temp (°C)",
        choke_psi: "Choke back-pressure (MPa)", target_UB_psi: "Target underbalance (MPa)",
        q_N2_scfm: "N₂ injection rate (Sm³/min)",
      };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F3F3F3] to-[#E8ECEF] flex flex-col print:bg-white">
      <div className="print:hidden">
        <ExcelHeader />
        <AdvisoryStrip />
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b border-[#D4D4D4] px-3 py-2 flex items-center gap-2 sticky top-0 z-10 print:hidden">
        <button
          data-testid="ctd-back-btn"
          onClick={() => navigate("/hub")}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#595959] hover:text-[#FF6B1A]"
        >
          <ArrowLeft className="w-4 h-4" /> Hub
        </button>
        <div className="w-px h-5 bg-[#D4D4D4]" />
        <h1 className="text-[13px] sm:text-sm font-bold text-[#262626] flex-1 truncate">
          CT Drilling Calculator <span className="hidden sm:inline text-[#595959] font-normal">— Balanced / Underbalanced</span>
        </h1>
        <button
          data-testid="ctd-ai-sop-btn"
          onClick={() => setAiOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#FF6B1A] text-white text-[11px] font-bold hover:bg-[#C44A08] shadow-sm"
          title="Scenario-specific SOP + Safe Work + ERP guidance (AER / API / OH&S / CSA / IWCF)"
        >
          <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2.6} />
          <span className="hidden sm:inline">SOP / ERP AI</span>
          <span className="sm:hidden">AI</span>
        </button>
        <div className="flex items-center bg-[#F0F0F0] rounded-md p-0.5">
          <button
            data-testid="ctd-unit-imp"
            onClick={() => switchUnits("imp")}
            className={`px-2 py-1 text-[11px] font-bold rounded ${unitSystem === "imp" ? "bg-white shadow-sm text-[#FF6B1A]" : "text-[#595959]"}`}
          >IMP</button>
          <button
            data-testid="ctd-unit-met"
            onClick={() => switchUnits("met")}
            className={`px-2 py-1 text-[11px] font-bold rounded ${unitSystem === "met" ? "bg-white shadow-sm text-[#FF6B1A]" : "text-[#595959]"}`}
          >MET</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-10">
        <div className="max-w-4xl mx-auto p-3 space-y-3">
          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              data-testid="ctd-mode-balanced"
              onClick={() => setMode("balanced")}
              className={`rounded-xl p-3 border-2 text-left transition-all ${
                vals.mode === "balanced"
                  ? "bg-[#FFF1E6] border-[#FF6B1A] shadow-md"
                  : "bg-white border-[#D4D4D4] hover:border-[#FF6B1A]/60"
              }`}
            >
              <div className="flex items-start gap-2">
                <Gauge className={`w-5 h-5 ${vals.mode === "balanced" ? "text-[#C44A08]" : "text-[#595959]"}`} strokeWidth={2.4} />
                <div>
                  <p className="text-sm font-bold text-[#262626]">Balanced / Overbalanced</p>
                  <p className="text-[11px] text-[#595959] leading-snug">Single-phase mud. BHP ≥ pore pressure. Mud-weight window check.</p>
                </div>
              </div>
            </button>
            <button
              data-testid="ctd-mode-ubd"
              onClick={() => setMode("underbalanced")}
              className={`rounded-xl p-3 border-2 text-left transition-all ${
                vals.mode === "underbalanced"
                  ? "bg-[#FDE8E8] border-[#C00000] shadow-md"
                  : "bg-white border-[#D4D4D4] hover:border-[#C00000]/60"
              }`}
            >
              <div className="flex items-start gap-2">
                <Flame className={`w-5 h-5 ${vals.mode === "underbalanced" ? "text-[#C00000]" : "text-[#595959]"}`} strokeWidth={2.4} />
                <div>
                  <p className="text-sm font-bold text-[#262626]">Underbalanced (N₂ gasified)</p>
                  <p className="text-[11px] text-[#595959] leading-snug">Two-phase BHP via 10-segment marching. GLR, choke & UB-margin solve.</p>
                </div>
              </div>
            </button>
          </div>

          {/* Inputs */}
          <Section title="Well geometry" Icon={BookOpen} color="bg-[#DBEAFE] text-[#0056B3]">
            <Field label={L.tvd}><Input data-testid="ctd-tvd" value={vals.tvd} onChange={setField("tvd")} /></Field>
            <Field label={L.md} hint="Measured depth = TVD for vertical wells."><Input data-testid="ctd-md" value={vals.md} onChange={setField("md")} /></Field>
            <Field label={L.pore_grad} hint={unitSystem === "imp" ? "Normal ≈ 0.465 psi/ft" : "Normal ≈ 10.5 kPa/m"}>
              <Input data-testid="ctd-pore" value={vals.pore_grad} onChange={setField("pore_grad")} />
            </Field>
            <Field label={L.frac_grad} hint={unitSystem === "imp" ? "Typical 0.70–0.90 psi/ft" : "Typical 15–20 kPa/m"}>
              <Input data-testid="ctd-frac" value={vals.frac_grad} onChange={setField("frac_grad")} />
            </Field>
            <Field label={L.casing_id} hint="Open hole or production casing drift ID">
              <Input data-testid="ctd-casing" value={vals.casing_id} onChange={setField("casing_id")} />
            </Field>
            <Field label={L.rop} hint="Expected rate of penetration during drill-out">
              <Input data-testid="ctd-rop" value={vals.rop} onChange={setField("rop")} />
            </Field>
          </Section>

          <Section title="CT string" Icon={Sliders} color="bg-[#FCE7C0] text-[#C36600]">
            <Field label={L.ct_od}><Input data-testid="ctd-ct-od" value={vals.ct_od} onChange={setField("ct_od")} /></Field>
            <Field label={L.ct_wall}><Input data-testid="ctd-ct-wall" value={vals.ct_wall} onChange={setField("ct_wall")} /></Field>
          </Section>

          <Section title="Fluid & pumps" Icon={Beaker} color="bg-[#FFF1E6] text-[#C44A08]">
            <Field label={L.q_bpm}><Input data-testid="ctd-qbpm" value={vals.q_bpm} onChange={setField("q_bpm")} /></Field>
            <Field label={L.rho_ppg}><Input data-testid="ctd-rho" value={vals.rho_ppg} onChange={setField("rho_ppg")} /></Field>
            <Field label={L.mu_cp} hint="Effective at pump rate; 10–50 cp typical for CTD fluids">
              <Input data-testid="ctd-mu" value={vals.mu_cp} onChange={setField("mu_cp")} />
            </Field>
            <Field label={L.bht_F}><Input data-testid="ctd-bht" value={vals.bht_F} onChange={setField("bht_F")} /></Field>
          </Section>

          {isUBD && (
            <Section title="Underbalanced controls" Icon={Snowflake} color="bg-[#FDE8E8] text-[#C00000]">
              <Field label={L.q_N2_scfm} hint="Nitrogen injected at surface (standard conditions)">
                <Input data-testid="ctd-n2" value={vals.q_N2_scfm} onChange={setField("q_N2_scfm")} />
              </Field>
              <Field label={L.choke_psi} hint="Surface choke / separator back-pressure">
                <Input data-testid="ctd-choke" value={vals.choke_psi} onChange={setField("choke_psi")} />
              </Field>
              <Field label={L.target_UB_psi} hint="Desired BHP below pore pressure (300–500 psi typical)">
                <Input data-testid="ctd-ub-target" value={vals.target_UB_psi} onChange={setField("target_UB_psi")} />
              </Field>
              <Field label={L.surf_T_F} hint="Ambient / rig-floor temperature">
                <Input data-testid="ctd-surft" value={vals.surf_T_F} onChange={setField("surf_T_F")} />
              </Field>
            </Section>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap print:hidden">
            <ScenarioManager currentVals={vals} unitSystem={unitSystem} onLoad={onLoadScenario} />
            <button
              data-testid="ctd-reset-btn"
              onClick={reset}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-semibold border border-[#D4D4D4] bg-white hover:border-[#FF6B1A] hover:text-[#FF6B1A]"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset defaults
            </button>
            <button
              data-testid="ctd-copy-btn"
              onClick={copyReport}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-semibold border border-[#D4D4D4] bg-white hover:border-[#FF6B1A] hover:text-[#FF6B1A]"
            >
              <Copy className="w-3.5 h-3.5" /> Copy report
            </button>
            <button
              data-testid="ctd-share-btn"
              onClick={share}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-semibold border border-[#D4D4D4] bg-white hover:border-[#FF6B1A] hover:text-[#FF6B1A]"
            >
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
            <button
              data-testid="ctd-print-btn"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-semibold border border-[#D4D4D4] bg-white hover:border-[#FF6B1A] hover:text-[#FF6B1A]"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>

          {/* Results */}
          <div className="bg-white border border-[#D4D4D4] rounded-xl shadow-sm overflow-hidden" data-testid="ctd-results-panel">
            <div className={`px-4 py-2 flex items-center justify-between ${isUBD ? "bg-[#FDE8E8]" : "bg-[#FFF1E6]"}`}>
              <h3 className="text-[13px] font-bold text-[#262626] flex items-center gap-2">
                <Gauge className="w-4 h-4" />
                {isUBD ? "Underbalanced drilling results" : "Balanced drilling results"}
              </h3>
              {(() => {
                const env = result.summary?.find((r) => r.label?.toLowerCase().includes("envelope"));
                return env ? <EnvelopeBadge status={env.textVal} /> : null;
              })()}
            </div>

            {/* Headline cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 bg-[#FAFAFA]">
              {(result.summary || []).filter((r) => r.kind !== "text").slice(0, 6).map((r, i) => {
                const { value, unit } = fmtResult(r.val, r.kind, unitSystem);
                return (
                  <div key={i} data-testid={`ctd-result-${r.key || i}`} className="bg-white border border-[#E4E4E4] rounded-lg p-2.5">
                    <p className="text-[10px] font-semibold text-[#595959] uppercase leading-tight">{r.label}</p>
                    <p className="text-lg font-bold text-[#262626] tabular-nums leading-tight mt-0.5">
                      {value} <span className="text-[11px] font-semibold text-[#595959]">{unit}</span>
                    </p>
                    {r.note && <p className={`text-[10px] mt-0.5 font-semibold ${r.note.includes("UNDER") || r.note.includes("LOSS") || r.note.includes("NOT") ? "text-[#8B0000]" : "text-[#C44A08]"}`}>{r.note}</p>}
                    {r.formula && <p className="text-[9px] text-[#777] mt-0.5 italic truncate">{r.formula}</p>}
                  </div>
                );
              })}
            </div>

            {/* Detail table */}
            <div className="divide-y divide-[#EEE]">
              {(result.detail || []).map((r, i) => {
                const { value, unit } = fmtResult(r.val, r.kind, unitSystem);
                return (
                  <div key={i} className="flex items-center justify-between px-4 py-2 text-[12px]">
                    <span className="text-[#333]">{r.label}</span>
                    <span className="font-semibold tabular-nums text-[#262626]">
                      {value} <span className="text-[#595959] font-normal">{unit}</span>
                      {r.note && <span className={`ml-2 text-[10px] px-1.5 py-[1px] rounded ${r.note.includes("RAISE") || r.note.includes("LOWER") ? "bg-[#FFF4D6] text-[#7A5900]" : "bg-[#F0F0F0] text-[#595959]"}`}>{r.note}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Warnings */}
          {result.warnings?.length > 0 && (
            <div className="space-y-2" data-testid="ctd-warnings">
              {result.warnings.map((w, i) => (
                <div key={i} className={`border rounded-lg px-3 py-2 flex items-start gap-2 ${warnStyle(w.level)}`}>
                  {w.level === "danger" ? <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                  <p className="text-[12px] leading-snug font-medium">{w.msg}</p>
                </div>
              ))}
            </div>
          )}

          {/* Pressure vs Depth plot */}
          <PressureDepthPlot
            tvd_ft={internal.tvd}
            pore_grad_psi_ft={internal.pore_grad}
            frac_grad_psi_ft={internal.frac_grad}
            bhp_psi={bhpVal}
            surf_choke_psi={isUBD ? (internal.choke_psi || 0) : 0}
            unitSystem={unitSystem}
            isUBD={isUBD}
          />

          {/* Nitrogen & liquid volume planner */}
          <NitrogenPlanner
            q_N2_scfm_imp={isUBD ? internal.q_N2_scfm : 0}
            q_liq_bpm_imp={internal.q_bpm}
            unitSystem={unitSystem}
            isUBD={isUBD}
          />

          {/* Formulas footer */}
          <div className="bg-white border border-[#D4D4D4] rounded-xl p-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase text-[#595959] mb-1 tracking-wide">Formulas used</p>
            <ul className="space-y-0.5">
              {(result.formulas || []).map((f, i) => (
                <li key={i} className="text-[11px] text-[#333] font-mono">• {f}</li>
              ))}
            </ul>
            <p className="text-[10px] text-[#777] mt-2 italic">Reference: {result.reference || "—"}</p>
          </div>

          <p className="text-[10px] text-center text-[#595959] py-2">
            Advisory only · Verify against site ERP, cementing program, and licensee drilling plan ·
            Independent verification required for UBD operations (AER Directive 008 §4).
          </p>
        </div>
      </div>

      <AIPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        initialMode="sop_erp"
        contextBuilder={() => {
          const summaryText = (result.summary || []).map((r) => {
            if (r.kind === "text") return `${r.label}: ${r.textVal || "—"}`;
            const { value, unit } = fmtResult(r.val, r.kind, unitSystem);
            return `${r.label}: ${value} ${unit}`;
          }).join("; ");
          const warningsText = (result.warnings || []).map((w) => `[${w.level}] ${w.msg}`).join(" | ");
          return {
            sheet_key: "CT_DRILLING_CALC",
            sheet_title: vals.mode === "underbalanced"
              ? "CT Underbalanced Drilling Calculator"
              : "CT Balanced Drilling Calculator",
            drilling_mode: vals.mode,
            unit_system: unitSystem,
            inputs: JSON.stringify(vals),
            results: summaryText,
            warnings: warningsText,
            standards_focus: vals.mode === "underbalanced"
              ? "AER Directive 008 (UBD/MPD), IADC UBO/MPD Handbook, API RP 5C7, OH&S Code Part 4, AER Dir 019, CSA Z662"
              : "API RP 5C7, AER Directive 037, OH&S Code, AER Dir 019, CSA Z662, IWCF WellCAP",
          };
        }}
      />

      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .print\\:bg-white { background: white !important; }
          [data-testid="ctd-results-panel"],
          [data-testid="ctd-depth-plot"],
          [data-testid="ctd-nitrogen-planner"],
          [data-testid="ctd-warnings"] {
            break-inside: avoid;
            page-break-inside: avoid;
            box-shadow: none !important;
          }
          .shadow-sm, .shadow-md { box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
};

export default CTDrillingCalculator;
