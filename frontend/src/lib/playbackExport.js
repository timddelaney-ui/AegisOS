// Playback window export — CSV + LAS 2.0 (ASCII well-log standard).
// Client-side: no server round-trip, works offline.
// Supports timeline annotations (manual + rig-computer) embedded in both formats.

const COLS = [
  { key: "ts",                      label: "TIME",     unit: "ISO",   mnem: "TIME" },
  { key: "depth_ft",                label: "DEPTH",    unit: "FT",    mnem: "DEPT" },
  { key: "weight_lb",               label: "WEIGHT",   unit: "LBF",   mnem: "WOH" },
  { key: "p_internal_psi",          label: "P_INT",    unit: "PSI",   mnem: "SPP" },
  { key: "p_external_psi",          label: "P_EXT",    unit: "PSI",   mnem: "ANN" },
  { key: "traction_pressure_psi",   label: "TRACTION", unit: "PSI",   mnem: "TRAC" },
  { key: "axial_force_lbf",         label: "F_AXIAL",  unit: "LBF",   mnem: "FAX" },
  { key: "pressure_psi",            label: "P_SURF",   unit: "PSI",   mnem: "PSRF" },
];

const fmt = (v) => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isFinite(v) ? v.toFixed(2) : "";
  return String(v);
};

// CSV-safe quoting: wrap in quotes and double-up any inner quotes.
const q = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return `"${s}"`;
};

// Filter annotations to the window spanned by `samples`.
function annotationsInWindow(annotations, samples) {
  if (!annotations?.length || !samples?.length) return [];
  const firstTs = Date.parse(samples[0].ts || samples[0].created_at || Date.now());
  const lastTs = Date.parse(samples[samples.length - 1].ts || samples[samples.length - 1].created_at || Date.now());
  const lo = Math.min(firstTs, lastTs);
  const hi = Math.max(firstTs, lastTs);
  return annotations.filter((a) => a.timestamp_ms >= lo && a.timestamp_ms <= hi);
}

export function samplesToCSV(samples, annotations = []) {
  const header = COLS.map((c) => `${c.label}_${c.unit}`).join(",");
  const rows = samples.map((s) =>
    COLS.map((c) => {
      if (c.key === "ts") return fmt(s.ts || s.created_at || "");
      return fmt(s[c.key]);
    }).join(",")
  );
  const inWindow = annotationsInWindow(annotations, samples);
  const annotBlock = [];
  if (inWindow.length) {
    annotBlock.push("");
    annotBlock.push("# ANNOTATIONS");
    annotBlock.push(["TIMESTAMP_ISO", "SOURCE", "SEVERITY", "AUTHOR", "CHANNEL", "VALUE", "DEPTH_FT", "NOTE"].join(","));
    inWindow.forEach((a) => {
      annotBlock.push([
        q(new Date(a.timestamp_ms).toISOString()),
        q(a.source || "manual"),
        q(a.severity || "info"),
        q(a.author_name || ""),
        q(a.channel || ""),
        fmt(a.value),
        fmt(a.depth_ft),
        q(a.note || ""),
      ].join(","));
    });
  }
  return [header, ...rows, ...annotBlock].join("\n");
}

// LAS 2.0 — Canadian Well Logging Society public spec.
// Header + ~A ascii data section. Null value = -999.25
export function samplesToLAS(samples, meta = {}, annotations = []) {
  const nullv = -999.25;
  const first = samples[0] || {};
  const last = samples[samples.length - 1] || {};
  const startDepth = Number(first.depth_ft) || 0;
  const stopDepth = Number(last.depth_ft) || 0;
  const step = samples.length > 1 ? (stopDepth - startDepth) / (samples.length - 1) : 0;

  const now = new Date().toISOString().slice(0, 10);
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);

  const lines = [];
  lines.push("~Version Information");
  lines.push("VERS.                 2.0 : CWLS LOG ASCII STANDARD -VERSION 2.0");
  lines.push("WRAP.                 NO  : ONE LINE PER DEPTH STEP");
  lines.push("~Well Information");
  lines.push(`STRT.FT   ${startDepth.toFixed(4)} : START DEPTH`);
  lines.push(`STOP.FT   ${stopDepth.toFixed(4)} : STOP DEPTH`);
  lines.push(`STEP.FT   ${step.toFixed(4)} : STEP`);
  lines.push(`NULL.     ${nullv} : NULL VALUE`);
  lines.push(`COMP.            ${meta.company || "CT FIELD WORKBOOK"} : COMPANY`);
  lines.push(`WELL.            ${meta.well || "LIVE OPS PLAYBACK"} : WELL`);
  lines.push(`DATE.            ${now} : LOG DATE`);
  lines.push(`SRVC.            CT FIELD WORKBOOK : SERVICE COMPANY`);
  lines.push("~Curve Information");
  COLS.filter((c) => c.key !== "ts").forEach((c) => {
    lines.push(`${pad(c.mnem, 4)}.${pad(c.unit, 6)} : ${c.label}`);
  });
  lines.push("~Parameter Information");
  if (meta.reel_name) lines.push(`REEL.                ${meta.reel_name} : ACTIVE REEL`);
  if (meta.generated_by) lines.push(`USER.                ${meta.generated_by} : EXPORTED BY`);

  const inWindow = annotationsInWindow(annotations, samples);
  lines.push("~Other Information");
  lines.push(`Exported from CoilAegis playback export · ${samples.length} samples · ${inWindow.length} annotations`);
  if (inWindow.length) {
    lines.push("# BEGIN ANNOTATIONS (ISO | source | severity | author | channel | value | depth_ft | note)");
    inWindow.forEach((a) => {
      const parts = [
        new Date(a.timestamp_ms).toISOString(),
        a.source || "manual",
        a.severity || "info",
        (a.author_name || "").replace(/\|/g, "/"),
        a.channel || "-",
        a.value == null ? "-" : Number(a.value).toFixed(2),
        a.depth_ft == null ? "-" : Number(a.depth_ft).toFixed(2),
        (a.note || "").replace(/\|/g, "/").replace(/[\r\n]+/g, " "),
      ];
      lines.push(`# ANN | ${parts.join(" | ")}`);
    });
    lines.push("# END ANNOTATIONS");
  }
  lines.push("~ASCII");
  samples.forEach((s) => {
    const row = COLS.filter((c) => c.key !== "ts").map((c) => {
      const v = s[c.key];
      return (v === null || v === undefined || !Number.isFinite(Number(v))) ? nullv.toString() : Number(v).toFixed(2);
    });
    lines.push(row.join(" "));
  });
  return lines.join("\n");
}

export function downloadBlob(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}
