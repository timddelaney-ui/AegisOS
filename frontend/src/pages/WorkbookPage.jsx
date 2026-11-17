import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ExcelHeader from "../components/ExcelHeader";
import FormulaBar from "../components/FormulaBar";
import SheetContent from "../components/SheetContent";
import EmergencySheet from "../components/EmergencySheet";
import SheetTabs from "../components/SheetTabs";
import Paywall from "../components/Paywall";
import ServiceToggle, { useServiceView } from "../components/ServiceToggle";
import { useUnits } from "../context/UnitContext";
import { useAuth, hasWorkbookAccess } from "../context/AuthContext";
import { workbookData } from "../mock/workbookData";
import { sheetInService } from "../lib/serviceCatalog";
import { useJobPrefill } from "../hooks/useJobPrefill";

const FREE_SHEETS = Object.keys(workbookData);

export default function WorkbookPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const seed = useJobPrefill();
  const initialLoadJob = location.state?.loadJob;
  const [currentSheet, setCurrentSheet] = useState(
    location.pathname === "/sop" || location.state?.openEmergency ? "EMERGENCY" : initialLoadJob?.sheet_key || "Pipe_Stretch",
  );
  const { system, setSystem } = useUnits();
  const unitSystem = system === "metric" ? "met" : "imp";
  const setUnitSystem = (v) => setSystem(v === "met" ? "metric" : "imperial");
  const [loadedValues, setLoadedValues] = useState(initialLoadJob?.values || null);
  const { user } = useAuth();
  const { service } = useServiceView();
  const unlocked = hasWorkbookAccess(user);

  useEffect(() => {
    if (location.pathname === "/sop" || location.state?.openEmergency) setCurrentSheet("EMERGENCY");
  }, [location.pathname, location.state?.openEmergency]);

  useEffect(() => {
    if (currentSheet === "EMERGENCY") return;
    if (!sheetInService(currentSheet, service)) {
      const first = Object.keys(workbookData).find((k) => sheetInService(k, service));
      if (first) setCurrentSheet(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  useEffect(() => {
    if (initialLoadJob?.unit_system) setSystem(initialLoadJob.unit_system === "met" ? "metric" : "imperial");
    if (initialLoadJob || location.state?.openEmergency) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheetIsLocked = !unlocked || (currentSheet !== "EMERGENCY" && !FREE_SHEETS.includes(currentSheet));
  const formulaText = currentSheet === "EMERGENCY" ? "=SAFETY_PROTOCOL(AER_DIRECTIVE_020)"
    : workbookData[currentSheet] ? `=VET_MODEL("${workbookData[currentSheet].sop.split("|")[0].trim()}")` : "=CALCULATE_CT_MODEL(API_5CT_SPEC)";

  return (
    <div className="workbook-root job-legacy-screen bg-[#F3F3F3] text-[#262626] flex flex-col min-h-[70dvh]">
      <ExcelHeader />
      <ServiceToggle compact />
      <FormulaBar formulaText={formulaText} />
      <p className="job-muted px-3 py-2">Input snapshot: {seed.source}. Explicit saved inputs take priority.</p>
      <div className="flex-1 overflow-y-auto p-2">
        {sheetIsLocked ? <Paywall sheetTitle={workbookData[currentSheet]?.title || "This sheet"} />
          : currentSheet === "EMERGENCY" ? <EmergencySheet />
            : <SheetContent sheetKey={currentSheet} unitSystem={unitSystem} onUnitChange={setUnitSystem} initialValues={loadedValues} hasTeam={!!user?.team_id} jobSeed={seed} />}
      </div>
      <SheetTabs currentSheet={currentSheet} onSelectSheet={(key) => { setCurrentSheet(key); setLoadedValues(null); }} freeSheets={FREE_SHEETS} isPro={unlocked} trialActive />
    </div>
  );
}
