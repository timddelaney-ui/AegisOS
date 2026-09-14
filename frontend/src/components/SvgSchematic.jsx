import React from "react";

const SvgSchematic = ({ sheetKey }) => {
  const renderContent = () => {
    switch (sheetKey) {
      case "Pipe_Stretch":
        return (
          <>
            <defs>
              <marker id="arrow-red" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#C00000" />
              </marker>
            </defs>
            <line x1="85" y1="20" x2="85" y2="100" stroke="#C00000" strokeWidth="2" markerStart="url(#arrow-red)" markerEnd="url(#arrow-red)" />
            <text x="40" y="64" fill="#C00000" fontSize="9" fontWeight="bold">Overpull</text>
            <text x="150" y="55" fill="#FFFFFF" fontSize="8" fontWeight="bold" textAnchor="middle">STRETCH</text>
          </>
        );
      case "Sand_Cleanout":
        return (
          <>
            <defs>
              <marker id="arrow-blue" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#002060" />
              </marker>
            </defs>
            <path d="M170,90 L170,25" stroke="#002060" strokeWidth="2" strokeDasharray="4" markerEnd="url(#arrow-blue)" />
            <text x="185" y="22" fill="#002060" fontSize="9" fontWeight="bold">FLUID RETURN</text>
            <circle cx="150" cy="85" r="2" fill="#8B4513" />
            <circle cx="148" cy="92" r="1.5" fill="#8B4513" />
            <circle cx="152" cy="88" r="1.5" fill="#8B4513" />
          </>
        );
      case "CT_Milling":
      case "CT_Drilling":
        return (
          <>
            <polygon points="142,90 158,90 150,110" fill="#C00000" stroke="#333" strokeWidth="1" />
            <text x="150" y="102" fill="#FFFFFF" fontSize="7" fontWeight="bold" textAnchor="middle">{sheetKey === "CT_Milling" ? "MILL" : "BIT"}</text>
            <line x1="150" y1="110" x2="150" y2="115" stroke="#C00000" strokeWidth="2" strokeDasharray="2" />
          </>
        );
      case "Pill_Spotting":
        return (
          <>
            <rect x="142" y="80" width="16" height="25" fill="#F39C12" opacity="0.85" />
            <text x="150" y="95" fill="#FFFFFF" fontSize="7" fontWeight="bold" textAnchor="middle">PILL</text>
            <text x="195" y="92" fill="#F39C12" fontSize="9" fontWeight="bold">Spot Zone</text>
          </>
        );
      case "Frac_Through_CT":
      case "Annular_Frac":
        return (
          <>
            <path d="M120,60 L100,55 M120,70 L100,72 M180,60 L200,55 M180,70 L200,72" stroke="#C00000" strokeWidth="1.5" />
            <text x="150" y="40" fill="#C00000" fontSize="9" fontWeight="bold" textAnchor="middle">FRAC</text>
            <circle cx="150" cy="65" r="3" fill="#FFD700" />
          </>
        );
      case "Mechanical_Sleeve":
      case "Hydraulic_Sleeve":
        return (
          <>
            <rect x="140" y="70" width="20" height="6" fill="#FFC000" stroke="#333" />
            <text x="150" y="76" fill="#333" fontSize="5" fontWeight="bold" textAnchor="middle">SLEEVE</text>
            <text x="195" y="73" fill="#F39C12" fontSize="8" fontWeight="bold">SHIFT</text>
          </>
        );
      case "Nitrogen_Purge":
      case "Nitrogen_Kickoff":
        return (
          <>
            <circle cx="150" cy="40" r="2" fill="#5DADE2" opacity="0.8" />
            <circle cx="146" cy="55" r="2" fill="#5DADE2" opacity="0.8" />
            <circle cx="154" cy="70" r="2" fill="#5DADE2" opacity="0.8" />
            <circle cx="148" cy="85" r="2" fill="#5DADE2" opacity="0.8" />
            <text x="195" y="60" fill="#2874A6" fontSize="9" fontWeight="bold">N₂ FLOW</text>
          </>
        );
      case "Acid_Stimulation":
      case "Scale_Squeeze":
        return (
          <>
            <rect x="142" y="85" width="16" height="20" fill="#E74C3C" opacity="0.7" />
            <text x="150" y="98" fill="#FFFFFF" fontSize="6" fontWeight="bold" textAnchor="middle">CHEM</text>
            <path d="M120,95 L100,98 M180,95 L200,98" stroke="#E74C3C" strokeWidth="1" strokeDasharray="2" />
          </>
        );
      case "Cement_Plug":
      case "Well_Abandonment":
        return (
          <>
            <rect x="110" y="85" width="80" height="20" fill="#95A5A6" opacity="0.9" />
            <text x="150" y="98" fill="#FFFFFF" fontSize="8" fontWeight="bold" textAnchor="middle">CEMENT</text>
          </>
        );
      case "CT_Perforating":
        return (
          <>
            <rect x="144" y="80" width="12" height="20" fill="#333" stroke="#C00000" />
            <path d="M156,85 L165,83 M156,90 L165,90 M156,95 L165,97" stroke="#C00000" strokeWidth="1.5" />
            <path d="M144,85 L135,83 M144,90 L135,90 M144,95 L135,97" stroke="#C00000" strokeWidth="1.5" />
            <text x="195" y="92" fill="#C00000" fontSize="8" fontWeight="bold">PERF</text>
          </>
        );
      case "Fishing_Ops":
        return (
          <>
            <path d="M148,90 Q150,100 152,90 Q154,95 156,90" fill="none" stroke="#8B4513" strokeWidth="2" />
            <rect x="144" y="98" width="12" height="8" fill="#8B4513" />
            <text x="195" y="102" fill="#8B4513" fontSize="8" fontWeight="bold">FISH</text>
          </>
        );
      default:
        return <text x="150" y="60" fill="#333" fontSize="9" fontWeight="bold" textAnchor="middle">MODEL ACTIVE</text>;
    }
  };

  return (
    <svg width="100%" height="100%" viewBox="0 0 300 120" preserveAspectRatio="xMidYMid meet">
      {/* Wellbore Casing */}
      <rect x="110" y="10" width="80" height="100" fill="#EAEAEA" stroke="#7F7F7F" strokeWidth="2" />
      {/* CT String */}
      <rect x="142" y="10" width="16" height="80" fill="#107C41" stroke="#0B5329" strokeWidth="1" />
      {/* Dynamic Schematic Graphic */}
      {renderContent()}
    </svg>
  );
};

export default SvgSchematic;
