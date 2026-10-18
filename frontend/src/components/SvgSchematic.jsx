import React, { useMemo } from "react";

// Extract numeric values from results panel by matching a label substring.
// Result values are strings formatted for display, so parseFloat.
function pickResult(results, ...patterns) {
  if (!results?.results) return null;
  for (const r of results.results) {
    const label = r.label.toLowerCase();
    if (patterns.some((p) => label.includes(p.toLowerCase()))) {
      const v = parseFloat(r.value);
      return isNaN(v) ? null : v;
    }
  }
  return null;
}

function severityColor(results, key) {
  if (!results?.warnings) return "safe";
  const has = results.warnings.some((w) => w.msg.toLowerCase().includes(key.toLowerCase()));
  if (!has) return "safe";
  const danger = results.warnings.find((w) => w.msg.toLowerCase().includes(key.toLowerCase()));
  return danger?.level === "danger" ? "danger" : "warn";
}

const SvgSchematic = ({ sheetKey, results }) => {
  const dyn = useMemo(() => {
    const r = results;
    return {
      // Common values
      depth: pickResult(r, "free-point depth", "sleeve tvd", "true vertical depth", "plug top", "plug height", "distance to target", "gun run depth", "dry depth"),
      pressure: pickResult(r, "bottomhole treating", "hydrostatic pressure", "surface pressure", "static column"),
      hoop: pickResult(r, "hoop stress"),
      friction: pickResult(r, "friction pressure", "friction gradient"),
      wob: pickResult(r, "weight on bit"),
      annVel: pickResult(r, "annular velocity"),
      fracGrad: pickResult(r, "frac gradient"),
      utilisation: pickResult(r, "utilisation"),
      warnings: r?.warnings || [],
    };
  }, [results]);

  const hasDanger = dyn.warnings.some((w) => w.level === "danger");
  const hasWarn = dyn.warnings.some((w) => w.level === "warn");
  const wellboreStroke = hasDanger ? "#C00000" : hasWarn ? "#DC7633" : "#7F7F7F";

  // Flow-arrow animation duration scales with pump rate (faster rate → faster flow)
  const flowSpeed = dyn.annVel ? Math.max(0.6, Math.min(3, 200 / (Math.max(50, dyn.annVel)))) : 1.5;

  const renderContent = () => {
    switch (sheetKey) {
      case "Pipe_Stretch": {
        const util = dyn.utilisation || 0;
        const arrowColor = util > 80 ? "#C00000" : util > 60 ? "#DC7633" : "#C44A08";
        return (
          <>
            <defs>
              <marker id="arr-pull" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={arrowColor} />
              </marker>
            </defs>
            <line x1="90" y1="20" x2="90" y2="100" stroke={arrowColor} strokeWidth="2" markerStart="url(#arr-pull)" markerEnd="url(#arr-pull)">
              <animate attributeName="stroke-dasharray" values="0,20;20,0" dur="1.5s" repeatCount="indefinite" />
            </line>
            <text x="45" y="60" fill={arrowColor} fontSize="9" fontWeight="bold">Overpull</text>
            <text x="45" y="72" fill={arrowColor} fontSize="8">{util ? `${util.toFixed(0)}% Fy` : ""}</text>
            <text x="150" y="55" fill="#FFF" fontSize="8" fontWeight="bold" textAnchor="middle">STRETCH</text>
            {dyn.depth && <text x="200" y="60" fill="#C44A08" fontSize="8" fontWeight="bold">Free @ {dyn.depth.toFixed(0)} ft</text>}
          </>
        );
      }
      case "Sand_Cleanout": {
        const v = dyn.annVel || 0;
        const flowColor = v < 100 ? "#DC7633" : "#002060";
        return (
          <>
            <defs>
              <marker id="arr-flow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={flowColor} />
              </marker>
            </defs>
            <path d="M118,95 L118,20" stroke={flowColor} strokeWidth="1.5" strokeDasharray="3,3" markerEnd="url(#arr-flow)">
              <animate attributeName="stroke-dashoffset" from="0" to="-12" dur={`${flowSpeed}s`} repeatCount="indefinite" />
            </path>
            <path d="M182,95 L182,20" stroke={flowColor} strokeWidth="1.5" strokeDasharray="3,3" markerEnd="url(#arr-flow)">
              <animate attributeName="stroke-dashoffset" from="0" to="-12" dur={`${flowSpeed}s`} repeatCount="indefinite" />
            </path>
            <text x="200" y="30" fill={flowColor} fontSize="8" fontWeight="bold">RETURN {v ? `${v.toFixed(0)} ft/min` : ""}</text>
            {[0, 1, 2, 3].map((i) => (
              <circle key={`solid-${i}`} cx={148 + (i % 2) * 4} cy={85 + i * 3} r="1.6" fill="#8B4513">
                <animate attributeName="cy" values={`${85 + i * 3};${45};${85 + i * 3}`} dur={`${flowSpeed * 2}s`} repeatCount="indefinite" />
              </circle>
            ))}
            <text x="150" y="55" fill="#FFF" fontSize="7" fontWeight="bold" textAnchor="middle">CT</text>
          </>
        );
      }
      case "CT_Milling":
      case "CT_Drilling": {
        const wob = dyn.wob || 0;
        const bitColor = wob > 2000 ? "#C00000" : wob > 0 ? "#DC7633" : "#7F7F7F";
        return (
          <>
            <polygon points="142,90 158,90 150,110" fill={bitColor} stroke="#333" strokeWidth="1">
              {wob > 0 && <animateTransform attributeName="transform" type="rotate" from="0 150 100" to="360 150 100" dur="1.5s" repeatCount="indefinite" />}
            </polygon>
            <text x="150" y="102" fill="#FFF" fontSize="6" fontWeight="bold" textAnchor="middle">{sheetKey === "CT_Milling" ? "MILL" : "BIT"}</text>
            <text x="195" y="100" fill={bitColor} fontSize="8" fontWeight="bold">WOB {wob ? `${wob.toFixed(0)} lb` : "—"}</text>
            {dyn.friction && (
              <text x="10" y="30" fill={dyn.friction > 5000 ? "#C00000" : "#C44A08"} fontSize="8" fontWeight="bold">
                ΔPf {dyn.friction.toFixed(0)} psi
              </text>
            )}
          </>
        );
      }
      case "Pill_Spotting": {
        const dist = dyn.depth || 0;
        return (
          <>
            <rect x="142" y="75" width="16" height="30" fill="#F39C12" opacity="0.9">
              <animate attributeName="y" values="15;75" dur="3s" repeatCount="indefinite" />
            </rect>
            <text x="150" y="95" fill="#FFF" fontSize="7" fontWeight="bold" textAnchor="middle">PILL</text>
            <text x="195" y="92" fill="#F39C12" fontSize="9" fontWeight="bold">Target {dist ? `${dist.toFixed(0)} ft` : ""}</text>
          </>
        );
      }
      case "Frac_Through_CT":
      case "Annular_Frac": {
        const bhtp = dyn.pressure || 0;
        const grad = dyn.fracGrad || 0;
        const gradColor = grad > 1 ? "#C00000" : grad > 0.9 ? "#DC7633" : "#C44A08";
        return (
          <>
            <defs>
              <radialGradient id="frac-glow">
                <stop offset="0%" stopColor="#FFD700" stopOpacity="1" />
                <stop offset="100%" stopColor="#C00000" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="150" cy="65" r="10" fill="url(#frac-glow)">
              <animate attributeName="r" values="6;14;6" dur="1.6s" repeatCount="indefinite" />
            </circle>
            {[0, 1, 2, 3].map((i) => {
              const angle = (i * Math.PI) / 2 + Math.PI / 4;
              const x2 = 150 + Math.cos(angle) * 40;
              const y2 = 65 + Math.sin(angle) * 25;
              return (
                <line key={`fpath-${i}`} x1="150" y1="65" x2={x2} y2={y2} stroke="#C00000" strokeWidth="1.5">
                  <animate attributeName="opacity" values="0.3;1;0.3" dur="1.6s" begin={`${i * 0.15}s`} repeatCount="indefinite" />
                </line>
              );
            })}
            <text x="150" y="40" fill="#C00000" fontSize="9" fontWeight="bold" textAnchor="middle">FRAC</text>
            {bhtp && <text x="10" y="30" fill="#C00000" fontSize="8" fontWeight="bold">BHTP {bhtp.toFixed(0)} psi</text>}
            {grad ? <text x="10" y="44" fill={gradColor} fontSize="8" fontWeight="bold">Grad {grad.toFixed(2)} psi/ft</text> : null}
          </>
        );
      }
      case "Mechanical_Sleeve":
      case "Hydraulic_Sleeve": {
        const util = dyn.utilisation || 0;
        const color = util > 80 ? "#C00000" : util > 60 ? "#DC7633" : "#FFC000";
        return (
          <>
            <rect x="140" y="68" width="20" height="6" fill={color} stroke="#333">
              <animate attributeName="x" values="140;145;140" dur="2s" repeatCount="indefinite" />
            </rect>
            <text x="150" y="73" fill="#333" fontSize="4.5" fontWeight="bold" textAnchor="middle">SLEEVE</text>
            <text x="195" y="72" fill={color} fontSize="8" fontWeight="bold">{util ? `${util.toFixed(0)}% util` : "SHIFT"}</text>
          </>
        );
      }
      case "Nitrogen_Purge":
      case "Nitrogen_Kickoff": {
        return (
          <>
            {[0, 1, 2, 3, 4].map((i) => (
              <circle key={`n2-${i}`} cx={148 + (i % 2) * 4} cy={85 - i * 12} r="2.5" fill="#5DADE2" opacity="0.85">
                <animate attributeName="cy" values={`90;10`} dur={`${flowSpeed * 2}s`} begin={`${i * 0.35}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.9;0" dur={`${flowSpeed * 2}s`} begin={`${i * 0.35}s`} repeatCount="indefinite" />
              </circle>
            ))}
            <text x="200" y="60" fill="#2874A6" fontSize="9" fontWeight="bold">N₂ FLOW</text>
            {dyn.pressure && <text x="10" y="30" fill="#2874A6" fontSize="8" fontWeight="bold">P {dyn.pressure.toFixed(0)} psi</text>}
          </>
        );
      }
      case "Acid_Stimulation":
      case "Scale_Squeeze":
        return (
          <>
            <rect x="142" y="80" width="16" height="25" fill="#E74C3C" opacity="0.75">
              <animate attributeName="opacity" values="0.4;0.9;0.4" dur="1.5s" repeatCount="indefinite" />
            </rect>
            <text x="150" y="96" fill="#FFF" fontSize="6" fontWeight="bold" textAnchor="middle">CHEM</text>
            {[0, 1, 2].map((i) => (
              <path key={`chem-l-${i}`} d={`M120,${85 + i * 4} L100,${85 + i * 4}`} stroke="#E74C3C" strokeWidth="1" strokeDasharray="2">
                <animate attributeName="stroke-dashoffset" from="0" to="-8" dur="1.5s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
              </path>
            ))}
            {[0, 1, 2].map((i) => (
              <path key={`r${i}`} d={`M180,${85 + i * 4} L200,${85 + i * 4}`} stroke="#E74C3C" strokeWidth="1" strokeDasharray="2">
                <animate attributeName="stroke-dashoffset" from="0" to="-8" dur="1.5s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
              </path>
            ))}
          </>
        );
      case "Cement_Plug":
      case "Well_Abandonment": {
        const compliant = dyn.depth ? dyn.depth >= 165 : true;
        return (
          <>
            <rect x="110" y="65" width="80" height="45" fill={compliant ? "#95A5A6" : "#C00000"} opacity="0.9" />
            <text x="150" y="90" fill="#FFF" fontSize="9" fontWeight="bold" textAnchor="middle">CEMENT</text>
            {dyn.depth && (
              <text x="150" y="102" fill="#FFF" fontSize="7" fontWeight="bold" textAnchor="middle">
                {dyn.depth.toFixed(0)} ft {compliant ? "✓" : "✗ Dir 020"}
              </text>
            )}
          </>
        );
      }
      case "CT_Perforating":
        return (
          <>
            <rect x="144" y="80" width="12" height="20" fill="#333" stroke="#C00000" />
            {[85, 90, 95].map((y, i) => (
              <React.Fragment key={`grid-${y}`}>
                <line x1="156" y1={y} x2="170" y2={y - 2} stroke="#C00000" strokeWidth="1.5">
                  <animate attributeName="opacity" values="0;1;0" dur="0.6s" begin={`${i * 0.15}s`} repeatCount="indefinite" />
                </line>
                <line x1="144" y1={y} x2="130" y2={y - 2} stroke="#C00000" strokeWidth="1.5">
                  <animate attributeName="opacity" values="0;1;0" dur="0.6s" begin={`${i * 0.15}s`} repeatCount="indefinite" />
                </line>
              </React.Fragment>
            ))}
            <text x="195" y="92" fill="#C00000" fontSize="8" fontWeight="bold">PERF</text>
          </>
        );
      case "Fishing_Ops": {
        const util = dyn.utilisation || 0;
        const color = util > 100 ? "#C00000" : util > 80 ? "#DC7633" : "#8B4513";
        return (
          <>
            <line x1="150" y1="90" x2="150" y2="105" stroke={color} strokeWidth="2">
              <animate attributeName="y1" values="88;92;88" dur="1s" repeatCount="indefinite" />
            </line>
            <rect x="144" y="98" width="12" height="8" fill={color} />
            <text x="195" y="102" fill={color} fontSize="8" fontWeight="bold">FISH {util ? `${util.toFixed(0)}%` : ""}</text>
          </>
        );
      }
      default:
        return <text x="150" y="60" fill="#333" fontSize="9" fontWeight="bold" textAnchor="middle">MODEL ACTIVE</text>;
    }
  };

  return (
    <svg width="100%" height="100%" viewBox="0 0 300 120" preserveAspectRatio="xMidYMid meet">
      {/* Wellbore Casing (colour reflects overall safety state) */}
      <rect x="110" y="10" width="80" height="100" fill="#EAEAEA" stroke={wellboreStroke} strokeWidth="2" />
      {/* CT String */}
      <rect x="142" y="10" width="16" height="80" fill="#FF6B1A" stroke="#0B5329" strokeWidth="1" />
      {renderContent()}
    </svg>
  );
};

export default SvgSchematic;
