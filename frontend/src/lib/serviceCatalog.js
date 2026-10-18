// Maps each workbook sheet to one or more services. A sheet appears in a service view
// if that service is in its `services` array. "all" view shows every sheet.
export const SERVICES = [
  { id: "all",              label: "All Services",     short: "All",     accent: "#C44A08" },
  { id: "coil_tubing",      label: "Coil Tubing",      short: "Coil",    accent: "#FF6B1A" },
  { id: "stand_alone_frac", label: "Stand-Alone Frac", short: "Frac",    accent: "#C36600" },
  { id: "coil_tools",       label: "Coil Tools",       short: "Tools",   accent: "#0056B3" },
];

// Sheet → services mapping. A sheet can be in more than one service view.
export const SHEET_SERVICES = {
  Pipe_Stretch:      ["coil_tools"],
  Sand_Cleanout:     ["coil_tubing"],
  CT_Milling:        ["coil_tubing"],
  CT_Drilling:       ["coil_tubing"],
  Pill_Spotting:     ["coil_tubing"],
  Frac_Through_CT:   ["coil_tubing", "stand_alone_frac"],
  Annular_Frac:      ["stand_alone_frac"],
  Mechanical_Sleeve: ["coil_tools"],
  Hydraulic_Sleeve:  ["coil_tools"],
  Nitrogen_Purge:    ["coil_tubing"],
  Nitrogen_Kickoff:  ["coil_tubing"],
  Acid_Stimulation:  ["coil_tubing"],
  Scale_Squeeze:     ["coil_tubing"],
  Cement_Plug:       ["coil_tubing"],
  Well_Abandonment:  ["coil_tubing"],
  CT_Perforating:    ["coil_tools"],
  Fishing_Ops:       ["coil_tools"],
};

export const sheetInService = (sheetKey, serviceId) => {
  if (!serviceId || serviceId === "all") return true;
  const svcs = SHEET_SERVICES[sheetKey] || ["coil_tubing"];
  return svcs.includes(serviceId);
};

export const serviceMeta = (id) => SERVICES.find((s) => s.id === id) || SERVICES[0];
