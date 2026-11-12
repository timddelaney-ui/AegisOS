import { segmentStress } from "../ctSegmentStress";

describe("segmentStress", () => {
  test("CT90 benchmark: 80 MPa, 4 kN, 24 m", () => {
    const s = segmentStress({ pressure_mpa: 80, tension_kn: 4, bend_radius_m: 24 });
    expect(s.hoop).toBeCloseTo(428.0, 1);
    expect(Math.round(s.bending)).toBe(212);
    expect(Math.round(s.pressure_axial)).toBe(196);
    expect(Math.round(s.tension_axial)).toBe(7);
    expect(s.max_axial).toBeCloseTo(414.2, 0);
    expect(s.von_mises).toBeCloseTo(421.3, 0);
    expect(s.yield_pct).toBeCloseTo(67.9, 1);
  });

  test("boundary inputs never yield NaN/Infinity", () => {
    const cases = [
      { pressure_mpa: 0, tension_kn: 0, bend_radius_m: 24 },
      { pressure_mpa: 80, tension_kn: 0, bend_radius_m: 0 },
      { pressure_mpa: 80, tension_kn: -5, bend_radius_m: -3 },
      { pressure_mpa: 80, tension_kn: 4, bend_radius_m: 1e12 },
      { pressure_mpa: NaN, tension_kn: Infinity, bend_radius_m: undefined },
      { pressure_mpa: "abc", tension_kn: null, bend_radius_m: "24" },
    ];
    for (const c of cases) {
      const s = segmentStress(c);
      Object.values(s).forEach((v) => expect(Number.isFinite(v)).toBe(true));
    }
  });

  test("invalid geometry returns null", () => {
    expect(segmentStress({ pressure_mpa: 1, od_mm: 10, wt_mm: 10 })).toBeNull();
    expect(segmentStress({ pressure_mpa: 1, od_mm: 0 })).toBeNull();
    expect(segmentStress({ pressure_mpa: 1, smys_mpa: 0 })).toBeNull();
  });
});
