import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  X, ChevronLeft, ChevronRight, ShieldCheck, Activity, FileText, Users,
  Sparkles, Share2, Flame, Clock, Zap, StickyNote, Radio, GraduationCap,
} from "lucide-react";
import CoilAegisLogo from "./CoilAegisLogo";

const STORAGE_KEY = "coilaegis_tour_seen_v1";

const SLIDES = [
  {
    title: "Welcome to CoilAegis",
    tagline: "The rig-grade field-operations platform for coiled-tubing crews.",
    body: (
      <>
        <p className="text-white/70">You're looking at the operations platform that replaces the greasy notebook, the shared Excel, and half a dozen whiteboard apps.</p>
        <p className="text-white/70">This 60-second tour covers how to <strong className="text-white">run a job, read your coil string, and watch your fleet</strong> — then you're off.</p>
        <div className="mt-4 flex items-center gap-2 bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 rounded-lg p-3 text-xs">
          <ShieldCheck className="w-4 h-4 text-[#FF6B1A] flex-shrink-0" />
          <span>Everything is advisory-only. Every calculation cites API/AER/CSA/IWCF.</span>
        </div>
      </>
    ),
    Icon: ShieldCheck,
  },
  {
    title: "The Hub — your doghouse home screen",
    tagline: "Every tool, pinned to one tappable grid.",
    body: (
      <>
        <p className="text-white/70">Tap a tile to open the tool. Hit <strong className="text-white">Customize</strong> on the Hub to toggle tiles on/off and reorder them to match your shift.</p>
        <ul className="mt-3 space-y-1.5 text-white/70 text-sm list-disc pl-4 marker:text-[#FF6B1A]">
          <li><strong className="text-white">Live Ops</strong> — real-time pressure, weight, VM, fatigue</li>
          <li><strong className="text-white">Reels, Stress, Fatigue, Wellbore</strong> — engineering workbench</li>
          <li><strong className="text-white">Timecards, Tasks, Parts, Certs</strong> — crew & HR workflow</li>
          <li><strong className="text-white">Treatment, Documents, ERP</strong> — on-job logging</li>
        </ul>
      </>
    ),
    Icon: Radio,
  },
  {
    title: "Live Ops — your rig, in real time",
    tagline: "Pressure, weight, VM, fatigue — all in one glass pane.",
    body: (
      <>
        <p className="text-white/70">Hit <strong className="text-white">Start feed</strong> to animate the dashboard (jittered simulator in Phase 1; WITS 0 / Modbus in Phase 2).</p>
        <ul className="mt-3 space-y-1.5 text-white/70 text-sm list-disc pl-4 marker:text-[#FF6B1A]">
          <li><strong className="text-white">Playback</strong> scrubs back 10 full minutes of history</li>
          <li><strong className="text-white">Drop note</strong> drops a timestamped pin on the timeline — "spike here = pump failure"</li>
          <li><strong className="text-white">Significant Events & NPT</strong> you log in Treatment also pin to the timeline — click any pin to jump</li>
          <li><strong className="text-white">CSV / LAS</strong> export the window with every annotation + event embedded</li>
          <li><strong className="text-white">Dossier</strong> builds an auto-formatted job audit PDF</li>
        </ul>
      </>
    ),
    Icon: Activity,
  },
  {
    title: "Stress & Fatigue — know your string",
    tagline: "API RP 5C7 thin-wall Von Mises + Palmgren-Miner fatigue.",
    body: (
      <>
        <p className="text-white/70">Upload your reel's tapered intervals (CSV, JSON, or manual). CoilAegis pulls SMYS from the grade spec and plots your current (σa, σh) point on the standard rotated-ellipse envelope.</p>
        <p className="text-white/70 mt-3"><strong className="text-white">Fatigue</strong> watches every traction-pressure cycle and keeps a Miner's-sum per 100-ft node — orange and red segments on the heatmap are telling you where to cut.</p>
      </>
    ),
    Icon: Flame,
  },
  {
    title: "Crew & HR — timecards without paper",
    tagline: "Shift Composer, batched approvals, pay-code rates.",
    body: (
      <>
        <p className="text-white/70">The <strong className="text-white">Shift Composer</strong> lets a crew log Shop + Travel + Field + Moving on one shift in one tap. Supervisors approve in Step 1, management approves in Step 2 — payroll ready.</p>
        <ul className="mt-3 space-y-1.5 text-white/70 text-sm list-disc pl-4 marker:text-[#FF6B1A]">
          <li><strong className="text-white">Tasks</strong> — rig-scoped todos your crew can check off</li>
          <li><strong className="text-white">Parts Orders</strong> — two-step approval chain (supervisor → management)</li>
          <li><strong className="text-white">Certs Ledger</strong> — H2S, First-Aid, WellCAP expiry dates per crew</li>
        </ul>
      </>
    ),
    Icon: Clock,
  },
  {
    title: "Rig Fleet View — who's running, who's down",
    tagline: "Status badges on every rig, visible at a glance.",
    body: (
      <>
        <p className="text-white/70">Open the <strong className="text-white">rig dropdown</strong> at the top of any page. Each rig carries a status chip:</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          <span className="px-2 py-1 rounded" style={{ background: "#10B98120", color: "#10B981" }}>RUN</span>
          <span className="px-2 py-1 rounded" style={{ background: "#F59E0B20", color: "#F59E0B" }}>STBY</span>
          <span className="px-2 py-1 rounded" style={{ background: "#EF444420", color: "#EF4444" }}>DOWN</span>
          <span className="px-2 py-1 rounded" style={{ background: "#6B728020", color: "#6B7280" }}>YARD</span>
        </div>
        <p className="text-white/70 mt-3">Supervisor+ clicks a chip to flip status. Management uses <strong className="text-white">Rename</strong> to replace "Rig 1" with the actual unit name ("North Pad Unit 7").</p>
      </>
    ),
    Icon: Users,
  },
  {
    title: "The AI Field Assistant",
    tagline: "Gemini, grounded in cited standards.",
    body: (
      <>
        <p className="text-white/70">Open the AI from the Hub. Six modes:</p>
        <ul className="mt-2 space-y-1 text-white/70 text-sm list-disc pl-4 marker:text-[#FF6B1A]">
          <li><strong className="text-white">Field Chat</strong> — ask anything, cites the source</li>
          <li><strong className="text-white">Troubleshoot</strong> — surface symptom → root cause walkthrough</li>
          <li><strong className="text-white">SOP / ERP</strong> — pulls your company SOPs if attached</li>
          <li><strong className="text-white">Explain Results</strong> — plain-English on any calculation</li>
          <li><strong className="text-white">Training</strong> — new-hand mode</li>
          <li><strong className="text-white">Emergency</strong> — 17 scenarios with immediate actions</li>
        </ul>
        <p className="text-white/70 mt-3 text-xs">Every answer opens with an <em>Action Now</em> block and drops into <em>Why / Details</em> on tap.</p>
      </>
    ),
    Icon: Sparkles,
  },
  {
    title: "Share a view with your client",
    tagline: "7-day guest link — no Google sign-in needed.",
    body: (
      <>
        <p className="text-white/70">On the Live Ops page, click <strong className="text-white">Client link</strong> to generate a 7-day read-only URL. Paste it in email or SMS — your client sees pressure, weight, VM, and fatigue in real time.</p>
        <p className="text-white/70 mt-3">Guest users <strong className="text-white">cannot</strong> see HR/pay/schedule/admin data. You stay in control — revoke the link any time.</p>
      </>
    ),
    Icon: Share2,
  },
  {
    title: "You're ready — go run a job",
    tagline: "Open the ? button in the header to replay this tour.",
    body: (
      <>
        <p className="text-white/70">That's the 60-second tour. Everything else is tappable from the Hub.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 rounded-lg p-3 text-xs">
            <p className="font-bold text-[#FF6B1A]">PRO TIP</p>
            <p className="text-white/70 mt-1">Hit <strong>Customize</strong> on the Hub to put your 4 most-used tools on top.</p>
          </div>
          <div className="bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 rounded-lg p-3 text-xs">
            <p className="font-bold text-[#FF6B1A]">BRING YOUR CREW</p>
            <p className="text-white/70 mt-1">Share a free trial invite from the <strong>Team</strong> page.</p>
          </div>
        </div>
      </>
    ),
    Icon: GraduationCap,
  },
];

export const useWelcomeTour = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) setOpen(true);
    } catch { /* ignore */ }
  }, []);
  const openTour = () => setOpen(true);
  const closeTour = () => {
    try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch { /* ignore */ }
    setOpen(false);
  };
  return { open, openTour, closeTour };
};

export const WelcomeTour = ({ open, onClose }) => {
  const [idx, setIdx] = useState(0);
  const navigate = useNavigate();

  useEffect(() => { if (open) setIdx(0); }, [open]);

  if (!open) return null;

  const slide = SLIDES[idx];
  const isLast = idx === SLIDES.length - 1;
  const isFirst = idx === 0;
  const Icon = slide.Icon;

  const next = () => setIdx((i) => Math.min(i + 1, SLIDES.length - 1));
  const prev = () => setIdx((i) => Math.max(i - 1, 0));

  const launchLiveOps = () => { onClose(); navigate("/live-ops"); };

  return (
    <div
      data-testid="welcome-tour"
      className="fixed inset-0 bg-black/85 z-[80] flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[#0D1A24] text-white border border-[#FF6B1A]/30 rounded-xl w-full max-w-xl shadow-2xl flex flex-col max-h-[92vh]"
        style={{ boxShadow: "0 25px 80px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,107,26,0.2)" }}
      >
        {/* Backdrop grid */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.05] rounded-xl pointer-events-none overflow-hidden"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,107,26,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,107,26,0.4) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-4 pb-2 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <CoilAegisLogo size={22} variant="icon" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#FF6B1A]">
              Tour · {idx + 1} / {SLIDES.length}
            </span>
          </div>
          <button
            data-testid="welcome-tour-close"
            onClick={onClose}
            className="text-white/60 hover:text-white"
            aria-label="Close tour"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="relative px-5 py-5 overflow-y-auto">
          <div className="flex items-start gap-3 mb-3">
            <div
              className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "#FF6B1A20", color: "#FF6B1A" }}
            >
              <Icon className="w-6 h-6" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-snug">{slide.title}</h2>
              <p className="text-sm text-[#FF6B1A] font-semibold mt-0.5">{slide.tagline}</p>
            </div>
          </div>
          <div className="text-sm space-y-2.5">
            {slide.body}
          </div>
        </div>

        {/* Progress dots */}
        <div className="relative flex items-center justify-center gap-1.5 pb-2">
          {SLIDES.map((_, i) => (
            <button
              key={`tour-dot-${i}`}
              data-testid={`welcome-tour-dot-${i}`}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${i === idx ? "bg-[#FF6B1A] w-6" : "bg-white/20 w-1.5"}`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between gap-2 px-5 pb-4 pt-2 border-t border-white/10">
          <button
            data-testid="welcome-tour-prev"
            onClick={prev}
            disabled={isFirst}
            className="text-xs font-bold px-3 py-2 rounded bg-white/10 hover:bg-white/20 flex items-center gap-1 disabled:opacity-30"
          >
            <ChevronLeft className="w-3.5 h-3.5" />Back
          </button>
          <button
            data-testid="welcome-tour-skip"
            onClick={onClose}
            className="text-[11px] text-white/50 hover:text-white font-semibold"
          >
            {isLast ? "" : "Skip tour"}
          </button>
          {isLast ? (
            <div className="flex items-center gap-2">
              <button
                data-testid="welcome-tour-liveops"
                onClick={launchLiveOps}
                className="text-xs font-bold px-3 py-2 rounded bg-white/10 hover:bg-white/20 flex items-center gap-1"
              >
                <Zap className="w-3.5 h-3.5" />Open Live Ops
              </button>
              <button
                data-testid="welcome-tour-finish"
                onClick={onClose}
                className="text-xs font-bold px-3 py-2 rounded bg-[#FF6B1A] hover:bg-[#C44A08] text-white"
              >
                Let's go
              </button>
            </div>
          ) : (
            <button
              data-testid="welcome-tour-next"
              onClick={next}
              className="text-xs font-bold px-3 py-2 rounded bg-[#FF6B1A] hover:bg-[#C44A08] text-white flex items-center gap-1"
            >
              Next<ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default WelcomeTour;
