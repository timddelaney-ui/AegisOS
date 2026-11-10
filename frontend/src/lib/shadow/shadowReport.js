// Shadow Mode Verification Report: CSV + dependency-free multi-page PDF writer.
import { CATEGORIES, STATUS, summarize, ALERT_PCT, GREEN_MAX_PCT, AMBER_MAX_PCT } from "./variance";

const fmt = (v, d = 3) => (v == null || !Number.isFinite(v) ? "-" : Number(v).toFixed(d));
const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

// ───────────── CSV ─────────────
const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+@]|^-(?!\d)/.test(s)) s = `'${s}`; // formula-injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (cells) => cells.map(csvCell).join(",");

export function buildReportCSV({ records, meta = {}, telemetry = [], generatedAt = new Date().toISOString() }) {
  const lines = [
    row(["# Aegis OS Shadow Mode Verification Report"]),
    row(["generated_at", generatedAt]),
    row(["job_id", meta.jobId]), row(["well", meta.well]), row(["client", meta.client]), row(["operator", meta.operator]),
    row(["bands", `green<${GREEN_MAX_PCT}%`, `amber ${GREEN_MAX_PCT}-${AMBER_MAX_PCT}%`, `red>${AMBER_MAX_PCT}%`, `highlight>${ALERT_PCT}%`]),
    "",
    row(["# ACCURACY BENCHMARKS"]),
    row(["category", "reference_source", "comparisons", "mean_abs_delta_pct", "rms_delta_pct", "max_abs_delta_pct", "pct_green", "alerts_over_2pct", "status"]),
  ];
  Object.entries(CATEGORIES).forEach(([key, c]) => {
    const s = summarize(records, key);
    lines.push(row([c.label, c.reference, s.n, fmt(s.meanAbsDelta, 4), fmt(s.rmsDelta, 4), fmt(s.maxAbsDelta, 4), fmt(s.withinGreenPct, 1), s.alerts, STATUS[s.overall].label]));
  });
  lines.push("", row(["# VARIANCE LOG"]),
    row(["timestamp", "job_id", "category", "metric", "aegis_value", "reference_value", "unit", "delta_pct", "status", "over_2pct", "note"]));
  records.forEach((r) => lines.push(row([r.ts, r.jobId, CATEGORIES[r.category]?.label, r.metric, r.aegis, r.reference, r.unit,
    fmt(r.delta, 4), STATUS[r.status].label, r.alert ? "YES" : "no", r.note])));
  lines.push("", row(["# FATIGUE LIFE CONSUMED"]), row(["timestamp", "metric", "aegis", "reference", "unit", "delta_pct"]));
  records.filter((r) => r.category === "fatigue").forEach((r) => lines.push(row([r.ts, r.metric, r.aegis, r.reference, r.unit, fmt(r.delta, 4)])));
  lines.push("", row(["# JOB TELEMETRY"]), row(["timestamp", "type", "payload"]));
  telemetry.forEach((t) => lines.push(row([t.ts, t.type, typeof t.payload === "object" ? JSON.stringify(t.payload) : t.payload])));
  return lines.join("\n");
}

// ───────────── PDF ─────────────
const PW = 595; const PH = 842; const M = 40;
const hex = (c) => [1, 3, 5].map((i) => (parseInt(c.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");
// Built-in Helvetica is WinAnsi: keep printable Latin-1, replace everything else.
const clean = (s) => String(s ?? "").replace(/[^\x20-\x7E]/g, (ch) => ({ "−": "-", "–": "-", "—": "-", "Δ": "d", "·": "-" }[ch] || "?"));
const esc = (s) => clean(s).replace(/[\\()]/g, (m) => `\\${m}`);

class Page {
  constructor() { this.ops = []; }
  rect(x, y, w, h, color) { this.ops.push(`${hex(color)} rg ${x} ${PH - y - h} ${w} ${h} re f`); }
  text(x, y, s, { size = 9, bold = false, color = "#0F172A" } = {}) {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${hex(color)} rg ${x} ${PH - y} Td (${esc(s)}) Tj ET`);
  }
}

const trunc = (s, n) => { const t = clean(s); return t.length > n ? `${t.slice(0, n - 1)}~` : t; };

/** Lay out the report into pages (pure; exported for tests). */
export function layoutReport({ records, meta = {}, telemetry = [], generatedAt = new Date().toISOString() }) {
  const pages = [];
  let pg; let y;
  const newPage = (title) => {
    pg = new Page(); pages.push(pg);
    pg.rect(0, 0, PW, 54, "#0B1220");
    pg.rect(0, 54, PW, 3, "#FF6B1A");
    pg.text(M, 28, "AEGIS OS", { size: 16, bold: true, color: "#FFFFFF" });
    pg.text(M, 44, "Shadow Mode Verification Report", { size: 9, color: "#CBD5E1" });
    pg.text(PW - M - 150, 28, trunc(title, 34), { size: 9, bold: true, color: "#FF6B1A" });
    y = 82;
  };
  const heading = (s) => { pg.text(M, y, s, { size: 12, bold: true }); y += 6; pg.rect(M, y, PW - 2 * M, 1, "#CBD5E1"); y += 16; };
  const ensure = (h, title) => { if (y + h > PH - 50) newPage(title); };

  const overall = summarize(records);
  newPage("Executive summary");
  heading("Job details");
  [["Job ID", meta.jobId], ["Well", meta.well], ["Client", meta.client], ["Operator", meta.operator], ["Generated", generatedAt]]
    .forEach(([k, v]) => { pg.text(M, y, k, { bold: true, color: "#475569" }); pg.text(M + 90, y, trunc(v || "-", 70)); y += 14; });
  y += 10;
  heading("Overall verification status");
  const st = STATUS[overall.overall];
  pg.rect(M, y - 10, 70, 22, st.color);
  pg.text(M + 10, y + 5, st.label.toUpperCase(), { size: 10, bold: true, color: "#FFFFFF" });
  pg.text(M + 85, y + 5, `${overall.n} comparisons | mean |delta| ${fmt(overall.meanAbsDelta, 3)}% | max ${fmt(overall.maxAbsDelta, 3)}% | ${overall.alerts} above ${ALERT_PCT}%`);
  y += 36;

  heading("Side-by-side accuracy benchmarks");
  const cols = [[M, "Aegis vs reference"], [225, "N"], [255, "Mean |d|%"], [315, "Max |d|%"], [375, "% green"], [430, "> 2%"], [480, "Status"]];
  cols.forEach(([x, h]) => pg.text(x, y, h, { bold: true, color: "#475569", size: 8 }));
  y += 12;
  Object.entries(CATEGORIES).forEach(([key, c]) => {
    const s = summarize(records, key);
    pg.text(M, y, trunc(c.label, 34), { bold: true }); pg.text(M, y + 10, trunc(`vs ${c.reference}`, 40), { size: 7, color: "#64748B" });
    pg.text(225, y, String(s.n)); pg.text(255, y, fmt(s.meanAbsDelta)); pg.text(315, y, fmt(s.maxAbsDelta));
    pg.text(375, y, fmt(s.withinGreenPct, 1)); pg.text(430, y, String(s.alerts));
    pg.rect(480, y - 8, 50, 12, STATUS[s.overall].color);
    pg.text(484, y + 1, STATUS[s.overall].label, { size: 8, bold: true, color: "#FFFFFF" });
    y += 28;
  });
  y += 6;
  pg.text(M, y, `Bands: green < ${GREEN_MAX_PCT}% | amber ${GREEN_MAX_PCT}-${AMBER_MAX_PCT}% | red > ${AMBER_MAX_PCT}%. Deltas above ${ALERT_PCT}% are flagged for field verification.`, { size: 8, color: "#64748B" });

  newPage("Variance log");
  const logHeader = () => {
    pg.rect(M, y - 10, PW - 2 * M, 16, "#E2E8F0");
    [[M + 4, "Timestamp (UTC)"], [150, "Metric"], [290, "Aegis"], [350, "Reference"], [420, "Delta"], [480, "Status"]]
      .forEach(([x, h]) => pg.text(x, y + 1, h, { bold: true, size: 8 }));
    y += 18;
  };
  heading("Variance log");
  logHeader();
  if (!records.length) pg.text(M, y, "No comparisons recorded.", { color: "#64748B" });
  records.forEach((r, i) => {
    if (y + 14 > PH - 50) { newPage("Variance log (cont.)"); logHeader(); }
    if (i % 2) pg.rect(M, y - 9, PW - 2 * M, 13, "#F8FAFC");
    pg.text(M + 4, y, r.ts.replace("T", " ").slice(0, 19), { size: 8 });
    pg.text(150, y, trunc(r.metric, 28), { size: 8 });
    pg.text(290, y, `${fmt(r.aegis, 2)} ${r.unit}`, { size: 8 });
    pg.text(350, y, `${fmt(r.reference, 2)} ${r.unit}`, { size: 8 });
    pg.text(420, y, pct(r.delta), { size: 8, bold: r.alert });
    pg.rect(480, y - 7, 8, 8, STATUS[r.status].color);
    pg.text(492, y, STATUS[r.status].label, { size: 8 });
    y += 13;
  });

  newPage("Fatigue & telemetry");
  heading("Fatigue life consumed");
  const fat = records.filter((r) => r.category === "fatigue");
  if (!fat.length) { pg.text(M, y, "No fatigue comparisons recorded.", { color: "#64748B" }); y += 14; }
  fat.forEach((r) => {
    ensure(14, "Fatigue & telemetry (cont.)");
    pg.text(M, y, `${r.ts.slice(0, 19).replace("T", " ")}  ${trunc(r.metric, 30)}  Aegis ${fmt(r.aegis, 4)} / ref ${fmt(r.reference, 4)} ${r.unit}  (${pct(r.delta)})`, { size: 8 });
    y += 13;
  });
  y += 12;
  ensure(40, "Fatigue & telemetry (cont.)");
  heading(`Timestamped job telemetry (${telemetry.length} entries)`);
  telemetry.forEach((t) => {
    ensure(12, "Telemetry (cont.)");
    pg.text(M, y, `${String(t.ts).replace("T", " ").slice(0, 19)}  ${trunc(t.type, 18)}  ${trunc(typeof t.payload === "object" ? JSON.stringify(t.payload) : t.payload, 70)}`, { size: 7 });
    y += 11;
  });
  y += 16;
  ensure(70, "Methodology");
  heading("Methodology & limitations");
  [
    "Delta = (Aegis - reference) / |reference| x 100, evaluated per recorded comparison.",
    "Only comparisons recorded during Shadow Mode are reported; no values are inferred or interpolated.",
    "Reference values are as entered or imported from the legacy system and are not independently verified.",
    "Advisory only: Aegis OS does not replace the unit's data acquisition or the operator's judgement.",
  ].forEach((s) => { ensure(12, "Methodology"); pg.text(M, y, `- ${s}`, { size: 8 }); y += 12; });

  pages.forEach((p, i) => {
    p.text(M, PH - 24, `Aegis OS | Shadow Mode Verification | ${clean(meta.jobId || "no job id")}`, { size: 7, color: "#64748B" });
    p.text(PW - M - 50, PH - 24, `Page ${i + 1} / ${pages.length}`, { size: 7, color: "#64748B" });
  });
  return pages;
}

/** Serialise pages to a PDF document string (ASCII only, so string length === byte length). */
export function buildReportPDF(args) {
  const pages = layoutReport(args);
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages placeholder (obj 2)
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = pages.map((p) => {
    const body = p.ops.join("\n");
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  objs[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] >>`;
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}

export function downloadReport(kind, args, filenameStem = "aegis-shadow-verification") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const isPdf = kind === "pdf";
  const data = isPdf ? buildReportPDF(args) : buildReportCSV(args);
  const bytes = isPdf ? Uint8Array.from(data, (c) => c.charCodeAt(0)) : data;
  const url = URL.createObjectURL(new Blob([bytes], { type: isPdf ? "application/pdf" : "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${filenameStem}-${stamp}.${isPdf ? "pdf" : "csv"}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
