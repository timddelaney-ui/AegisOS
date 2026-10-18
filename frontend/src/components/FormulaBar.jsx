import React from "react";

const FormulaBar = ({ formulaText }) => {
  return (
    <div className="bg-white h-8 flex items-center px-2 border-b border-[#D4D4D4] flex-shrink-0 text-xs">
      <span className="font-bold text-[#FF6B1A] mr-2 font-mono">fx</span>
      <span className="text-[#595959] font-mono overflow-hidden text-ellipsis whitespace-nowrap">
        {formulaText}
      </span>
    </div>
  );
};

export default FormulaBar;
