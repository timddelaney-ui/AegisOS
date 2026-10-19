import React from "react";
import { useUnits } from "../context/UnitContext";
import { UNIT_SYSTEMS } from "../lib/units";

/**
 * Top-bar Unit System switcher — Imperial ⇄ Metric. The entire CoilAegis
 * UI reads this preference via `useUnits()` and re-renders live. Backend
 * payloads remain Imperial-canonical; the switcher only affects display.
 */
export default function UnitSwitcher({ compact = false }) {
  const { system, setSystem } = useUnits();
  const imp = system === UNIT_SYSTEMS.IMPERIAL;

  return (
    <div
      data-testid="unit-switcher"
      className={`inline-flex items-center ca-glass p-0.5 rounded-full border ${compact ? "text-[9px]" : "text-[10px]"}`}
      role="group"
      aria-label="Unit system">
      <button
        data-testid="unit-switch-imperial"
        onClick={() => setSystem(UNIT_SYSTEMS.IMPERIAL)}
        className={`px-2.5 py-0.5 rounded-full font-bold tracking-widest uppercase transition-all ${imp ? "bg-[#FF6B1A] text-white shadow-[0_0_0_1px_rgba(255,107,26,0.4)]" : "text-slate-400 hover:text-white"}`}
        aria-pressed={imp}>
        Imp
      </button>
      <button
        data-testid="unit-switch-metric"
        onClick={() => setSystem(UNIT_SYSTEMS.METRIC)}
        className={`px-2.5 py-0.5 rounded-full font-bold tracking-widest uppercase transition-all ${!imp ? "bg-[#06B6D4] text-white shadow-[0_0_0_1px_rgba(6,182,212,0.4)]" : "text-slate-400 hover:text-white"}`}
        aria-pressed={!imp}>
        SI
      </button>
    </div>
  );
}
