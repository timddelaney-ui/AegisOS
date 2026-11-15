import React, { useRef, useEffect, useMemo } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { workbookData } from "../mock/workbookData";
import { sheetInService } from "../lib/serviceCatalog";
import { useServiceView } from "./ServiceToggle";

const SheetTabs = ({ currentSheet, onSelectSheet, freeSheets = [], isPro = false, trialActive = false }) => {
  const containerRef = useRef(null);
  const activeTabRef = useRef(null);
  const { service } = useServiceView();

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

  // Memoise the service-filtered sheet list — workbookData is static and the
  // filter only re-runs when the service view toggle changes.
  const visibleKeys = useMemo(
    () => Object.keys(workbookData).filter((key) => sheetInService(key, service)),
    [service],
  );

  return (
    <nav
      ref={containerRef}
      className="bg-[#E1E1E1] h-[46px] flex items-center border-t border-[#BCBCBC] flex-shrink-0 overflow-x-auto whitespace-nowrap px-1 gap-[2px] snap-tabs scroll-fade-right"
    >
      {visibleKeys.map((key) => {
        const isActive = key === currentSheet;
        const locked = isLocked(key);
        return (
          <button
            type="button"
            aria-pressed={isActive}
            key={key}
            ref={isActive ? activeTabRef : null}
            onClick={() => onSelectSheet(key)}
            className={`px-3 py-2 text-xs font-medium cursor-pointer select-none rounded-t border border-b-0 border-[#CCC] inline-flex items-center gap-1 flex-shrink-0 min-h-[44px] ${
              isActive
                ? "bg-white text-[#FF6B1A] font-bold border-t-2 border-t-[#FF6B1A] -mb-px"
                : locked
                ? "bg-[#E1E1E1] text-[#888]"
                : "bg-[#E1E1E1] text-[#333]"
            }`}
          >
            {locked && <Lock className="w-2.5 h-2.5 text-[#856404]" strokeWidth={2.5} />}
            {key}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Emergency SOPs"
        aria-pressed={currentSheet === "EMERGENCY"}
        ref={currentSheet === "EMERGENCY" ? activeTabRef : null}
        onClick={() => onSelectSheet("EMERGENCY")}
        className={`px-3 py-2 text-xs font-bold cursor-pointer select-none rounded-t border border-b-0 border-[#CCC] flex-shrink-0 inline-flex items-center gap-1 min-h-[44px] ${
          currentSheet === "EMERGENCY"
            ? "bg-white text-[#C00000] border-t-2 border-t-[#C00000] -mb-px"
            : "bg-[#FFC7CE] text-[#9C0006]"
        }`}
      >
        <AlertTriangle className="w-3 h-3" strokeWidth={2.5} />
        Emergency_SOPs
        {!isPro && currentSheet !== "EMERGENCY" && <Lock className="w-2.5 h-2.5 text-[#9C0006]" strokeWidth={2.5} />}
      </button>
    </nav>
  );
};

export default SheetTabs;
