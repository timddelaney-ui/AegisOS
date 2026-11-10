import {
  pctDelta, classifyDelta, exceedsAlert, buildRecord, summarize,
  hydrostaticPsi, buoyedWeightLbf, buoyancyFactor, fatigueConsumed,
} from "../shadow/variance";
import { buildReportCSV, buildReportPDF, layoutReport } from "../shadow/shadowReport";

describe("variance maths", () => {
  test("pctDelta is signed and reference-relative", () => {
    expect(pctDelta(101, 100)).toBeCloseTo(1);
    expect(pctDelta(98, 100)).toBeCloseTo(-2);
    expect(pctDelta("", 100)).toBeNull();
    expect(pctDelta(5, 0)).toBeNull();
    expect(pctDelta(0, 0)).toBe(0);
  });

  test("colour bands: green <1, amber 1-3, red >3", () => {
    expect(classifyDelta(0.99)).toBe("green");
    expect(classifyDelta(-0.5)).toBe("green");
    expect(classifyDelta(1)).toBe("amber");
    expect(classifyDelta(3)).toBe("amber");
    expect(classifyDelta(-3.01)).toBe("red");
    expect(classifyDelta(null)).toBe("na");
  });

  test("alert highlight triggers above 2%", () => {
    expect(exceedsAlert(2)).toBe(false);
    expect(exceedsAlert(-2.01)).toBe(true);
  });

  test("physics helpers match hand calculations", () => {
    expect(hydrostaticPsi(10, 10000)).toBeCloseTo(5200);
    expect(buoyancyFactor(8.6)).toBeCloseTo(1 - 8.6 / 65.4);
    expect(buoyedWeightLbf(2.9, 10000, 8.6)).toBeCloseTo(29000 * (1 - 8.6 / 65.4));
    expect(hydrostaticPsi(0, 100)).toBeNull();
    const f = fatigueConsumed({ OD_in: 2, bend_radius_in: 72, smys: 90000, cycles: 100 });
    expect(f.consumed).toBeCloseTo(100 * f.damagePerCycle);
    expect(fatigueConsumed({ OD_in: 2, cycles: -1 })).toBeNull();
  });

  test("buildRecord rejects bad input and summarize aggregates", () => {
    expect(buildRecord({ category: "nope", aegis: 1, reference: 1 })).toBeNull();
    expect(buildRecord({ category: "pressure", aegis: "x", reference: 1 })).toBeNull();
    const recs = [
      buildRecord({ category: "pressure", aegis: 100.2, reference: 100 }),
      buildRecord({ category: "pressure", aegis: 102.5, reference: 100 }),
      buildRecord({ category: "weight", aegis: 110, reference: 100 }),
    ];
    const s = summarize(recs, "pressure");
    expect(s.n).toBe(2);
    expect(s.counts).toEqual({ green: 1, amber: 1, red: 0 });
    expect(s.alerts).toBe(1);
    expect(summarize(recs).overall).toBe("red");
    expect(summarize([]).overall).toBe("na");
  });
});

describe("verification report", () => {
  const records = Array.from({ length: 80 }, (_, i) => buildRecord({
    category: ["fatigue", "pressure", "weight"][i % 3], metric: `Metric (${i}) \\ é`, aegis: 100 + (i % 5) * 0.4, reference: 100, unit: "psi", jobId: "JOB-1",
  }));
  const meta = { jobId: "JOB-1", well: "=HYPERLINK(\"x\")", client: "ACME", operator: "Op" };

  test("CSV has all sections and neutralises formula injection", () => {
    const csv = buildReportCSV({ records, meta, telemetry: [{ ts: "2026-01-01T00:00:00Z", type: "depth", payload: { depth_ft: 5 } }] });
    ["# ACCURACY BENCHMARKS", "# VARIANCE LOG", "# FATIGUE LIFE CONSUMED", "# JOB TELEMETRY"].forEach((h) => expect(csv).toContain(h));
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.split("\n").length).toBeGreaterThan(80);
  });

  test("PDF is multi-page, well-formed and xref offsets are correct", () => {
    const pages = layoutReport({ records, meta });
    expect(pages.length).toBeGreaterThanOrEqual(3);
    const pdf = buildReportPDF({ records, meta });
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.endsWith("%%EOF")).toBe(true);
    expect(/[^\x00-\x7F]/.test(pdf)).toBe(false);
    expect(pdf).toContain(`/Count ${pages.length}`);
    const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offs = [...pdf.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offs.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  test("empty log still produces a valid report", () => {
    expect(buildReportPDF({ records: [], meta: {} })).toContain("%%EOF");
  });
});
