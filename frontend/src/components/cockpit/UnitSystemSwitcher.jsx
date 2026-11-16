import React from "react";
import { useUnits } from "../../context/UnitContext";

export default function UnitSystemSwitcher() {
  const { system, setSystem } = useUnits();
  return (
    <label className="flex items-center gap-2 text-xs text-slate-300">
      Units
      <select aria-label="Display units" value={system} onChange={(e) => setSystem(e.target.value)}
        className="rounded border border-slate-600 bg-[#0F172A] px-2 py-1 text-[#F8FAFC]">
        <option value="imperial">Imperial</option>
        <option value="metric">Metric</option>
      </select>
    </label>
  );
}
