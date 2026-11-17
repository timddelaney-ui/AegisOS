import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { useTier } from "../context/TierContext";
import { TIER_SPECS, TIER_PERSONAL, TIER_FLEET } from "../lib/tiers";

const STORAGE_KEY = "coilaegis_tier_tutorial_seen_v1";

/**
 * TierTutorial — a per-tier walk-through modal that explains what the viewer
 * has access to on their current plan.
 *
 * Trigger pattern:
 *   • First-login: auto-opens if the user hasn't dismissed it yet.
 *   • User menu: a "Show tutorial" button always re-opens it on demand.
 *
 * The content for each tier is defined in TUTORIAL_SLIDES below so there's a
 * single source of truth that stays aligned with TIER_SPECS highlights.
 */

const TUTORIAL_SLIDES = {
  free: [
    {
      title: "Welcome to Aegis OS · Free Basic",
      body: "Use 17 offline physics calculators and public AER / IWCF emergency SOPs in single-user mode.",
      bullet: null,
    },
    {
      title: "Offline field tools",
      body: "Calculations and emergency procedures stay available without an internet connection. Free Basic does not include crew sharing, organization workspaces, or rig connectivity.",
      bullet: ["17 calculators", "Emergency SOPs", "Single-user access"],
    },
  ],
  pro: [
    {
      title: "Welcome to CT Field Workbook Pro",
      body: "Everything in Free, plus field productivity and collaboration tools for engineers and supervisors.",
      bullet: null,
    },
    {
      title: "Field productivity + crew collaboration",
      body: "Keep advanced offline notes and personal field logs, sync across devices, and collaborate with your team. Pro does not include live rig connectivity or management assignment controls.",
      bullet: null,
    },
  ],
  field_pilot: [
    {
      title: "Welcome to Field Pilot",
      body: "Pilot accounts receive operational telemetry only for their authenticated, provisioned target rig units.",
      bullet: null,
    },
    {
      title: "Mission Control + telemetry",
      body: "Use the authorized Modbus TCP, OPC UA, WITS0, or WITSML connections, multi-pen strip charts, fatigue tracking, and fluid totalizers. Rig provisioning and engineer assignments remain Fleet Enterprise controls.",
      bullet: ["Active / standby pilot", "Target rigs only", "No fleet assignments"],
    },
  ],
  fleet: [
    {
      title: "Welcome to Fleet Enterprise",
      body: "Fleet Enterprise adds multi-tenant operations, management oversight, audit controls, and engineer-to-rig assignments to the operational stack.",
      bullet: null,
    },
    {
      title: "Management controls",
      body: "Provision rig units and assign or reassign lead field engineers within your organization. The portal is restricted to management roles and enterprise scopes.",
      bullet: null,
    },
    {
      title: "Fleet access",
      body: "Your enabled features are scoped to your provisioned organization. Use the user menu to replay this walk-through later.",
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
          {tier !== TIER_FLEET && (
            <button
              data-testid="tier-tutorial-see-plans"
              onClick={() => { dismiss(); navigate("/pricing"); }}
              className="ml-auto text-[11px] font-bold text-slate-400 hover:text-white underline underline-offset-2"
            >See all plans</button>
          )}
          <button
            data-testid="tier-tutorial-next"
            onClick={() => (last ? dismiss() : setI(i + 1))}
            className={`${tier === TIER_FLEET ? "ml-auto " : ""}px-4 py-1.5 rounded font-bold text-xs text-black flex items-center gap-1 hover:brightness-110`}
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
