import React, { useRef, useEffect } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { workbookData } from "../mock/workbookData";

const SheetTabs = ({ currentSheet, onSelectSheet, freeSheets = [], isPro = false, trialActive = false }) => {
  const containerRef = useRef(null);
  const activeTabRef = useRef(null);

  useEffect(() => {
    if (activeTabRef.current && containerRef.current) {
      const tab = activeTabRef.current;
      const container = containerRef.current;
      const tabLeft = tab.offsetLeft;
      const tabRight = tabLeft + tab.offsetWidth;
      const containerScrollLeft = container.scrollLeft;
      const containerRight = containerScrollLeft + container.clientWidth;
      if (tabLeft < containerScrollLeft || tabRight > containerRight) {
        container.scrollTo({ left: tabLeft - 20, behavior: "smooth" });
      }
    }
  }, [currentSheet]);

  // A sheet is locked when the user is NOT Pro and either:
  // - the sheet is not in the free list, OR
  // - the trial has expired (in which case even free sheets are locked)
  const isLocked = (key) => {
    if (isPro) return false;
    if (!trialActive) return true; // trial expired
    return !freeSheets.includes(key);
  };

  return (
    <nav
      ref={containerRef}
      className="bg-[#E1E1E1] h-[42px] flex items-center border-t border-[#BCBCBC] flex-shrink-0 overflow-x-auto whitespace-nowrap px-1 gap-[2px]"
      style={{ scrollbarWidth: "thin" }}
    >
      {Object.keys(workbookData).map((key) => {
        const isActive = key === currentSheet;
        const locked = isLocked(key);
        return (
          <div
            key={key}
            ref={isActive ? activeTabRef : null}
            onClick={() => onSelectSheet(key)}
            className={`px-3 py-1.5 text-xs font-medium cursor-pointer select-none rounded-t border border-b-0 border-[#CCC] inline-block flex-shrink-0 flex items-center gap-1 ${
              isActive
                ? "bg-white text-[#107C41] font-bold border-t-2 border-t-[#107C41] -mb-px"
                : locked
                ? "bg-[#E1E1E1] text-[#888]"
                : "bg-[#E1E1E1] text-[#333]"
            }`}
          >
            {locked && <Lock className="w-2.5 h-2.5 text-[#856404]" strokeWidth={2.5} />}
            {key}
          </div>
        );
      })}
      <div
        ref={currentSheet === "EMERGENCY" ? activeTabRef : null}
        onClick={() => onSelectSheet("EMERGENCY")}
        className={`px-3 py-1.5 text-xs font-bold cursor-pointer select-none rounded-t border border-b-0 border-[#CCC] flex-shrink-0 flex items-center gap-1 ${
          currentSheet === "EMERGENCY"
            ? "bg-white text-[#C00000] border-t-2 border-t-[#C00000] -mb-px"
            : "bg-[#FFC7CE] text-[#9C0006]"
        }`}
      >
        <AlertTriangle className="w-3 h-3" strokeWidth={2.5} />
        Emergency_SOPs
        {!isPro && currentSheet !== "EMERGENCY" && <Lock className="w-2.5 h-2.5 text-[#9C0006]" strokeWidth={2.5} />}
      </div>
    </nav>
  );
};

export default SheetTabs;
