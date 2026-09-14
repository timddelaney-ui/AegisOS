import React from "react";
import { AlertOctagon } from "lucide-react";
import { emergencyProtocols } from "../mock/workbookData";

const EmergencySheet = () => {
  return (
    <div className="flex flex-col gap-2">
      <div className="bg-[#FFC7CE] text-[#9C0006] px-2.5 py-2 text-xs font-bold rounded border border-[#F5C6CB] flex items-center gap-1.5">
        <AlertOctagon className="w-4 h-4" strokeWidth={2.5} />
        EMERGENCY WELL CONTROL PROTOCOLS
      </div>
      {emergencyProtocols.map((protocol, idx) => (
        <div
          key={idx}
          className="bg-[#FFF5F5] border border-[#F5C6CB] border-l-4 border-l-[#C00000] p-2.5 rounded"
        >
          <h3 className="text-xs font-bold text-[#721C24] mb-1">{protocol.title}</h3>
          <p className="text-[11px] text-[#333] font-mono whitespace-pre-line leading-relaxed">
            {protocol.steps}
          </p>
        </div>
      ))}
    </div>
  );
};

export default EmergencySheet;
