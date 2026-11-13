// Legacy string-history importer: CSV, LAS 2.0, and Cerberus / Reel-Trak style CSV exports.
// Header matching is alias-based (best effort); the importer never throws on bad input and
// always returns { ok, format, stations, warnings, errors, rejected } so the UI can show it.
// Stations are { md_ft, damage (0..1), cycles? }. Imported damage is conservative: duplicates
// keep the larger value, and node binning takes the max.

const M_TO_FT = 1 / 0.3048;
const MAX_ROWS = 200000;

const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9%]+/g, "_").replace(/^_+|_+$/g, "");

const DEPTH_ALIASES = ["md", "md_ft", "md_m", "depth", "depth_ft", "depth_m", "dept", "station", "station_ft", "station_m", "position", "reel_position", "position_ft", "length_ft", "location_ft"];
const DAMAGE_ALIASES = ["fatigue", "fatigue_pct", "fatigue_%", "fatigue_percent", "damage", "damage_pct", "damage_%", "accumulated_damage", "accumulated_fatigue", "fatigue_life_used", "life_used", "life_used_%", "life_used_pct", "consumed_life", "consumed_life_%", "cumulative_damage", "fatigue_used"];
const CYCLE_ALIASES = ["cycles", "cycle_count", "bend_cycles", "bending_cycles", "trips"];
const SOFT_DEPTH_RE = /(depth|station|position|md)/;
const SOFT_DAMAGE_RE = /(fatigue|damage|life)/;

function findColumn(headers, aliases, softRe) {
  const exact = headers.findIndex((h) => aliases.includes(h));
  if (exact >= 0) return exact;
  return softRe ? headers.findIndex((h) => softRe.test(h)) : -1;
}

function depthUnitFromHeader(h) {
  if (/(^|_)(m|meter|meters|metres)($|_)/.test(h) && !/_ft/.test(h)) return "m";
  return "ft";
}

function damageScaleFromHeader(h) {
  return /(%|pct|percent)/.test(h) ? "percent" : "auto";
}

export function splitCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(line) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  Object.keys(counts).forEach((d) => { counts[d] = line.split(d).length - 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

const toNumber = (raw) => {
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/%$/, "").replace(/,/g, "");
  if (s === "") return NaN;
  return Number(s);
};

function finalize(inputRows, meta) {
  let rows = inputRows;
  const { depthUnit, damageScale, nullValue } = meta;
  if (damageScale !== "percent") {
    rows = rows.filter((r) => {
      if (Number.isFinite(r.damage) && r.damage > 100) {
        (meta.rejected = meta.rejected || []).push({ line: r.line, reason: "implausible damage value (>100)" });
        return false;
      }
      return true;
    });
  }
  const warnings = [...(meta.warnings || [])];
  const rejected = [...(meta.rejected || [])];
  const errors = [...(meta.errors || [])];

  const scaleCandidates = rows.filter((r) => (
    Number.isFinite(r.md) && r.md >= 0
    && Number.isFinite(r.damage) && r.damage >= 0
    && !(nullValue != null && (r.md === nullValue || r.damage === nullValue))
  ));
  const pctMode = damageScale === "percent"
    ? true
    : scaleCandidates.some((r) => r.damage > 1.5) ? "inferred" : false;
  if (pctMode === "inferred") warnings.push("Damage values exceed 1.5, so they were read as percentages (0–100).");

  const byDepth = new Map();
  let outOfOrder = false;
  let lastDepth = -Infinity;
  let dupes = 0;
  for (const r of rows) {
    if (nullValue != null && (r.md === nullValue || r.damage === nullValue)) {
      rejected.push({ line: r.line, reason: "LAS null value" });
      continue;
    }
    if (!Number.isFinite(r.md) || !Number.isFinite(r.damage)) {
      rejected.push({ line: r.line, reason: "non-numeric depth or damage" });
      continue;
    }
    const md_ft = depthUnit === "m" ? r.md * M_TO_FT : r.md;
    let damage = pctMode ? r.damage / 100 : r.damage;
    if (md_ft < 0) { rejected.push({ line: r.line, reason: "negative depth" }); continue; }
    if (damage < 0) { rejected.push({ line: r.line, reason: "negative damage" }); continue; }
    if (damage > 1) {
      warnings.push(`Line ${r.line}: damage above 100% clamped to 100%.`);
      damage = 1;
    }
    if (md_ft < lastDepth) outOfOrder = true;
    lastDepth = md_ft;
    const key = Math.round(md_ft * 1000) / 1000;
    const prev = byDepth.get(key);
    if (prev) {
      dupes += 1;
      prev.damage = Math.max(prev.damage, damage);
      if (Number.isFinite(r.cycles)) prev.cycles = Math.max(prev.cycles ?? 0, r.cycles);
    } else {
      byDepth.set(key, { md_ft: key, damage, ...(Number.isFinite(r.cycles) ? { cycles: r.cycles } : {}) });
    }
  }
  if (outOfOrder) warnings.push("Rows were out of depth order and have been sorted.");
  if (dupes) warnings.push(`${dupes} duplicate depth row(s) merged, keeping the highest damage.`);
  if (rejected.length) warnings.push(`${rejected.length} row(s) rejected.`);

  const stations = [...byDepth.values()].sort((a, b) => a.md_ft - b.md_ft);
  if (!stations.length && !errors.length) errors.push("No usable station rows were found.");
  return { ok: errors.length === 0, format: meta.format, stations, warnings, errors, rejected };
}

function parseCsv(text, format) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  if (lines.length < 2) return { ok: false, format, stations: [], warnings: [], rejected: [], errors: ["File needs a header row and at least one data row."] };
  const delim = detectDelimiter(lines[0]);
  const rawHeaders = splitCsvLine(lines[0], delim);
  const headers = rawHeaders.map(norm);
  const di = findColumn(headers, DEPTH_ALIASES, SOFT_DEPTH_RE);
  const fi = findColumn(headers, DAMAGE_ALIASES, SOFT_DAMAGE_RE);
  const ci = findColumn(headers, CYCLE_ALIASES);
  const errors = [];
  if (di < 0) errors.push(`No depth/station column found. Headers seen: ${rawHeaders.join(", ")}`);
  if (fi < 0) errors.push(`No fatigue/damage column found. Headers seen: ${rawHeaders.join(", ")}`);
  if (errors.length) return { ok: false, format, stations: [], warnings: [], rejected: [], errors };

  const rows = [];
  const warnings = [];
  if (lines.length - 1 > MAX_ROWS) warnings.push(`Only the first ${MAX_ROWS} rows were read.`);
  for (let i = 1; i < Math.min(lines.length, MAX_ROWS + 1); i += 1) {
    const cells = splitCsvLine(lines[i], delim);
    rows.push({
      line: i + 1,
      md: toNumber(cells[di]),
      damage: toNumber(cells[fi]),
      cycles: ci >= 0 ? toNumber(cells[ci]) : NaN,
    });
  }
  return finalize(rows, {
    format,
    warnings,
    depthUnit: depthUnitFromHeader(headers[di]),
    damageScale: /%/.test(rawHeaders[fi]) ? "percent" : damageScaleFromHeader(headers[fi]),
  });
}

function parseLas(text) {
  const lines = text.split(/\r?\n/);
  let section = "";
  let nullValue = null;
  let stepUnit = null;
  const curves = [];
  const data = [];
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (line.startsWith("~")) { section = line[1]?.toUpperCase() || ""; return; }
    if (section === "W" || section === "V") {
      const m = line.match(/^(\w+)\s*\.(\S*)\s+(.*?)\s*:/);
      if (m && m[1].toUpperCase() === "NULL") nullValue = Number(m[3]);
      if (m && m[1].toUpperCase() === "STRT") stepUnit = m[2].toLowerCase();
    } else if (section === "C") {
      const m = line.match(/^([^.\s]+)\s*\.(\S*)/);
      if (m) curves.push({ name: norm(m[1]), unit: m[2].toLowerCase() });
    } else if (section === "A") {
      data.push({ line: idx + 1, cells: line.split(/[\s,]+/) });
    }
  });
  if (!curves.length) return { ok: false, format: "las", stations: [], warnings: [], rejected: [], errors: ["LAS file has no ~Curve section."] };
  if (!data.length) return { ok: false, format: "las", stations: [], warnings: [], rejected: [], errors: ["LAS file has no ~ASCII data section."] };
  const names = curves.map((c) => c.name);
  const di = names.findIndex((n) => ["dept", "depth", "md"].includes(n)) >= 0
    ? names.findIndex((n) => ["dept", "depth", "md"].includes(n)) : 0;
  const fi = findColumn(names, DAMAGE_ALIASES, SOFT_DAMAGE_RE);
  if (fi < 0 || fi === di) {
    return { ok: false, format: "las", stations: [], warnings: [], rejected: [], errors: [`No fatigue/damage curve found. Curves: ${curves.map((c) => c.name).join(", ")}`] };
  }
  const unit = curves[di].unit || stepUnit || "";
  const depthUnit = /^(m|meter|metre|meters|metres)$/.test(unit) ? "m" : "ft";
  const dmgUnit = curves[fi].unit;
  const rows = data.map((d) => ({
    line: d.line,
    md: toNumber(d.cells[di]),
    damage: toNumber(d.cells[fi]),
    cycles: NaN,
  }));
  return finalize(rows, {
    format: "las",
    depthUnit,
    nullValue,
    damageScale: /%|pct|percent/.test(dmgUnit) || /%|pct|percent/.test(curves[fi].name) ? "percent" : "auto",
    warnings: data.length > MAX_ROWS ? [`Large LAS: ${data.length} rows.`] : [],
  });
}

export function detectFormat(text, filename = "") {
  const head = String(text).slice(0, 4000);
  if (/^\s*~V/im.test(head) || /\.las$/i.test(filename)) return "las";
  if (/cerberus/i.test(head) || /cerberus/i.test(filename)) return "cerberus";
  if (/reel[-_ ]?trak/i.test(head) || /reel[-_ ]?trak/i.test(filename)) return "reel-trak";
  return "csv";
}

export function parseStringHistory(text, { filename = "", format } = {}) {
  try {
    if (typeof text !== "string" || !text.trim()) {
      return { ok: false, format: format || "csv", stations: [], warnings: [], rejected: [], errors: ["File is empty."] };
    }
    const clean = text.replace(/^\uFEFF/, "");
    const fmt = format || detectFormat(clean, filename);
    return fmt === "las" ? parseLas(clean) : parseCsv(clean, fmt);
  } catch (e) {
    return { ok: false, format: format || "csv", stations: [], warnings: [], rejected: [], errors: [`Unreadable file: ${e.message}`] };
  }
}

// Map stations onto the fatigue ledger's fixed node grid (node i covers md = i·spacing).
// Each node takes the max damage of stations within ±spacing/2; empty nodes between two
// stations are linearly interpolated; nodes outside the imported range stay 0.
export function stationsToNodeDamage(stations, spacing_ft, total_length_ft) {
  const spacing = Number(spacing_ft);
  const total = Number(total_length_ft);
  if (!(spacing > 0) || !(total > 0) || !Array.isArray(stations)) return [];
  const n = Math.max(1, Math.ceil(total / spacing) + 1);
  const damage = new Array(n).fill(null);
  for (const s of stations) {
    const i = Math.round(s.md_ft / spacing);
    if (i < 0 || i >= n) continue;
    damage[i] = Math.max(damage[i] ?? 0, s.damage);
  }
  const known = damage.map((d, i) => (d == null ? -1 : i)).filter((i) => i >= 0);
  return damage.map((d, i) => {
    if (d != null) return d;
    const lo = [...known].reverse().find((k) => k < i);
    const hi = known.find((k) => k > i);
    if (lo == null || hi == null) return 0;
    return damage[lo] + ((damage[hi] - damage[lo]) * (i - lo)) / (hi - lo);
  });
}
