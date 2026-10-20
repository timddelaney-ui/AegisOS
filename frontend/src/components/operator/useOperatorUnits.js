import { useUnits } from "../../context/UnitContext";
import { EXTRA_DIMS, FIXED_DIMS } from "../../lib/operatorConfig";

// Unit-aware value/label helpers covering the global registry + operator-only dims
export function useOperatorUnits() {
  const u = useUnits();
  const sys = u.isMetric ? "metric" : "imperial";
  const label = (dim) => FIXED_DIMS[dim] ?? EXTRA_DIMS[dim]?.[sys][0] ?? u.label(dim);
  const val = (v, dim) => {
    if (v == null || !Number.isFinite(+v)) return null;
    if (FIXED_DIMS[dim]) return +v;
    if (EXTRA_DIMS[dim]) return EXTRA_DIMS[dim][sys][1](+v);
    return u.from(+v, dim);
  };
  const show = (v, dim, digits) => {
    const n = val(v, dim);
    if (n == null) return "—";
    const d = digits ?? (Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
    return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  return { ...u, label, val, show };
}
