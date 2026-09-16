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
    imp: ["Flow Rate (BPM)", "Casing ID (in)", "Tubing OD (in)", "Fluid Viscosity (cp)", "Current Depth (ft)", "Friction Reducer (gpt)"],
    met: ["Flow Rate (L/min)", "Casing ID (mm)", "Tubing OD (mm)", "Fluid Viscosity (cp)", "Current Depth (m)", "Friction Reducer (L/m3)"],
  },
  CT_Milling: {
    title: "Composite Plug Milling",
    sop: "SOP-CT-25 | Composite Milling Hydraulics & WOB",
    imp: ["Depth (ft)", "CT OD (in)", "CT ID (in)", "Casing ID (in)", "Weight on gauge – tagged (lbs)", "Run-in-hole weight (lbs)", "Pump Rate (BPM)", "Viscosity (cp)", "Density (ppg)"],
    met: ["Depth (m)", "CT OD (mm)", "CT ID (mm)", "Casing ID (mm)", "Weight on gauge – tagged (daN)", "Run-in-hole weight (daN)", "Pump Rate (L/min)", "Viscosity (cp)", "Density (kg/m3)"],
  },
  CT_Drilling: {
    title: "Lateral CT Drilling",
    sop: "SOP-CT-27 | Lateral CT Drilling Dynamics",
    imp: ["Depth (ft)", "CT OD (in)", "CT ID (in)", "Casing ID (in)", "Weight on gauge – tagged (lbs)", "Run-in-hole weight (lbs)", "Pump Rate (BPM)", "ROP (ft/hr)", "Density (ppg)"],
    met: ["Depth (m)", "CT OD (mm)", "CT ID (mm)", "Casing ID (mm)", "Weight on gauge – tagged (daN)", "Run-in-hole weight (daN)", "Pump Rate (L/min)", "ROP (m/hr)", "Density (kg/m3)"],
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
    imp: ["Depth (ft)", "CT OD (in)", "CT ID (in)", "Casing ID (in)", "Treating P (PSI)", "Pump Rate (BPM)", "Proppant (ppa)", "Density (ppg)", "Friction Reducer (gpt)"],
    met: ["Depth (m)", "CT OD (mm)", "CT ID (mm)", "Casing ID (mm)", "Treating P (MPa)", "Pump Rate (L/min)", "Proppant (kg/m3)", "Density (kg/m3)", "Friction Reducer (L/m3)"],
  },
  Annular_Frac: {
    title: "CT Annular Fracturing",
    sop: "SOP-CT-18 | AER Dir 009 Annular Fracturing",
    imp: ["Stage #", "Base Depth (ft)", "Offset (ft)", "Treating P (PSI)", "Pump Rate (BPM)", "Density (ppg)", "Casing ID (in)", "Tubing OD (in)", "Friction Reducer (gpt)"],
    met: ["Stage #", "Base Depth (m)", "Offset (m)", "Treating P (MPa)", "Pump Rate (L/min)", "Density (kg/m3)", "Casing ID (mm)", "Tubing OD (mm)", "Friction Reducer (L/m3)"],
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
    id: "uncontrolled_descent",
    title: "Uncontrolled Descent of Coil",
    severity: "critical",
    category: "Well Control",
    reference: "AER Directive 037 §8.2 · CAODC Well Servicing WCP",
    immediate: [
      "Reverse injector motors in the falling direction.",
      "Increase reel brake drag to maximum.",
      "Once motion stops, close and lock pipe/slip rams.",
      "Do NOT open rams until root cause is verified.",
    ],
    operator: [
      "Supervisor calls a full stop-work and headcounts crew (OH&S Reg. §37 duty to warn).",
      "Inspect coil for ovality, bird-caging, or twist damage before further movement.",
      "Log the incident in the tour report; a JHA re-assessment is required before resuming.",
      "Notify the well licensee and, if injury or release occurred, AER within 24 h (Directive 019).",
    ],
  },
  {
    id: "pipe_near_bop",
    title: "Pipe Near Bottom BOP",
    severity: "critical",
    category: "Well Control",
    reference: "API RP 5C7 · AER Directive 037",
    immediate: [
      "Stop all operations and headcount crew.",
      "Slowly pull the bottom of the coil into the control section.",
      "Set slip rams to hold string in place.",
      "Ensure accumulator is fully charged; verify shear-ram function pressure.",
    ],
    operator: [
      "Supervisor confirms shear-ram closing pressure before activating (min 3,000 psi typical).",
      "Radio the licensee company man before any ram activation.",
      "Post a rig-up hazard barrier — no non-essential personnel within red zone.",
      "Document depth, string weight, and SICP/BCP on the well-control worksheet.",
    ],
  },
  {
    id: "accumulator_failure",
    title: "Accumulator Failure",
    severity: "critical",
    category: "Equipment",
    reference: "API Spec 16D · CSA Z662 §12.6",
    immediate: [
      "Stop coil movement immediately and apply full reel brake.",
      "Manually close and lock pipe/slip rams using hand pump.",
      "Chain the reel to prevent free-spool.",
      "Monitor SICP/BCP continuously; de-energize 12 V control power.",
    ],
    operator: [
      "Only qualified BOP techs may bleed off accumulator lines (OH&S §189 competent worker).",
      "Isolate hydraulic supply with LOTO before removing bottles or hoses.",
      "Do NOT resume operations until accumulator pre-charge is re-verified per API 16D.",
      "Submit an Equipment Deficiency Report; fault-tree analysis required before next well.",
    ],
  },
  {
    id: "hoseline_pressure_loss",
    title: "Loss of Hoseline Pressure",
    severity: "high",
    category: "Well Control",
    reference: "AER Directive 037 §8.4",
    immediate: [
      "Stop coil movement and notify the rig manager and company man.",
      "Manually close slip rams using the local hand-pump station.",
      "Bleed back annulus pressure to below 7,000 psi to continue operations.",
      "Verify all pressure gauges are calibrated before restart.",
    ],
    operator: [
      "Confirm all pressure-testing certificates are current (max 6 months, CSA Z662).",
      "Two-person integrity check on hose replacements — one operator, one witness.",
      "If leak was at a WECO fitting, replace entire hammer union and log in maintenance system.",
    ],
  },
  {
    id: "h2s_release",
    title: "H2S / Sour Gas Release",
    severity: "critical",
    category: "HSE",
    reference: "OH&S Code Part 4 §16 · CSA Z275.2 · AER Directive 060",
    immediate: [
      "Sound H2S alarm and evacuate crew CROSSWIND to designated muster point.",
      "Don SCBA before re-approach; buddy system mandatory.",
      "Shut in the well via ESD from a safe distance.",
      "Establish 100 m ignition-free exclusion zone; deploy wind sock check.",
    ],
    operator: [
      "H2S Alive ticket required for every worker on location (OH&S §16(3)).",
      "Continuous 4-gas monitoring at breathing-zone level; log peak ppm each 5 min.",
      "Rescue team pre-designated per CSA Z1006 confined-space-equivalent standard.",
      "Notify AER 1-800-222-6514 and local emergency services within 15 min.",
    ],
  },
  {
    id: "well_kick",
    title: "Well Kick / Shallow Gas Influx",
    severity: "critical",
    category: "Well Control",
    reference: "IWCF Well Control · AER Directive 036",
    immediate: [
      "Shut in the well: close annular BOP, then pipe rams.",
      "Record SICP, SIDPP, and pit gain every 15 min.",
      "Stop injection; do NOT pump against unknown influx until circulated.",
      "Alert all personnel; move ignition sources to 50 m minimum.",
    ],
    operator: [
      "IWCF/IADC WellCAP certification required for supervisor and driller (AER Directive 036).",
      "Kick sheet must be signed by supervisor and company man before circulation begins.",
      "Driller's method or Wait-and-Weight — do not deviate without written authorization.",
      "Full incident report to AER within 24 h if kick > 5 bbl gain.",
    ],
  },
  {
    id: "injector_failure",
    title: "Injector Head Chain / Gripper Failure",
    severity: "high",
    category: "Equipment",
    reference: "API RP 5C7 · Manufacturer OEM Manual",
    immediate: [
      "Stop injector motors immediately.",
      "Set slip rams as primary hold before releasing injector.",
      "Isolate hydraulic supply and LOTO.",
      "Do NOT attempt to reset grippers under load.",
    ],
    operator: [
      "Only OEM-certified technician may adjust gripper block tension.",
      "Torque-verify all gripper bolts to manufacturer spec after any service.",
      "Inspect chain elongation before every job (max 3% stretch per API RP 5C7).",
      "Log service hours; retire chains at OEM interval regardless of visual condition.",
    ],
  },
  {
    id: "ct_parting",
    title: "Coiled Tubing Parting (Twist-Off)",
    severity: "critical",
    category: "Well Control",
    reference: "AER Directive 037 · API RP 5C7 §9",
    immediate: [
      "Stop all pumping and injector movement.",
      "Close annular BOP first, then pipe rams above the break.",
      "Record surface pressure trend; watch for pressure climb.",
      "Prepare fishing BHA and contingency kill fluid.",
    ],
    operator: [
      "Root-cause analysis mandatory before next run (fatigue log audit, corrosion inspection).",
      "Review string life & bending-fatigue tracking software readings.",
      "Notify AER via Directive 019 incident reporting if uncontrolled release occurred.",
      "Debrief all crew — near-miss learnings shared in next tailgate meeting.",
    ],
  },
  {
    id: "surface_whip",
    title: "CT Parting at Surface (Whipping Hazard)",
    severity: "critical",
    category: "HSE",
    reference: "OH&S Code §212 · CAODC Safe Work Practice CT-14",
    immediate: [
      "All personnel EVACUATE the red zone immediately.",
      "Do not approach parted coil until motion has fully stopped.",
      "Kill injector power at ESD; chain reel drum before approach.",
      "Rig up soft catch or restraint before cutting the coil.",
    ],
    operator: [
      "Red-zone perimeter marked with cones/tape before every job (OH&S §212).",
      "No crew inside red zone during coil injection except operator (behind guarded panel).",
      "High-visibility PPE, hard hat with chin strap, and impact goggles mandatory.",
      "Serious-injury near-miss report to OH&S within 72 h.",
    ],
  },
  {
    id: "fire_on_location",
    title: "Fire on Location",
    severity: "critical",
    category: "HSE",
    reference: "OH&S Code Part 8 §67 · NFPA 10",
    immediate: [
      "Sound fire alarm; activate ESD to shut in well and pumps.",
      "Evacuate all non-essential personnel UPWIND to muster point.",
      "Attempt suppression with on-site extinguisher ONLY if fire is small and escape route clear.",
      "Call 911 and provide LSD/GPS coordinates plus H2S status.",
    ],
    operator: [
      "Minimum 2× 20lb ABC extinguishers within 8 m of every ignition source (OH&S §67).",
      "Monthly extinguisher inspection log posted at rig; tag every unit.",
      "Fire watch required 30 min after any hot-work; permit signed by supervisor.",
      "Post-incident: replace ALL discharged extinguishers before resuming operations.",
    ],
  },
  {
    id: "nitrogen_leak",
    title: "Nitrogen Leak / Cryogenic Burn",
    severity: "high",
    category: "HSE",
    reference: "CSA Z662 §14 · CGA G-10.1",
    immediate: [
      "Evacuate area — nitrogen displaces oxygen (asphyxiation risk).",
      "Shut in nitrogen supply at pump truck ESD.",
      "Ventilate enclosed spaces before re-entry; verify O₂ ≥ 19.5% with 4-gas monitor.",
      "For skin contact: flush with lukewarm water 15+ min; do NOT rub tissue.",
    ],
    operator: [
      "Cryogenic PPE (face shield, insulated gloves, cuffed sleeves) at every N₂ transfer.",
      "Confined-space entry permit required in any pit, cellar, or basement (OH&S Part 5).",
      "Oxygen deficiency alarm within 3 m of any large N₂ transfer point.",
      "Report first-aid or lost-time injury per OH&S §18 within same shift.",
    ],
  },
  {
    id: "hp_line_rupture",
    title: "High-Pressure Line Rupture (Frac / Pumping)",
    severity: "critical",
    category: "Equipment",
    reference: "API RP 6A · CSA Z662 §5.11",
    immediate: [
      "ESD all pump equipment immediately.",
      "Evacuate red zone; personnel to bunker or behind approved barrier.",
      "Bleed off pressure through remote-actuated bleed valves ONLY.",
      "Do NOT approach ruptured line until pressure reads 0 psi at multiple gauges.",
    ],
    operator: [
      "Pressure-rated iron must have current test cert (max 6 months, 1.5× MAWP).",
      "Whip checks / safety cables at EVERY connection (CSA Z662).",
      "No personnel within 25 m of live HP iron during pumping (OH&S §212 barrier).",
      "Retire and inspect ALL iron in the affected treating line before next stage.",
    ],
  },
  {
    id: "medical_emergency",
    title: "Medical Emergency on Location",
    severity: "high",
    category: "HSE",
    reference: "OH&S Code Part 11 · First Aid Regulation",
    immediate: [
      "Assess scene safety BEFORE approaching casualty.",
      "Call for on-site OFA first-aider; dispatch 911 with LSD coordinates.",
      "Stop any active operation that could worsen the situation.",
      "Prepare access route for STARS / EMS; assign guide to gate.",
    ],
    operator: [
      "OFA Level 2 or 3 attendant required for remote worksites (First Aid Reg. §5).",
      "STARS Emerlink account active and rehearsed in the ERP.",
      "Medivac helipad or turnaround area identified in the site-specific ERP.",
      "Serious injury reportable to OH&S within 72 h (§18); potential fatality within 30 min.",
    ],
  },
  {
    id: "wireline_stuck",
    title: "Wireline / Slickline Stuck in CT",
    severity: "medium",
    category: "Well Control",
    reference: "API RP 67 · CAODC WSP-08",
    immediate: [
      "Stop reeling and mark surface reference on line.",
      "Verify pressure balance across BOP before applying tension.",
      "Do NOT exceed 80% of line rated tensile strength during work.",
      "Coordinate simultaneous CT/WL operations with a single lead supervisor.",
    ],
    operator: [
      "SIMOPS matrix signed before wireline enters CT string.",
      "Fresh JHA specifically for the stuck-tool contingency.",
      "Explosives handling (perf guns) per API RP 67 by ticketed blaster only.",
      "Two-way radio channel dedicated to WL/CT coordination — no cross-talk.",
    ],
  },
  {
    id: "electrical_fault",
    title: "Electrical Fault / Short",
    severity: "high",
    category: "Equipment",
    reference: "CSA Z462 · Canadian Electrical Code",
    immediate: [
      "De-energize affected circuit at main disconnect.",
      "Do NOT touch victim or equipment until power is confirmed OFF.",
      "Apply LOTO before troubleshooting.",
      "Test-before-touch with rated meter (CSA Z462).",
    ],
    operator: [
      "Only ticketed electrician may work on live gear (Alberta Trade Reg.).",
      "Arc-flash rated PPE per CSA Z462 hazard-risk category.",
      "Ground-fault protection tested at start of every shift.",
      "Report electrical incidents to Alberta Safety Codes Officer if code violation suspected.",
    ],
  },
  {
    id: "winter_freeze",
    title: "Frozen Wellhead / Christmas Tree",
    severity: "medium",
    category: "Winter Ops",
    reference: "CSA Z662 §4.16 Cold Weather · CAODC WSP-22",
    immediate: [
      "Do NOT apply direct flame or torches to pressurized components.",
      "Use steam or heat-tracing only; monitor casing pressure during thaw.",
      "Verify pressure equalization before opening any valve.",
      "Post exclusion zone — steam scald hazard.",
    ],
    operator: [
      "Cold-weather JHA required for all ops below −25 °C (AB OH&S §389).",
      "Warm-up shelter with heat within 100 m of work area.",
      "Methanol / glycol handling per WHMIS 2015 SDS.",
      "Rotate crews every 30 min at extreme cold; frost-nip inspection buddy check.",
    ],
  },
  {
    id: "spill_release",
    title: "Hydrocarbon / Chemical Spill",
    severity: "high",
    category: "HSE",
    reference: "AER Directive 019 · EPEA · TDG Reg.",
    immediate: [
      "Stop the source — close valves, shut pumps, contain flow.",
      "Deploy absorbent booms / berms downhill of the release.",
      "Prevent ignition — kill hot work; move vehicles upwind.",
      "Sample and photograph the release for reporting.",
    ],
    operator: [
      "Report to AER within 15 min if release meets Directive 019 thresholds.",
      "Environmental Protection Officer (EPO) coordinates cleanup per EPEA.",
      "TDG-trained personnel only for transport of contaminated waste.",
      "SDS binder on site for every product; SPCC plan reviewed annually.",
    ],
  },
];

export const emergencyCategories = ["All", "Well Control", "HSE", "Equipment", "Winter Ops"];

export const getDefaultValue = (param, unitSystem) => {
  if (param.includes("Stage")) return "1";
  if (param.includes("Friction Reducer")) return unitSystem === "imp" ? "1.5" : "2.0";
  if (param.includes("Weight on gauge") || param.includes("tagged")) return unitSystem === "imp" ? "18000" : "8010";
  if (param.includes("Run-in-hole") || param.includes("run-in-hole")) return unitSystem === "imp" ? "19500" : "8680";
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
