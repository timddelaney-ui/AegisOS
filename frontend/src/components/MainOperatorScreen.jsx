import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { useTier } from "../context/TierContext";
import { TIER_SPECS, TIER_PERSONAL } from "../lib/tiers";

const STORAGE_KEY = "coilaegis_tier_tutorial_seen_v1";

const TUTORIAL_SLIDES = {
  personal: [
    {
      title: "Welcome to CoilAegis · Personal",
      body: "Built for individual field engineers. Everything you need to run calculations, record SOPs, and stay on top of your own daily tasks — no crew setup required.",
      bullet: null,
    },
    {
      title: "Workbooks & SOP library",
      body: "Open the Workbook from your Hub for every open-domain calc (Pipe Stretch, Sand Cleanout, Fishing Ops, …). Each sheet carries a dual-citation chip ([API RP 5C7 §4.2.1 / ISO 13628-7]) so an auditor can trace the standard behind every number.",
      bullet: ["Pipe Stretch", "Sand Cleanout", "CT Milling", "Frac through CT", "Annular Frac"],
    },
    {
      title: "AI assistant + Training mode",
      body: "A Gemini-powered assistant lives in the sidebar — ask it about SOP steps, equipment specs, or run a what-if on your current numbers. Training mode walks through canned scenarios so you can rehearse before a job.",
      bullet: null,
    },
    {
      title: "Daily tasks · Parts orders · Equipment",
      body: "Track your own task list, raise parts orders, log equipment & assets, and keep ERP templates ready for the next job. All of it is personal — nothing requires a crew or office approval.",
      bullet: null,
    },
  ],
  smallmed: [
    {
      title: "Welcome to CoilAegis · Small-Med Crew",
      body: "Everything in Personal, plus the crew tooling to run a 2-15 person outfit without spreadsheets or group texts.",
      bullet: null,
    },
    {
      title: "Timecards + Payroll",
      body: "Each crew member logs field, shop, travel, and equipment-move hours against the Pay Code catalog. Supervisors approve shifts; management signs off at the top of the chain. Payroll reports export per period.",
      bullet: ["Field rate", "Shop rate", "Travel rate", "Moving equipment"],
    },
    {
      title: "Position Designation (RBAC)",
      body: "The ladder (Hand → Operator → Supervisor → Management) governs who can approve what. Promote or reassign crew in Crew Admin — base rates auto-attach from the pay code catalog.",
      bullet: null,
    },
    {
      title: "Crew schedule + Contacts",
      body: "A shared crew schedule, a saved address book for office recipients, team invites, and the ERP template library all tie back to your team so nothing lives in one person's inbox.",
      bullet: null,
    },
  ],
  enterprise: [
    {
      title: "Welcome to CoilAegis · Enterprise",
      body: "The full field-operations stack. Live telemetry, 3D visualisation, fatigue analytics, treatment logging, and audit-grade dossiers — nothing is behind a gate.",
      bullet: null,
    },
    {
      title: "Live Ops console",
      body: "Five-pen rolling 1 Hz strip charts, radial gauges (Weight · daN, P int · MPa, Skate · psi + ≈ MPa chip), 60-second mini sparklines with OEM reference lines, and a docked DLS-colored 3D wellbore. One click prints the Engineering Audit Dossier.",
      bullet: null,
    },
    {
      title: "Reel Fatigue + Treatment log",
      body: "Palmgren-Miner life tracking tied to live traction pressure. Treatment logs capture the operation dialect (Codes 1-69) with full telemetry snapshots so handover reads like a timeline.",
      bullet: null,
    },
    {
      title: "DAQ ingest + Audit Dossier email",
      body: "Pull Modbus TCP, WITS 0, or WITSML straight from the unit. Email the on-screen dossier (SI or Imperial) to up to 5 office recipients via Resend; the exact bytes the crew saw land in the inbox.",
      bullet: null,
    },
    {
      title: "You're on the top plan",
      body: "Everything's unlocked. The user menu has 'Show tutorial' if you want to replay this walk-through later.",
      bullet: null,
    },
  ],
};

export function useTierTutorial() {
  const { loaded, tier } = useTier();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    try {
      const seen = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (!seen[tier]) setOpen(true);
    } catch (_e) { /* ignore */ }
  }, [loaded, tier]);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
}

export default function TierTutorial({ open, onClose }) {
  const { tier } = useTier();
  const slides = useMemo(() => TUTORIAL_SLIDES[tier] || TUTORIAL_SLIDES[TIER_PERSONAL], [tier]);
  const [i, setI] = useState(0);
  const spec = TIER_SPECS[tier] || TIER_SPECS[TIER_PERSONAL];
  const navigate = useNavigate();

  useEffect(() => { if (open) setI(0); }, [open]);

  const dismiss = () => {
    try {
      const seen = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      seen[tier] = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
    } catch (_e) { /* ignore */ }
    onClose();
  };

  if (!open) return null;
  const last = i === slides.length - 1;
  const s = slides[i];
  return (
    <div
      data-testid="tier-tutorial-modal"
      className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div className="w-full max-w-lg bg-[#0F172A] border border-white/15 rounded-xl shadow-2xl overflow-hidden text-slate-100 relative">
        <div className="absolute inset-0 opacity-25 pointer-events-none"
             style={{ background: `radial-gradient(ellipse 500px 220px at 85% 10%, ${spec.glow}, transparent 60%)` }} />
        <div className="relative px-5 py-3 border-b border-white/10 flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: spec.accent }} />
          <div className="text-xs font-bold uppercase tracking-wider">Your plan · <span style={{ color: spec.accent }}>{spec.label}</span></div>
          <button
            data-testid="tier-tutorial-close"
            onClick={dismiss}
            className="ml-auto text-slate-400 hover:text-white"
            aria-label="Close"
          ><X className="w-4 h-4" /></button>
        </div>

        <div className="relative px-5 py-5 min-h-[220px]">
          <div className="text-[11px] text-slate-500 tracking-wide font-bold uppercase mb-1">{i + 1} / {slides.length}</div>
          <h3 className="text-xl font-bold leading-tight" data-testid="tier-tutorial-title">{s.title}</h3>
          <p className="text-sm text-slate-300 mt-2 leading-relaxed" data-testid="tier-tutorial-body">{s.body}</p>
          {s.bullet && (
            <ul className="mt-3 grid grid-cols-2 gap-1.5">
              {s.bullet.map((b) => (
                <li key={b} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                  <CheckCircle2 className="w-3 h-3" style={{ color: spec.accent }} />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="relative px-5 py-3 border-t border-white/10 flex items-center gap-2 bg-black/30">
          <div className="flex gap-1">
            {slides.map((_, idx) => (
              <button
                key={`tut-dot-${idx}`}
                onClick={() => setI(idx)}
                aria-label={`Go to slide ${idx + 1}`}
                className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6" : "w-1.5 bg-white/30 hover:bg-white/50"}`}
                style={idx === i ? { background: spec.accent } : undefined}
              />
            ))}
          </div>
          {tier !== "enterprise" && (
            <button
              data-testid="tier-tutorial-see-plans"
              onClick={() => { dismiss(); navigate("/pricing"); }}
              className="ml-auto text-[11px] font-bold text-slate-400 hover:text-white underline underline-offset-2"
            >See all plans</button>
          )}
          <button
            data-testid="tier-tutorial-next"
            onClick={() => (last ? dismiss() : setI(i + 1))}
            className={`${tier === "enterprise" ? "ml-auto " : ""}px-4 py-1.5 rounded font-bold text-xs text-black flex items-center gap-1 hover:brightness-110`}
            style={{ background: spec.accent }}
          >
            {last ? "Got it" : "Next"}
            {!last && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
