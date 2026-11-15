import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";
import ExcelHeader from "../components/ExcelHeader";
import FormulaBar from "../components/FormulaBar";
import SheetContent from "../components/SheetContent";
import EmergencySheet from "../components/EmergencySheet";
import SheetTabs from "../components/SheetTabs";
import Paywall from "../components/Paywall";
import ServiceToggle, { useServiceView } from "../components/ServiceToggle";
import { useUnits } from "../context/UnitContext";
import { useAuth, isProUser, hasWorkbookAccess } from "../context/AuthContext";
import { workbookData } from "../mock/workbookData";
import { sheetInService } from "../lib/serviceCatalog";
import { useJobPrefill } from "../hooks/useJobPrefill";

const FREE_SHEETS = ["Pipe_Stretch", "Sand_Cleanout", "Fishing_Ops"];

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
  const isPro = isProUser(user);
  const unlocked = hasWorkbookAccess(user) || isPro;
  const msLeft = user?.trial_expires_at ? new Date(user.trial_expires_at).getTime() - Date.now() : 0;
  const trial = { active: msLeft > 0, daysLeft: Math.max(0, Math.floor(msLeft / 86400000)), hoursLeft: Math.max(0, Math.floor(msLeft / 3600000)) };

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

  const sheetIsLocked = !unlocked && (currentSheet === "EMERGENCY" || !FREE_SHEETS.includes(currentSheet));
  const formulaText = currentSheet === "EMERGENCY" ? "=SAFETY_PROTOCOL(AER_DIRECTIVE_020)"
    : workbookData[currentSheet] ? `=VET_MODEL("${workbookData[currentSheet].sop.split("|")[0].trim()}")` : "=CALCULATE_CT_MODEL(API_5CT_SPEC)";

  return (
    <div className="workbook-root job-legacy-screen bg-[#F3F3F3] text-[#262626] flex flex-col min-h-[70dvh]">
      <ExcelHeader />
      <ServiceToggle compact />
      <FormulaBar formulaText={formulaText} />
      <p className="job-muted px-3 py-2">Input snapshot: {seed.source}. Explicit saved inputs take priority.</p>
      {!isPro && (
        <div className={`border-b px-3 py-1.5 flex items-center justify-between text-[11px] flex-shrink-0 ${trial.active ? "bg-[#FFF3CD] text-[#856404]" : "bg-[#F8D7DA] text-[#721C24]"}`}>
          <span className="font-semibold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {trial.active ? trial.daysLeft > 0 ? `${trial.daysLeft} day${trial.daysLeft !== 1 ? "s" : ""} left in your 30-day trial` : `${trial.hoursLeft}h left in your 30-day trial` : "Trial ended - subscribe to keep working"}
          </span>
          <a href="/pricing" className="text-[#C44A08] font-bold min-h-11 inline-flex items-center">Upgrade</a>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2">
        {sheetIsLocked ? <Paywall sheetTitle={currentSheet === "EMERGENCY" ? "Emergency SOPs" : workbookData[currentSheet]?.title || "This sheet"} trialExpired={!trial.active} />
          : currentSheet === "EMERGENCY" ? <EmergencySheet />
            : <SheetContent sheetKey={currentSheet} unitSystem={unitSystem} onUnitChange={setUnitSystem} initialValues={loadedValues} hasTeam={!!user?.team_id} jobSeed={seed} />}
      </div>
      <SheetTabs currentSheet={currentSheet} onSelectSheet={(key) => { setCurrentSheet(key); setLoadedValues(null); }} freeSheets={FREE_SHEETS} isPro={unlocked} trialActive />
    </div>
  );
}
