import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, FileText, FileSpreadsheet, Trash2, Database, EyeOff, Eye } from "lucide-react";
import { Switch } from "../components/ui/switch";
import DeltaBadge from "../components/shadow/DeltaBadge";
import DeltaGauge from "../components/shadow/DeltaGauge";
import ShadowCalcCard from "../components/shadow/ShadowCalcCard";
import { useShadow } from "../lib/shadow/useShadow";
import { clearLog, removeRecord } from "../lib/shadow/shadowStore";
import { CATEGORIES, STATUS, summarize, hydrostaticPsi, buoyedWeightLbf, fatigueConsumed } from "../lib/shadow/variance";
import { downloadReport } from "../lib/shadow/shadowReport";
import { collectJobData, verifyStorage } from "../lib/fieldStore";

const FATIGUE_FIELDS = [
  { key: "od", label: "Tubing OD (in)", default: "2" },
  { key: "radius", label: "Bend radius (in)", default: "72" },
  { key: "smys", label: "SMYS (psi)", default: "90000" },
  { key: "psi", label: "Internal psi", default: "0" },
  { key: "cycles", label: "Cycles", default: "100" },
];
const PRESSURE_FIELDS = [
  { key: "mw", label: "Fluid (ppg)", default: "8.6" },
  { key: "tvd", label: "TVD (ft)", default: "10000" },
];
const WEIGHT_FIELDS = [
  { key: "wpf", label: "Weight (lb/ft)", default: "2.9" },
  { key: "len", label: "Length (ft)", default: "10000" },
  { key: "mw", label: "Fluid (ppg)", default: "8.6" },
];

// Module-level so the card's memoised compute never churns.
const calcFatigue = (v) => {
  const r = fatigueConsumed({ OD_in: v.od, bend_radius_in: Number(v.radius), smys: Number(v.smys), internal_psi: Number(v.psi), cycles: v.cycles });
  return r ? r.consumed * 100 : null;
};
const calcPressure = (v) => hydrostaticPsi(v.mw, v.tvd);
const calcWeight = (v) => buoyedWeightLbf(v.wpf, v.len, v.mw);

const metaFields = [["jobId", "Job ID"], ["well", "Well"], ["client", "Client"], ["operator", "Operator"]];

export default function ShadowVerificationPage() {
  const navigate = useNavigate();
  const { settings, log, enabled, setEnabled, updateSettings, record } = useShadow();
  const [health, setHealth] = useState(null);
  const overall = summarize(log);

  useEffect(() => { verifyStorage().then(setHealth); }, [log.length]);

  const exportReport = async (kind) => {
    try {
      const data = await collectJobData();
      const telemetry = (data.input_log || []).filter((w) => !String(w.type).startsWith("shadow")).slice(-200);
      downloadReport(kind, { records: log, meta: settings, telemetry });
      toast.success(`Verification report (${kind.toUpperCase()}) generated`);
    } catch {
      toast.error("Report failed — local storage unavailable");
    }
  };

  const onRecord = (input) => {
    // Logging is explicit user action, so it works even if background mode is off.
    if (record(input, { force: true })) toast.success("Comparison logged");
    else toast.error("Enter valid numeric values");
  };

  return (
    <div className="aegis-cabin" data-testid="shadow-page">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-[#22304A] bg-[#0B1220]/95 px-4 py-3">
        <button type="button" className="cab-btn cab-btn-ghost" onClick={() => navigate("/hub")} aria-label="Back to hub"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-extrabold text-white">Shadow Mode Verification</h1>
          <p className="text-xs text-slate-400">Aegis vs legacy DAQ &amp; manual logs — variance tracking</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold">
          {enabled ? <Eye className="h-4 w-4 text-[#22C55E]" /> : <EyeOff className="h-4 w-4 text-slate-400" />}
          Shadow comparison
          <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="shadow-toggle" aria-label="Shadow comparison mode" />
        </label>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4 pb-24">
        <section className="cab-card p-4">
          <h2 className="mb-2 text-sm font-bold text-white">Job details</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {metaFields.map(([k, label]) => (
              <label key={k} className="block">
                <span className="cab-label">{label}</span>
                <input className="cab-input" value={settings[k] || ""} maxLength={60} onChange={(e) => updateSettings({ [k]: e.target.value })} data-testid={`meta-${k}`} />
              </label>
            ))}
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-3" data-testid="shadow-summary">
          {Object.entries(CATEGORIES).map(([key, c]) => {
            const s = summarize(log, key);
            return (
              <div key={key} className="cab-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-sm font-bold text-white">{c.label}</p><p className="text-xs text-slate-400">{s.n} comparisons</p></div>
                  <span className="rounded px-2 py-0.5 text-xs font-bold" style={{ color: STATUS[s.overall].color, background: STATUS[s.overall].bg }}>{STATUS[s.overall].label}</span>
                </div>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">{s.meanAbsDelta == null ? "—" : `${s.meanAbsDelta.toFixed(3)}%`}<span className="ml-2 text-xs font-normal text-slate-400">mean |Δ|</span></p>
                <DeltaGauge delta={s.meanAbsDelta} status={s.overall} />
                <p className="text-xs text-slate-400">{s.alerts} above 2% · max {s.maxAbsDelta == null ? "—" : `${s.maxAbsDelta.toFixed(2)}%`}</p>
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ShadowCalcCard category="fatigue" fields={FATIGUE_FIELDS} compute={calcFatigue} unit="% life" onRecord={onRecord} />
          <ShadowCalcCard category="pressure" fields={PRESSURE_FIELDS} compute={calcPressure} unit="psi" onRecord={onRecord} />
          <ShadowCalcCard category="weight" fields={WEIGHT_FIELDS} compute={calcWeight} unit="lbf" onRecord={onRecord} />
        </div>

        <section className="cab-card overflow-hidden" data-testid="variance-log">
          <div className="flex flex-wrap items-center gap-2 p-4">
            <h2 className="flex-1 text-sm font-bold text-white">Variance log ({log.length})</h2>
            <button type="button" className="cab-btn" onClick={() => exportReport("pdf")} data-testid="export-pdf"><FileText className="mr-1 inline h-4 w-4" />PDF report</button>
            <button type="button" className="cab-btn cab-btn-ghost" onClick={() => exportReport("csv")} data-testid="export-report-csv"><FileSpreadsheet className="mr-1 inline h-4 w-4" />CSV</button>
            <button type="button" className="cab-btn cab-btn-ghost" disabled={!log.length}
              onClick={() => { if (window.confirm("Clear the entire variance log?")) clearLog(); }} aria-label="Clear log"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-[#0B1220] text-slate-400"><tr>{["Time", "Metric", "Aegis", "Reference", "Delta", ""].map((h) => <th key={h} className="px-3 py-2 font-bold uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>
                {[...log].reverse().slice(0, 200).map((r) => (
                  <tr key={r.id} className="border-t border-[#22304A]" style={r.alert ? { background: STATUS[r.status].bg } : undefined}>
                    <td className="px-3 py-2 font-mono text-slate-300">{r.ts.slice(11, 19)}</td>
                    <td className="px-3 py-2 text-white">{r.metric}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{r.aegis.toFixed(3)} {r.unit}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{r.reference.toFixed(3)} {r.unit}</td>
                    <td className="px-3 py-2"><DeltaBadge delta={r.delta} status={r.status} /></td>
                    <td className="px-3 py-2 text-right"><button type="button" className="text-slate-400 hover:text-white" onClick={() => removeRecord(r.id)} aria-label="Remove entry"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
                {!log.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No comparisons yet. Enter a reference reading above and log it.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <p className="flex items-center gap-2 text-xs text-slate-400" data-testid="storage-health">
          <Database className="h-3.5 w-3.5" />
          Offline storage: {health ? (health.ok ? `verified (${health.backend}${health.persisted ? ", persistent" : ""})` : `FAILED (${health.backend})`) : "checking…"}
          · overall {STATUS[overall.overall].label}
        </p>
      </main>
    </div>
  );
}
