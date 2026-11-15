import { prefillSheetValues, prefillDrillingValues } from "../jobPrefill";

const seed = { depthFt: 1000, tvdFt: 900, segment: { od_in: 2, wt_in: 0.125 } };
const params = ["Depth (ft)", "CT OD (in)", "CT Wall (in)", "Pressure (psi)"];
test("job prefills use existing SI/IMP conversions and never guess pressure", () => {
  expect(prefillSheetValues(params, "imp", seed)).toEqual({ 0: "1000", 1: "2", 2: "0.125" });
  const metric = prefillSheetValues(params, "met", seed);
  expect(Number(metric[0])).toBeCloseTo(304.8);
  expect(Number(metric[1])).toBeCloseTo(50.8);
  expect(Number(metric[2])).toBeCloseTo(3.175);
});
test("explicit values including cleared fields take precedence; absent metadata stays absent", () => {
  expect(prefillSheetValues(params, "imp", seed, { 0: "250", 1: "" })).toEqual({ 0: "250", 1: "", 2: "0.125" });
  expect(prefillSheetValues(params, "imp", { depthFt: null, segment: null })).toEqual({});
  expect(prefillSheetValues(["Current Depth (ft)"], "imp", { depthFt: 0 })).toEqual({ 0: "0" });
});
test("drilling captures geometry only and never mutates defaults or shares another job's inputs", () => {
  const defaults = { md: "", tvd: "", pump_pressure: "5000" };
  expect(prefillDrillingValues(defaults, "imp", seed)).toEqual({ md: "1000", tvd: "900", ct_od: "2", ct_wall: "0.125", pump_pressure: "5000" });
  expect(prefillDrillingValues(defaults, "imp", {})).toEqual(defaults);
  expect(defaults.md).toBe("");
});
