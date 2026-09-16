import React from "react";
import { Radio } from "lucide-react";
import { RIGS, useRig } from "../context/RigContext";

/**
 * Persistent global Rig Selector — sits below the ExcelHeader / above content.
 * Every page reads useRig() and filters data by rigId.
 */
const RigSelector = () => {
  const { rigId, setRigId } = useRig();
  return (
    <div
      data-testid="rig-selector"
      className="bg-[#1E1E1E] text-white px-2 py-1 flex items-center gap-2 flex-shrink-0 border-b border-[#333]"
    >
      <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-[#9CA3AF]">
        <Radio className="w-3 h-3" strokeWidth={2.5} />
        <span>Active Rig</span>
      </div>
      <div className="flex gap-1 flex-1 overflow-x-auto">
        {RIGS.map((r) => {
          const active = r.id === rigId;
          return (
            <button
              key={r.id}
              data-testid={`rig-btn-${r.id}`}
              onClick={() => setRigId(r.id)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded whitespace-nowrap transition-colors ${
                active ? "text-white" : "text-[#9CA3AF] hover:text-white hover:bg-[#333]"
              }`}
              style={active ? { background: r.accent } : {}}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <span className="text-[9px] text-[#666] hidden sm:block">All data filtered by rig</span>
    </div>
  );
};

export default RigSelector;
