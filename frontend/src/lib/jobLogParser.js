/**
 * CoilAegis Job-Log Parser
 * ─────────────────────────────────────────────────────────────────────────
 * Parses recorded field data from three open-domain formats into a unified
 * `LiveSample`-shaped array that can drive the live dashboard panels:
 *   • CSV / TSV  — any header row with case-insensitive canonical keys
 *   • LAS 2.0 / 3.0  — Canadian Well Log Society open spec
 *   • WITS 0      — standard surface rig telemetry record IDs
 *
 * Canonical sample schema (Imperial-canonical, matching the LiveSample
 * Pydantic model on the backend):
 *   { depth_ft, weight_lb, pressure_psi, p_internal_psi, p_external_psi,
 *     traction_pressure_psi, axial_force_lbf, vm_utilization, fatigue_worst,
 *     ts, source }
 */

// ─── Field alias registry ────────────────────────────────────────────────
// Order matters: first match wins. All keys compared lowercase & stripped
// of non-alphanumerics so "Depth (ft)" and "DEPTH_FT" both match "depthft".
const CANONICAL_ALIASES = {
  depth_ft: [
    "depthft", "depth", "bitdepth", "md", "mdft", "measureddepth",
    "depthm", "mdm",  // metric aliases — converted below
  ],
  weight_lb: [
    "weightlb", "weightlbs", "weight", "hookload", "hooklb", "hkld",
    "hookloadlbs", "hookloadklb", "wtlb", "weightn", "weightkn",  // metric
  ],
  pressure_psi: [
    "pressurepsi", "pressure", "surfacepressure", "pumppressure",
    "treatingpressure", "pressurekpa", "pressurebar", "pressurempa",
  ],
  p_internal_psi: [
    "pinternalpsi", "pint", "pintpsi", "pinternal", "internalpressure",
  ],
  p_external_psi: [
    "pexternalpsi", "pext", "pwhp", "wellheadpressure", "annularpressure",
  ],
  traction_pressure_psi: [
    "tractionpressurepsi", "skatepressure", "skatepsi", "injectorpressure",
    "skatepressurepsi", "clampingpressure",
  ],
  axial_force_lbf: [
    "axialforcelbf", "axialforce", "axial", "axlbf", "axn",
  ],
  ts: [
    "ts", "time", "timestamp", "datetime", "etime", "elapsedtime",
  ],
};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

// Imperial-canonical converters triggered when the slug implies metric.
const needsImperialize = (slug, raw) => {
  const r = Number(raw);
  if (!Number.isFinite(r)) return raw;
  if (slug === "depthm" || slug === "mdm") return r / 0.3048;             // m → ft
  if (slug === "weightn") return r / 4.4482216152605;                     // N → lbf
  if (slug === "weightkn") return (r * 1000) / 4.4482216152605;           // kN → lbf
  if (slug === "pressurekpa") return r / 6.894757293168361;               // kPa → psi
  if (slug === "pressurebar") return r * 14.5037737797;                   // bar → psi
  if (slug === "pressurempa") return r * 145.037737797;                   // MPa → psi
  if (slug === "axn") return r / 4.4482216152605;                         // N → lbf
  return r;
};

const resolveFieldMap = (headers) => {
  const map = {};  // headerIndex → canonicalKey
  const metricFlag = {}; // headerIndex → needs conversion from the slug
  headers.forEach((h, i) => {
    const s = slug(h);
    for (const [canon, aliases] of Object.entries(CANONICAL_ALIASES)) {
      if (aliases.includes(s) && !Object.values(map).includes(canon)) {
        map[i] = canon;
        metricFlag[i] = s;
        break;
      }
    }
  });
  return { map, metricFlag };
};

// ─── CSV / TSV parser ────────────────────────────────────────────────────
export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error("CSV file has no data rows.");
  // Auto-detect delimiter: tab wins if present, else comma, else semicolon.
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const headers = first.split(delim).map((h) => h.trim().replace(/^"|"$/g, ""));
  const { map, metricFlag } = resolveFieldMap(headers);
  const samples = [];
  for (let li = 1; li < lines.length; li++) {
    const row = lines[li].split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
    const s = { source: "replay_csv" };
    row.forEach((v, i) => {
      const canon = map[i];
      if (!canon || v === "" || v === "-" || v === "NaN") return;
      s[canon] = canon === "ts" ? v : needsImperialize(metricFlag[i], v);
    });
    if (Object.keys(s).length > 1) samples.push(s);
  }
  if (samples.length === 0) {
    throw new Error(`CSV parsed but no recognized columns. Headers: ${headers.join(", ")}`);
  }
  return samples;
}

// ─── LAS 2.0 / 3.0 parser ────────────────────────────────────────────────
export function parseLAS(text) {
  const lines = text.split(/\r?\n/);
  const curves = [];
  let section = "";
  const ascii = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("~")) {
      section = line[1].toUpperCase();
      continue;
    }
    if (line.startsWith("#")) continue;
    if (section === "C") {
      // Curve: "MNEM.UNIT  :description" → capture MNEM
      const mn = line.split(/[.\s:]/)[0];
      if (mn) curves.push(mn);
    } else if (section === "A") {
      ascii.push(line);
    }
  }
  if (curves.length === 0) throw new Error("LAS file has no ~Curve section.");
  if (ascii.length === 0) throw new Error("LAS file has no ~Ascii data.");
  const { map, metricFlag } = resolveFieldMap(curves);
  const samples = [];
  for (const row of ascii) {
    const cols = row.split(/\s+/);
    const s = { source: "replay_las" };
    cols.forEach((v, i) => {
      const canon = map[i];
      if (!canon || v === "-999.25" || v === "" || v === "NaN") return;
      s[canon] = canon === "ts" ? v : needsImperialize(metricFlag[i], v);
    });
    if (Object.keys(s).length > 1) samples.push(s);
  }
  if (samples.length === 0) {
    throw new Error(`LAS parsed but no recognized curves. Curves: ${curves.join(", ")}`);
  }
  return samples;
}

// ─── WITS 0 parser ───────────────────────────────────────────────────────
// Each WITS 0 record is a block delimited by "&&" markers; each line
// inside is 4 digits (record id) + value. Standard mapping:
//   0108 depth (ft), 0110 ROP, 0130 depth-bit, 0146 hookload (klb),
//   0101 pump pressure psi, 0103 pump pressure 2, 0106 casing pressure,
//   0157 WOB (klb). We map the most common CT-adjacent IDs here.
const WITS_MAP = {
  "0108": "depth_ft",
  "0130": "depth_ft",
  "0146": "weight_lb",         // hookload klbs — converted below
  "0157": "weight_lb",         // WOB klbs
  "0101": "p_internal_psi",    // pump pressure
  "0103": "pressure_psi",
  "0106": "p_external_psi",    // casing / annulus
  "0115": "traction_pressure_psi",
  "0127": "axial_force_lbf",
};

export function parseWITS(text) {
  const records = text.split(/&&/).map((r) => r.trim()).filter(Boolean);
  const samples = [];
  for (const rec of records) {
    const s = { source: "replay_wits" };
    for (const line of rec.split(/\r?\n/)) {
      const t = line.trim();
      if (t.length < 5) continue;
      const id = t.slice(0, 4);
      const val = Number(t.slice(4).trim());
      if (!Number.isFinite(val)) continue;
      const canon = WITS_MAP[id];
      if (!canon) continue;
      if (id === "0146" || id === "0157") {
        s.weight_lb = val * 1000;   // klbs → lbs
      } else {
        s[canon] = val;
      }
    }
    if (Object.keys(s).length > 1) samples.push(s);
  }
  if (samples.length === 0) {
    throw new Error("WITS data parsed but no recognized record IDs. Expect 0108/0146/0101/0103/0106.");
  }
  return samples;
}

// ─── Format auto-detect ──────────────────────────────────────────────────
export function detectFormat(filename, text) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (ext === "las") return "las";
  if (ext === "wits") return "wits";
  if (text.startsWith("~V") || /^~Version/im.test(text)) return "las";
  if (text.includes("&&")) return "wits";
  return "csv";
}

export function parseJobLog(filename, text) {
  const fmt = detectFormat(filename, text);
  if (fmt === "las") return { samples: parseLAS(text), format: "LAS 2.0/3.0" };
  if (fmt === "wits") return { samples: parseWITS(text), format: "WITS 0" };
  return { samples: parseCSV(text), format: "CSV / TSV" };
}
