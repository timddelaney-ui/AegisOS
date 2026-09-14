// Mock data for CT Field Operations Workbook
export const workbookData = {
  Pipe_Stretch: {
    title: "Pipe Stretch & Free-Point",
    sop: "SOP-CT-12 | API 5CT Precision Free-Point",
    imp: ["Measured Stretch (in)", "Overpull (lbs)", "CT OD (in)", "CT ID (in)", "Current Depth (ft)"],
    met: ["Measured Stretch (mm)", "Overpull (daN)", "CT OD (mm)", "CT ID (mm)", "Current Depth (m)"],
  },
  Sand_Cleanout: {
    title: "Sand & Debris Cleanout",
    sop: "SOP-CT-04 | API Spec 5ST Sand Cleanout",
    imp: ["Flow Rate (BPM)", "Casing ID (in)", "Tubing OD (in)", "Fluid Viscosity (cp)", "Current Depth (ft)"],
    met: ["Flow Rate (L/min)", "Casing ID (mm)", "Tubing OD (mm)", "Fluid Viscosity (cp)", "Current Depth (m)"],
  },
  CT_Milling: {
    title: "Composite Plug Milling",
    sop: "SOP-CT-25 | Composite Milling Hydraulics & WOB",
    imp: ["Depth (ft)", "CT OD (in)", "CT ID (in)", "Casing ID (in)", "Surface Wt (lbs)", "Up Weight (lbs)", "Pump Rate (BPM)", "Viscosity (cp)", "Density (ppg)"],
    met: ["Depth (m)", "CT OD (mm)", "CT ID (mm)", "Casing ID (mm)", "Surface Wt (daN)", "Up Weight (daN)", "Pump Rate (L/min)", "Viscosity (cp)", "Density (kg/m3)"],
  },
  CT_Drilling: {
    title: "Lateral CT Drilling",
    sop: "SOP-CT-27 | Lateral CT Drilling Dynamics",
    imp: ["Depth (ft)", "CT OD (in)", "CT ID (in)", "Casing ID (in)", "Surface Wt (lbs)", "Up Weight (lbs)", "Pump Rate (BPM)", "ROP (ft/hr)", "Density (ppg)"],
    met: ["Depth (m)", "CT OD (mm)", "CT ID (mm)", "Casing ID (mm)", "Surface Wt (daN)", "Up Weight (daN)", "Pump Rate (L/min)", "ROP (m/hr)", "Density (kg/m3)"],
  },
  Pill_Spotting: {
    title: "Chemical Pill Spotting",
    sop: "SOP-CT-10 | Precision Pill Spotting",
    imp: ["Current Depth (ft)", "Target Depth (ft)", "Pill Vol (bbl)", "CT OD (in)", "CT ID (in)", "Casing ID (in)", "Pump Rate (BPM)", "Density (ppg)"],
    met: ["Current Depth (m)", "Target Depth (m)", "Pill Vol (m3)", "CT OD (mm)", "CT ID (mm)", "Casing ID (mm)", "Pump Rate (L/min)", "Density (kg/m3)"],
  },
  Frac_Through_CT: {
    title: "Frac Through Coiled Tubing",
    sop: "SOP-CT-19 | Frac Through CT & Friction",
    imp: ["Depth (ft)", "CT OD (in)", "CT ID (in)", "Casing ID (in)", "Treating P (PSI)", "Pump Rate (BPM)", "Proppant (ppa)", "Density (ppg)"],
    met: ["Depth (m)", "CT OD (mm)", "CT ID (mm)", "Casing ID (mm)", "Treating P (MPa)", "Pump Rate (L/min)", "Proppant (kg/m3)", "Density (kg/m3)"],
  },
  Annular_Frac: {
    title: "CT Annular Fracturing",
    sop: "SOP-CT-18 | AER Dir 009 Annular Fracturing",
    imp: ["Stage #", "Base Depth (ft)", "Offset (ft)", "Treating P (PSI)", "Pump Rate (BPM)", "Density (ppg)", "Casing ID (in)", "Tubing OD (in)"],
    met: ["Stage #", "Base Depth (m)", "Offset (m)", "Treating P (MPa)", "Pump Rate (L/min)", "Density (kg/m3)", "Casing ID (mm)", "Tubing OD (mm)"],
  },
  Mechanical_Sleeve: {
    title: "Mechanical Sleeve Shift",
    sop: "SOP-CT-42 | API Spec 11D1 Mechanical Shifting",
    imp: ["Stage #", "Base Depth (ft)", "Offset (ft)", "Shift Force (lbs)", "String Drag (lbs)"],
    met: ["Stage #", "Base Depth (m)", "Offset (m)", "Shift Force (daN)", "String Drag (daN)"],
  },
  Hydraulic_Sleeve: {
    title: "Pressure-Actuated Sleeve",
    sop: "SOP-CT-43 | API Spec 11D1 Hydraulic Actuation",
    imp: ["Stage #", "Base Depth (ft)", "Offset (ft)", "Target P (PSI)"],
    met: ["Stage #", "Base Depth (m)", "Offset (m)", "Target P (MPa)"],
  },
  Nitrogen_Purge: {
    title: "Nitrogen Purge & Sweep",
    sop: "SOP-CT-09 | CSA Z662 Nitrogen Purge",
    imp: ["Tubing ID (in)", "Surface P (PSI)", "N2 Rate (SCFM)", "Current Depth (ft)"],
    met: ["Tubing ID (mm)", "Surface P (MPa)", "N2 Rate (Sm3/min)", "Current Depth (m)"],
  },
  Nitrogen_Kickoff: {
    title: "Nitrogen Lift / Kick-Off",
    sop: "SOP-CT-11 | API Spec 11V N2 Unloading",
    imp: ["Depth (ft)", "Gradient (psi/ft)", "N2 Rate (SCFM)", "Static Level (ft)"],
    met: ["Depth (m)", "Gradient (kPa/m)", "N2 Rate (Sm3/min)", "Static Level (m)"],
  },
  Acid_Stimulation: {
    title: "Matrix Acid Stimulation",
    sop: "SOP-CT-15 | AER Dir 035 Matrix Acid Placement",
    imp: ["Acid Vol (bbl)", "Pump Rate (BPM)", "BHT (deg F)", "Depth (ft)", "CT ID (in)"],
    met: ["Acid Vol (m3)", "Pump Rate (L/min)", "BHT (deg C)", "Depth (m)", "CT ID (mm)"],
  },
  Scale_Squeeze: {
    title: "Scale Squeeze Treatment",
    sop: "SOP-CT-22 | Scale Inhibitor Placement",
    imp: ["Inhibitor Vol (bbl)", "Pump Rate (BPM)", "Perforated Interval (ft)", "Casing ID (in)", "Formation Temp (deg F)"],
    met: ["Inhibitor Vol (m3)", "Pump Rate (L/min)", "Perforated Interval (m)", "Casing ID (mm)", "Formation Temp (deg C)"],
  },
  Cement_Plug: {
    title: "Balanced Cement Plug",
    sop: "SOP-CT-08 | AER Dir 020 Balanced Cement Plug",
    imp: ["Slurry Wt (ppg)", "Slurry Vol (bbl)", "Casing ID (in)", "Yield (cu.ft/sk)", "Current Depth (ft)"],
    met: ["Slurry Wt (kg/m3)", "Slurry Vol (m3)", "Casing ID (mm)", "Yield (m3/sk)", "Current Depth (m)"],
  },
  Well_Abandonment: {
    title: "Well Abandonment",
    sop: "SOP-CT-45 | AER Directive 020 Well Abandonment",
    imp: ["Current Depth (ft)", "Plug Depth (ft)", "Cement Vol (bbl)", "Slurry Wt (ppg)", "Casing ID (in)"],
    met: ["Current Depth (m)", "Plug Depth (m)", "Cement Vol (m3)", "Slurry Wt (kg/m3)", "Casing ID (mm)"],
  },
  CT_Perforating: {
    title: "CT-Conveyed Perforating",
    sop: "SOP-CT-33 | Through-Tubing Perforating",
    imp: ["Depth (ft)", "Gun OD (in)", "Casing ID (in)", "Firing P (PSI)"],
    met: ["Depth (m)", "Gun OD (mm)", "Casing ID (mm)", "Firing P (MPa)"],
  },
  Fishing_Ops: {
    title: "Fishing Operations",
    sop: "SOP-CT-30 | API Spec 7-1 Overpull & Jarring",
    imp: ["Fish Wt (lbs)", "Jar Overpull (lbs)", "Tubing OD (in)"],
    met: ["Fish Wt (daN)", "Jar Overpull (daN)", "Tubing OD (mm)"],
  },
};

export const emergencyProtocols = [
  {
    title: "1. UNCONTROLLED DESCENT OF COIL",
    steps: "1) Reverse motors in falling direction.\n2) Increase reel brake drag.\n3) Close & lock pipe/slip rams once stopped.\n4) Inspect for ovality/bird-caging.",
  },
  {
    title: "2. PIPE NEAR BOTTOM BOP",
    steps: "1) Stop operations & headcount crew.\n2) Pull bottom into control section.\n3) Set slip rams.\n4) Ensure accumulator charged, activate shear rams.",
  },
  {
    title: "3. ACCUMULATOR FAILURE",
    steps: "1) Stop coil & apply brake.\n2) Close & lock pipe/slip rams.\n3) Chain reel, monitor SICP/BCP, deenergize 12V power.",
  },
  {
    title: "4. LOSS OF HOSELINE PRESSURE",
    steps: "1) Stop coil, notify rig manager.\n2) Manually close slip rams.\n3) Bleed back up to continue operations < 7,000 PSI.",
  },
];

export const getDefaultValue = (param, unitSystem) => {
  if (param.includes("Stage")) return "1";
  if (param.includes("Target Depth") || param.includes("Plug Depth")) return "5000";
  if (param.includes("Depth") || param.includes("Base")) return "5200";
  if (param.includes("Stretch")) return unitSystem === "imp" ? "3.5" : "88.9";
  if (param.includes("Overpull") || param.includes("Up Weight") || param.includes("Surface Wt") || param.includes("Shift Force") || param.includes("Fish Wt") || param.includes("Jar")) return "6500";
  if (param.includes("String Drag")) return "1200";
  if (param.includes("Treating P") || param.includes("Firing P") || param.includes("Target P") || param.includes("Surface P")) return unitSystem === "imp" ? "7500" : "51.7";
  if (param.includes("Vol")) return unitSystem === "imp" ? "25" : "3.97";
  if (param.includes("Rate")) return unitSystem === "imp" ? "3.5" : "556";
  if (param.includes("OD")) return unitSystem === "imp" ? "1.5" : "38.1";
  if (param.includes("Tubing ID") || param.includes("CT ID") || param.includes("Gun OD")) return unitSystem === "imp" ? "1.25" : "31.75";
  if (param.includes("Casing")) return unitSystem === "imp" ? "4.5" : "114.3";
  if (param.includes("Viscosity")) return "35";
  if (param.includes("Density") || param.includes("Slurry Wt")) return unitSystem === "imp" ? "9.5" : "1138";
  if (param.includes("ROP")) return unitSystem === "imp" ? "45" : "13.7";
  if (param.includes("Proppant")) return unitSystem === "imp" ? "2.5" : "300";
  if (param.includes("Offset")) return unitSystem === "imp" ? "12" : "3.66";
  if (param.includes("Gradient")) return unitSystem === "imp" ? "0.433" : "9.79";
  if (param.includes("Static Level")) return "3200";
  if (param.includes("BHT") || param.includes("Temp")) return unitSystem === "imp" ? "185" : "85";
  if (param.includes("Interval")) return unitSystem === "imp" ? "85" : "25.9";
  if (param.includes("Yield")) return unitSystem === "imp" ? "1.18" : "0.033";
  return "10";
};
