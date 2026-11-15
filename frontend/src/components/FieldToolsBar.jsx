import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Sun, Moon, Contrast, WifiOff, Wifi, FileText, ShieldAlert, RefreshCw, Eye } from "lucide-react";
import { exportJob, drainOutbox, subscribeOutbox, setState, getStateSync } from "../lib/fieldStore";
import { getTheme, applyTheme, nextTheme } from "../lib/cabinTheme";
import { printTallySheet } from "../lib/tallySheet";
import { useShadow } from "../lib/shadow/useShadow";

const THEME_ICON = { standard: Contrast, sunlight: Sun, night: Moon };
const btn = "aegis-no-print flex items-center gap-1 px-3 py-2 rounded border-2 border-black bg-white text-black text-xs font-bold";

// Always-available field controls: sync status, cabin theme, one-tap local export, manual override.
export default function FieldToolsBar() {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pending, setPending] = useState(0);
  const [theme, setTheme] = useState(getTheme());
  const { enabled: shadowOn, setEnabled: setShadow } = useShadow();
  const [manual, setManual] = useState(() => getStateSync("manual_mode", false) === true);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const unsub = subscribeOutbox(setPending);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); unsub(); };
  }, []);

  const toggleManual = (next) => { setManual(next); setState("manual_mode", next); };
  const doExport = async (fmt) => {
    try { const d = await exportJob(fmt); toast.success(`Exported ${d.outbox.length} records + ${d.input_log.length} input-log entries (${fmt.toUpperCase()})`); }
    catch { toast.error("Export failed — storage unavailable"); }
  };
  const cycleTheme = () => setTheme(applyTheme(nextTheme(theme)));
  const ThemeIcon = THEME_ICON[theme] || Contrast;
  const tally = () => printTallySheet({
    reel: getStateSync("active_reel_snapshot", null)?.activeReel?.name || "",
    depth: getStateSync("current_depth", ""),
  });

  return (
    <>
      {manual && (
        <div data-testid="manual-mode-banner" role="alert"
          className="aegis-no-print sticky top-0 z-[70] bg-[#C00000] text-white px-3 py-2 flex flex-wrap items-center gap-2 text-sm font-bold">
          <ShieldAlert className="w-5 h-5" />
          <span className="flex-1 min-w-[200px]">MANUAL OVERRIDE MODE — Aegis numbers are advisory only. Record all readings on the paper tally sheet.</span>
          <button onClick={tally} className="px-3 py-2 rounded bg-white text-[#C00000] border-2 border-white text-xs font-bold" data-testid="print-tally">Print tally sheet</button>
          <button onClick={() => doExport("json")} className="px-3 py-2 rounded bg-white text-[#C00000] text-xs font-bold">Export job</button>
          <button onClick={() => toggleManual(false)} className="px-3 py-2 rounded border-2 border-white text-xs font-bold" data-testid="manual-exit">Exit manual mode</button>
        </div>
      )}
      <div className="aegis-no-print fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-2 z-[60] flex flex-col items-start gap-1" data-testid="field-tools">
        {open && (
          <div className="flex flex-wrap gap-1 p-2 rounded-lg bg-white border-2 border-black shadow-xl max-w-[92vw]">
            <button className={btn} onClick={() => doExport("json")} data-testid="export-json"><Download className="w-4 h-4" />Export JSON</button>
            <button className={btn} onClick={() => doExport("csv")} data-testid="export-csv"><Download className="w-4 h-4" />Export CSV</button>
            <button className={btn} onClick={cycleTheme} data-testid="theme-toggle"><ThemeIcon className="w-4 h-4" />{theme}</button>
            <button className={btn} onClick={() => drainOutbox()} data-testid="sync-now"><RefreshCw className="w-4 h-4" />Sync now</button>
            <button className={btn} onClick={tally}><FileText className="w-4 h-4" />Tally sheet</button>
            <button className={`${btn} ${shadowOn ? "!bg-[#15803D] !text-white" : ""}`} onClick={() => setShadow(!shadowOn)} data-testid="shadow-quick-toggle" aria-pressed={shadowOn}>
              <Eye className="w-4 h-4" />{shadowOn ? "Shadow ON" : "Shadow mode"}
            </button>
            <button className={`${btn} ${manual ? "!bg-[#C00000] !text-white" : ""}`} onClick={() => toggleManual(!manual)} data-testid="manual-toggle">
              <ShieldAlert className="w-4 h-4" />{manual ? "Manual ON" : "Manual mode"}
            </button>
          </div>
        )}
        <button onClick={() => setOpen(!open)} data-testid="field-tools-toggle" aria-label="Field tools"
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full border-2 border-black text-xs font-bold shadow-lg ${online ? "bg-[#1B7F3B] text-white" : "bg-[#C00000] text-white"}`}>
          {online ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          {online ? "ONLINE" : "OFFLINE"}
          {pending > 0 && <span className="bg-white text-black rounded-full px-2" data-testid="pending-count">{pending} unsynced</span>}
        </button>
      </div>
    </>
  );
}
