import React, { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "ctp_active_rig_v1";

export const RIGS = [
  { id: "RIG1", label: "Rig 1",  accent: "#107C41" },
  { id: "RIG2", label: "Rig 2",  accent: "#0056B3" },
  { id: "YARD", label: "Yard",   accent: "#C36600" },
];

const RigContext = createContext({ rigId: "RIG1", setRigId: () => {} });

export const RigProvider = ({ children }) => {
  const [rigId, setRigIdState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || "RIG1"; } catch { return "RIG1"; }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, rigId); } catch {}
  }, [rigId]);
  const setRigId = (id) => {
    if (RIGS.some((r) => r.id === id)) setRigIdState(id);
  };
  return <RigContext.Provider value={{ rigId, setRigId }}>{children}</RigContext.Provider>;
};

export const useRig = () => useContext(RigContext);
export const rigAccent = (id) => (RIGS.find((r) => r.id === id) || RIGS[0]).accent;
export const rigLabel  = (id) => (RIGS.find((r) => r.id === id) || RIGS[0]).label;
