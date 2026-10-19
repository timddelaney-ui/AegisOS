import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { UNIT_SYSTEMS, fromImp, toImp, unitLabel, fmt } from "../lib/units";

const STORAGE_KEY = "coilaegis_unit_system_v1";

const UnitContext = createContext(null);

export const UnitProvider = ({ children }) => {
  const [system, setSystemRaw] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || UNIT_SYSTEMS.IMPERIAL; }
    catch { return UNIT_SYSTEMS.IMPERIAL; }
  });

  const setSystem = useCallback((next) => {
    setSystemRaw(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { console.debug("[Units] write failed", e?.message); }
  }, []);

  const toggle = useCallback(() => {
    setSystem(system === UNIT_SYSTEMS.IMPERIAL ? UNIT_SYSTEMS.METRIC : UNIT_SYSTEMS.IMPERIAL);
  }, [system, setSystem]);

  // Convenience bindings pre-filled with the active system
  const value = {
    system,
    isMetric: system === UNIT_SYSTEMS.METRIC,
    isImperial: system === UNIT_SYSTEMS.IMPERIAL,
    setSystem,
    toggle,
    from: (v, dim) => fromImp(v, dim, system),
    to:   (v, dim) => toImp(v, dim, system),
    label: (dim) => unitLabel(dim, system),
    fmt:  (v, dim, opts) => fmt(v, dim, system, opts),
  };

  // Broadcast changes for any plain JS listeners (ex: imperative canvases)
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent("coilaegis:unit-change", { detail: { system } })); } catch (e) { /* ignore */ }
  }, [system]);

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
};

export const useUnits = () => {
  const ctx = useContext(UnitContext);
  if (!ctx) throw new Error("useUnits must be used within UnitProvider");
  return ctx;
};
