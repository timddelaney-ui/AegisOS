/**
 * CoilAegis Operation Dialect — 69 Open-Domain CT Activity Codes
 * ─────────────────────────────────────────────────────────────────────────
 * A standard numbering system drawn from open-domain CT phase conventions
 * (IADC phase codes · SPE 68489 · API RP 5C7 Appendix C). Each code has a
 * short default description crews can accept with one tap or edit inline
 * before saving — the dialect auto-pre-fills quick notes while keeping
 * the Treatment Log human-readable.
 *
 * Phase buckets:
 *   RIG     — rig-up, rig-down, pressure testing, standby
 *   RIH     — run-in-hole, surveying, correlation
 *   STIM    — stimulation (acid, foam, scale, breakdown)
 *   MECH    — mechanical work (milling, fishing, perforating, cutting)
 *   WELL    — well control + barrier work
 *   CIRC    — circulation / displacement / N2
 *   POOH    — pull-out, string change, inspection
 *   NPT     — non-productive-time (equipment, weather, wait-on-X)
 *   SAFETY  — JSA, drills, SIMOPS, HSE events
 */

export const OPERATION_CODES = [
  { code: 1,  phase: "RIG",    label: "Rig Up CT Unit",             desc: "Spot CT unit, rig up injector, blow-down, hose runs." },
  { code: 2,  phase: "RIG",    label: "Pressure Test Surface Equip", desc: "PT CT & iron to design pressure for 10 min · chart signed." },
  { code: 3,  phase: "RIG",    label: "Function Test Injector/BOP",  desc: "Function test injector + BOP rams and strippers · logged." },
  { code: 4,  phase: "RIG",    label: "Function Test Deadman/ESD",   desc: "ESD trip test + deadman verified operational." },
  { code: 5,  phase: "RIG",    label: "Grease Connections / Service", desc: "Grease wellhead stripper, lube injector chains, service." },
  { code: 6,  phase: "RIG",    label: "Rig Down CT Unit",            desc: "Rig down injector, pack hoses, release unit." },
  { code: 7,  phase: "RIG",    label: "Standby",                     desc: "On standby per operator request." },
  { code: 8,  phase: "RIG",    label: "Shift Change / Handover",     desc: "Crew change · handover notes exchanged." },

  { code: 10, phase: "RIH",    label: "Pick Up BHA",                 desc: "Pick up BHA from basket, tally, tag." },
  { code: 11, phase: "RIH",    label: "RIH to Surface",              desc: "RIH surface check — depth zero, weight calibrated." },
  { code: 12, phase: "RIH",    label: "RIH in Hole",                 desc: "Running in hole — monitoring weight & pressure." },
  { code: 13, phase: "RIH",    label: "Tag Fill / Top of Fish",      desc: "Tagged obstruction — depth logged, note weight drop." },
  { code: 14, phase: "RIH",    label: "Depth Correlation",           desc: "Depth correlation to CCL / known marker." },
  { code: 15, phase: "RIH",    label: "Reciprocate / Rotate",        desc: "Reciprocating / rotating to free string." },
  { code: 16, phase: "RIH",    label: "Jarring Up / Down",           desc: "Jarring action applied — report sticks and freed depth." },

  { code: 20, phase: "CIRC",   label: "Circulate at Depth",          desc: "Circulating treating fluid at target rate / pressure." },
  { code: 21, phase: "CIRC",   label: "Displace to N2",              desc: "Displace to nitrogen · ratio & flow logged." },
  { code: 22, phase: "CIRC",   label: "Displace to Diesel/Base",     desc: "Displacement to base fluid — tracked volumes." },
  { code: 23, phase: "CIRC",   label: "Spot Fluid",                  desc: "Spotting treatment at interval — volumes recorded." },
  { code: 24, phase: "CIRC",   label: "Reverse Circulate",           desc: "Reverse-circulate returns to surface." },
  { code: 25, phase: "CIRC",   label: "Nitrogen Lift / Kick Off",    desc: "N2 kick-off to flow well back." },

  { code: 30, phase: "STIM",   label: "Acid Stimulation",            desc: "Pumping acid per approved treatment schedule." },
  { code: 31, phase: "STIM",   label: "Foam / Energized Treatment",  desc: "Foam/energized stage — quality & gas ratio noted." },
  { code: 32, phase: "STIM",   label: "Scale Dissolver",             desc: "Scale dissolver placement at interval." },
  { code: 33, phase: "STIM",   label: "Breakdown / Diversion",       desc: "Diverter stage pumped per program." },
  { code: 34, phase: "STIM",   label: "Fracturing / Breakdown",      desc: "Formation breakdown pressure recorded." },
  { code: 35, phase: "STIM",   label: "Water Control / Shut-off",    desc: "Water-shutoff treatment placed." },
  { code: 36, phase: "STIM",   label: "Flowback Monitor",            desc: "Flowback monitoring — rates & solids tracked." },

  { code: 40, phase: "MECH",   label: "Milling",                     desc: "Milling obstruction — WOB & torque reported." },
  { code: 41, phase: "MECH",   label: "Fishing / Jet Wash",          desc: "Fishing / jet-washing operation." },
  { code: 42, phase: "MECH",   label: "Scraping / Brushing",         desc: "Casing scrape / brush run." },
  { code: 43, phase: "MECH",   label: "Perforating",                 desc: "Perforating run — shot density & interval." },
  { code: 44, phase: "MECH",   label: "Logging Run",                 desc: "Logging tool deployed · depth coverage noted." },
  { code: 45, phase: "MECH",   label: "Setting Plug / Packer",       desc: "Setting plug or packer — pull-test confirmed." },
  { code: 46, phase: "MECH",   label: "Pulling Plug / Packer",       desc: "Pulling plug / packer — weight loss verified." },
  { code: 47, phase: "MECH",   label: "Cement Clean-out",            desc: "Cement clean-out · mill through / wash." },
  { code: 48, phase: "MECH",   label: "Sand / Debris Clean-out",     desc: "Sand clean-out with jetting & circulation." },

  { code: 50, phase: "WELL",   label: "Open Well / Close Master",    desc: "Opening/closing master valve per permit." },
  { code: 51, phase: "WELL",   label: "Monitor Returns",              desc: "Monitoring surface returns for H2S / gas / debris." },
  { code: 52, phase: "WELL",   label: "Barrier Verification",        desc: "Verifying barriers per well-control plan." },
  { code: 53, phase: "WELL",   label: "Kill / Bullheading",          desc: "Kill operation — kill-mud volume & pressure logged." },
  { code: 54, phase: "WELL",   label: "Well Stabilization",          desc: "Well stabilization — observing SITP / annulus." },

  { code: 60, phase: "POOH",   label: "POOH Primary",                desc: "POOH at design speed · monitoring overpull & drag." },
  { code: 61, phase: "POOH",   label: "POOH with Returns",           desc: "POOH while circulating / taking returns." },
  { code: 62, phase: "POOH",   label: "Lay Down BHA",                desc: "Lay down BHA · inspect, measure, tag." },
  { code: 63, phase: "POOH",   label: "CT Inspection On Reel",       desc: "Visual + dimensional CT string inspection." },

  { code: 65, phase: "SAFETY", label: "JSA / Toolbox Talk",          desc: "Pre-job JSA / toolbox talk — hazards reviewed, signed." },
  { code: 66, phase: "SAFETY", label: "Emergency Drill",             desc: "Emergency / H2S / fire drill — participants logged." },

  { code: 67, phase: "NPT",    label: "NPT · Equipment Failure",     desc: "NPT — equipment failure. Minutes & root cause required." },
  { code: 68, phase: "NPT",    label: "NPT · Weather Hold",          desc: "NPT — weather / wind / lightning hold." },
  { code: 69, phase: "NPT",    label: "NPT · Wait On Well / Third Party", desc: "NPT — wait on well, operator, or third party service." },
];

export const OPERATION_CODE_BY_NUM = Object.fromEntries(
  OPERATION_CODES.map((o) => [o.code, o])
);

export const OPERATION_PHASES = Array.from(new Set(OPERATION_CODES.map((o) => o.phase)));

// Phase → accent color token (matches the enterprise palette)
export const PHASE_COLOR = {
  RIG:    "#F59E0B", // amber — field ops
  RIH:    "#06B6D4", // cyan — telemetry
  CIRC:   "#06B6D4",
  STIM:   "#A78BFA", // purple — stimulation science
  MECH:   "#FF6B1A", // brand orange — mechanical work
  WELL:   "#10B981", // emerald — well control / barrier
  POOH:   "#06B6D4",
  SAFETY: "#10B981",
  NPT:    "#EF4444", // crimson — downtime
};

// Lookup: common codes → NPT category mapping (so backend NPT roll-up works)
export const OPERATION_CODE_NPT_CATEGORY = {
  67: "equipment",
  68: "weather",
  69: "wait_on_well",
};
