import React from "react";
import { FileSpreadsheet } from "lucide-react";

const ExcelHeader = () => {
  return (
    <header className="bg-[#107C41] text-white h-12 flex items-center justify-between px-3 shadow-md flex-shrink-0">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4" strokeWidth={2.5} />
        <h1 className="text-sm font-semibold tracking-wide">CT_Field_Operations.xlsx</h1>
      </div>
      <div className="text-[10px] bg-white/20 px-1.5 py-[3px] rounded font-medium">
        MOBILE SPREADSHEET
      </div>
    </header>
  );
};

export default ExcelHeader;
