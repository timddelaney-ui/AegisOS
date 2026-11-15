import { fromImp } from "./units";

export function prefillSheetValues(params, unitSystem, seed, existing = {}) {
  const system = unitSystem === "met" ? "metric" : "imperial";
  const values = { ...existing };
  params.forEach((parameter, index) => {
    if (Object.prototype.hasOwnProperty.call(existing, index)) return;
    let value;
    let dimension;
    if (/^(Current )?Depth \(/.test(parameter)) { value = seed.depthFt; dimension = "depth"; }
    else if (/^CT OD \(/.test(parameter)) { value = seed.segment?.od_in; dimension = "od"; }
    else if (/^CT Wall \(/.test(parameter)) { value = seed.segment?.wt_in; dimension = "wt"; }
    if (value !== null && value !== undefined && Number.isFinite(value)) values[index] = String(fromImp(value, dimension, system));
  });
  return values;
}

export function prefillDrillingValues(defaults, unitSystem, seed) {
  const system = unitSystem === "met" ? "metric" : "imperial";
  const values = { ...defaults };
  for (const [key, value, dimension] of [
    ["md", seed.depthFt, "depth"], ["tvd", seed.tvdFt, "depth"],
    ["ct_od", seed.segment?.od_in, "od"], ["ct_wall", seed.segment?.wt_in, "wt"],
  ]) {
    if (value !== null && value !== undefined && Number.isFinite(value)) values[key] = String(fromImp(value, dimension, system));
  }
  return values;
}
