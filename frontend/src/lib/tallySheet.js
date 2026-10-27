// Printable paper tally sheet for manual-override operations. Works fully offline.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function tallySheetHtml({ reel = "", depth = "", rig = "", rows = 28 } = {}) {
  const head = ["Time", "Depth (ft)", "Weight (lbf)", "Pump (bpm)", "Surf P (psi)", "Ann P (psi)", "Reel ftg (ft)", "Cycle #", "Init.", "Notes"];
  const body = Array.from({ length: rows }, () => `<tr>${head.map(() => "<td></td>").join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Aegis OS — Manual Tally Sheet</title>
<style>
 body{font:12px Arial,sans-serif;margin:14px;color:#000}
 h1{font-size:16px;margin:0 0 6px} .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}
 .meta div{border-bottom:1px solid #000;padding:2px 0;min-height:18px}
 table{width:100%;border-collapse:collapse} th,td{border:1px solid #000;padding:2px 4px;height:22px;font-size:11px}
 th{background:#eee} .note{margin-top:8px;font-size:11px}
</style></head><body>
<h1>AEGIS OS — MANUAL OVERRIDE TALLY SHEET</h1>
<div class="meta">
 <div>Well / Job: </div><div>Date: </div><div>Crew / Supervisor: </div>
 <div>Rig: ${esc(rig)}</div><div>Reel: ${esc(reel)}</div><div>Last Aegis depth: ${esc(depth)}</div>
 <div>Reel OD / WT / Grade: </div><div>Fluid density (ppg): </div><div>Reason for manual mode: </div>
</div>
<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
<p class="note"><b>Fatigue cycles (running total):</b> ____________ &nbsp; <b>Last verified depth:</b> ____________ &nbsp; <b>Supervisor sign-off:</b> ____________</p>
<p class="note">Record every depth change and pressure limit event. On reconnect, enter these readings into Aegis OS (Export Job first) and reconcile any differences.</p>
</body></html>`;
}

export function printTallySheet(opts) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  iframe.srcdoc = tallySheetHtml(opts);
  iframe.onload = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch { /* ignore */ }
    setTimeout(() => iframe.remove(), 60000);
  };
  document.body.appendChild(iframe);
}
