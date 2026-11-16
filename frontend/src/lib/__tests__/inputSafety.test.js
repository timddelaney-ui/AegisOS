import { parseNumericInput, validateSheetValues, convertSheetValues, plausibilityError } from "../inputSafety";

describe("parseNumericInput", () => {
  test.each([["12,5", 12.5], ["12.5", 12.5], [" 1,234.5 ", 1234.5], ["-3", -3], [".5", 0.5]])("%s", (s, v) => {
    expect(parseNumericInput(s).value).toBe(v);
  });
  test.each(["1,234", "1,2,3", "1.2.3", "abc", "1e5", "--1", "1,2.3"])("rejects %s", (s) => {
    expect(parseNumericInput(s).error).toBeTruthy();
  });
  test("empty", () => expect(parseNumericInput("  ").empty).toBe(true));
});

describe("plausibility", () => {
  test("negative pressure", () => expect(plausibilityError("Treating P (psi)", -5)).toMatch(/negative/));
  test("impossible pump rate", () => expect(plausibilityError("Pump Rate (BPM)", 450)).toMatch(/Implausible/));
  test.each(["Hook Weight (lbs)", "Differential Pressure (psi)", "TVD Offset (ft)", "Inclination Delta (deg)", "Azimuth (deg)", "Temp (deg C)"])("%s may be negative", (label) => {
    expect(plausibilityError(label, -50)).toBeNull();
  });
  test("plain depth and pressure still reject negatives", () => {
    expect(plausibilityError("Depth (ft)", -5)).toMatch(/negative/);
    expect(plausibilityError("Treating P (psi)", -5)).toMatch(/negative/);
  });
  test("temperature may be negative", () => expect(plausibilityError("Temp (deg C)", -20)).toBeNull());
});

test("validateSheetValues withholds invalid fields", () => {
  const { clean, errors } = validateSheetValues(["Depth (ft)", "Pump Rate (BPM)"], { 0: "15,000", 1: "4,5" });
  expect(errors[0]).toBeTruthy();
  expect(clean[1]).toBe("4.5");
});

test("unit conversion round trip has no drift", () => {
  const imp = ["Depth (ft)", "Treating P (psi)"], met = ["Depth (m)", "Treating P (MPa)"];
  let v = { 0: "15000", 1: "7500" };
  for (let i = 0; i < 50; i++) {
    v = convertSheetValues(imp, met, v, true);
    v = convertSheetValues(imp, met, v, false);
  }
  expect(Number(v[0])).toBeCloseTo(15000, 4);
  expect(Number(v[1])).toBeCloseTo(7500, 4);
});
