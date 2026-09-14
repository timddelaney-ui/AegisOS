import React, { useState } from "react";
import ExcelHeader from "./components/ExcelHeader";
import FormulaBar from "./components/FormulaBar";
import SheetContent from "./components/SheetContent";
import EmergencySheet from "./components/EmergencySheet";
import SheetTabs from "./components/SheetTabs";
import { workbookData } from "./mock/workbookData";
import "./App.css";

function App() {
  const [currentSheet, setCurrentSheet] = useState("Pipe_Stretch");
  const [unitSystem, setUnitSystem] = useState("imp");

  const getFormulaText = () => {
    if (currentSheet === "EMERGENCY") {
      return "=SAFETY_PROTOCOL(AER_DIRECTIVE_020)";
    }
    const data = workbookData[currentSheet];
    if (!data) return "=CALCULATE_CT_MODEL(API_5CT_SPEC)";
    const sopCode = data.sop.split("|")[0].trim();
    return `=VET_MODEL("${sopCode}")`;
  };

  return (
    <div className="bg-[#F3F3F3] text-[#262626] flex flex-col h-screen overflow-hidden">
      <ExcelHeader />
      <FormulaBar formulaText={getFormulaText()} />
      <div className="flex-1 overflow-y-auto p-2">
        {currentSheet === "EMERGENCY" ? (
          <EmergencySheet />
        ) : (
          <SheetContent
            sheetKey={currentSheet}
            unitSystem={unitSystem}
            onUnitChange={setUnitSystem}
          />
        )}
      </div>
      <SheetTabs currentSheet={currentSheet} onSelectSheet={setCurrentSheet} />
    </div>
  );
}

export default App;
