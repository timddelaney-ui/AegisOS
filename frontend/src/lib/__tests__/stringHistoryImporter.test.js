import { parseStringHistory, stationsToNodeDamage } from "../stringHistoryImporter";

describe("parseStringHistory", () => {
  test("CSV with percent header", () => {
    const r = parseStringHistory("Station (ft),Fatigue %,Cycles\n0,10,5\n100,25.5,7\n", { filename: "cerberus_export.csv" });
    expect(r.ok).toBe(true);
    expect(r.format).toBe("cerberus");
    expect(r.stations).toEqual([
      { md_ft: 0, damage: 0.1, cycles: 5 },
      { md_ft: 100, damage: 0.255, cycles: 7 },
    ]);
  });

  test("metric depth converts to ft", () => {
    const r = parseStringHistory("depth_m,damage\n100,0.2\n", {});
    expect(r.stations[0].md_ft).toBeCloseTo(328.084, 2);
  });

  test("out-of-order, duplicate, malformed rows", () => {
    const r = parseStringHistory("depth,damage\n200,0.3\n100,0.1\n100,0.4\nabc,0.1\n-5,0.1\n300,NaN\n400,-0.2\n500,2e9\n", {});
    expect(r.ok).toBe(true);
    expect(r.stations.map((s) => s.md_ft)).toEqual([100, 200]);
    expect(r.stations[0].damage).toBe(0.4); // duplicate keeps the max
    expect(r.rejected.length).toBe(5);
    expect(r.warnings.join(" ")).toMatch(/out of depth order/);
  });

  test("invalid stations do not change inferred damage scale", () => {
    const r = parseStringHistory("depth,damage\n0,0\n100,0.8\ninvalid,99\n", {});
    expect(r.stations.map((station) => station.damage)).toEqual([0, 0.8]);
  });

  test("explicit percentages above 100 are clamped instead of rejected", () => {
    const r = parseStringHistory("depth,fatigue_pct\n0,120\n", {});
    expect(r.stations).toEqual([{ md_ft: 0, damage: 1 }]);
    expect(r.rejected).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/clamped to 100%/);
  });

  test("missing columns return a user-facing error, not a throw", () => {
    const r = parseStringHistory("foo,bar\n1,2\n", {});
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/No depth/);
  });

  test("garbage input never throws", () => {
    for (const t of ["", "   ", null, undefined, "\u0000\u0001", "~V\n~A\n", "a,b\n", '"unterminated,x\n1,2']) {
      const r = parseStringHistory(t, {});
      expect(typeof r.ok).toBe("boolean");
      expect(Array.isArray(r.stations)).toBe(true);
    }
  });

  test("LAS 2.0 with null value and meters", () => {
    const las = `~V\nVERS. 2.0 : v\n~W\nNULL. -999.25 : null\n~C\nDEPT.M : depth\nFATIGUE.% : pct\n~A\n0 10\n10 -999.25\n20 30\n`;
    const r = parseStringHistory(las, { filename: "x.las" });
    expect(r.format).toBe("las");
    expect(r.stations.length).toBe(2);
    expect(r.stations[1].damage).toBeCloseTo(0.3);
    expect(r.stations[1].md_ft).toBeCloseTo(65.617, 2);
  });
});

describe("stationsToNodeDamage", () => {
  test("bins to nodes, interpolating gaps and holding zero outside", () => {
    const d = stationsToNodeDamage([{ md_ft: 100, damage: 0.2 }, { md_ft: 300, damage: 0.4 }], 100, 500);
    expect(d).toHaveLength(6);
    expect(d[0]).toBe(0);
    expect(d[1]).toBe(0.2);
    expect(d[2]).toBeCloseTo(0.3);
    expect(d[3]).toBe(0.4);
    expect(d[5]).toBe(0);
  });
  test("bad grid returns empty", () => {
    expect(stationsToNodeDamage([], 0, 100)).toEqual([]);
  });
});
