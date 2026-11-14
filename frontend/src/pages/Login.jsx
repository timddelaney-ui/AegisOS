import React from "react";
import { ShieldCheck, Cloud, Users, Sparkles, AlertOctagon, Calculator, BookOpen, Activity } from "lucide-react";
import CoilAegisLogo from "../components/CoilAegisLogo";

const Login = () => {
  const handleGoogleLogin = async () => {
    const api = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
    try {
      const cfg = await fetch(`${api}/auth/config`).then((r) => r.json());
      if (cfg.provider === "google") {
        window.location.href = `${api}/auth/google/login`;
        return;
      }
    } catch (e) {
      // fall through to the legacy provider
    }
    const redirectUrl = window.location.origin + "/app";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen bg-[#0D1A24] text-white flex flex-col">
      {/* Top bar */}
      <header
        className="h-14 flex items-center justify-between px-5 border-b border-white/5"
        style={{ boxShadow: "0 1px 0 rgba(255,107,26,0.2)" }}
      >
        <CoilAegisLogo size={26} variant="full" tone="light" />
        <span className="hidden sm:inline-flex text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
          Field Operations Platform
        </span>
      </header>

      <main className="flex-1">
        {/* Hero / sign-in */}
        <section className="relative overflow-hidden">
          {/* Subtle grid + glow backdrop */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.08] pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,107,26,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,107,26,0.4) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
          <div
            aria-hidden
            className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(255,107,26,0.18) 0%, transparent 60%)" }}
          />

          <div className="relative max-w-6xl mx-auto px-5 py-12 md:py-20 grid md:grid-cols-2 gap-10 items-center">
            {/* Left: pitch */}
            <div>
              <div className="inline-flex items-center gap-2 bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 rounded-full px-3 py-1 mb-5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF6B1A] animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF6B1A]">Live Ops · Rig-Grade</span>
              </div>
              <h1
                className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight mb-5"
                data-testid="home-hero-title"
              >
                Shield your <span className="text-[#FF6B1A]">coil string</span>.
                <br className="hidden sm:block" />
                Run every job tighter.
              </h1>
              <p className="text-base text-white/70 max-w-xl leading-relaxed">
                CoilAegis is the field-operations platform for coiled-tubing crews. Real-time telemetry, API RP 5C7 triaxial stress, Palmgren-Miner fatigue, SOP-grounded AI, and a crew hub — all built for the doghouse.
              </p>

              <div className="mt-6 flex flex-wrap gap-3 text-[11px] text-white/60">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-[#FF6B1A]" /> API 5CT · AER-aligned</span>
                <span className="inline-flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-[#FF6B1A]" /> WITS 0 / Modbus ready</span>
                <span className="inline-flex items-center gap-1.5"><Cloud className="w-3.5 h-3.5 text-[#FF6B1A]" /> Offline-first</span>
              </div>
            </div>

            {/* Right: sign-in card */}
            <div
              className="bg-[#111827] border border-white/10 rounded-xl p-6 md:p-8 shadow-2xl max-w-md w-full md:ml-auto"
              style={{ boxShadow: "0 25px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,107,26,0.15)" }}
              data-testid="login-card"
            >
              <div className="flex items-center gap-3 mb-1">
                <CoilAegisLogo size={32} variant="icon" />
                <h2 className="text-xl font-extrabold tracking-tight">Welcome to CoilAegis</h2>
              </div>
              <p className="text-sm text-white/60 mb-6">
                Sign in to open your rig, pull live telemetry, and sync jobs across the crew.
              </p>

              <button
                data-testid="google-signin-btn"
                onClick={handleGoogleLogin}
                className="w-full bg-white hover:bg-white/95 text-[#0D1A24] py-3 px-4 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-3 hover:scale-[1.01]"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span>Sign in with Google</span>
              </button>

              <div className="mt-6 grid grid-cols-1 gap-3 text-[12px] text-white/70">
                <div className="flex items-center gap-2"><Cloud className="w-4 h-4 text-[#FF6B1A]" strokeWidth={2} /><span>Sync field jobs across the crew</span></div>
                <div className="flex items-center gap-2"><Users className="w-4 h-4 text-[#FF6B1A]" strokeWidth={2} /><span>Rig-scoped chat, tasks, timecards</span></div>
                <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#FF6B1A]" strokeWidth={2} /><span>API RP 5C7 · AER · IWCF citations</span></div>
              </div>

              <div className="mt-6 bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 rounded-lg p-3 text-xs">
                <p className="font-bold text-[#FF6B1A] mb-1">30-Day Free Trial — No credit card</p>
                <p className="text-white/70">Full platform access for 30 days. Then <span className="font-semibold text-white">$19.99/month</span> or <span className="font-semibold text-white">$179/year</span>.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="max-w-6xl mx-auto px-5 py-12 md:py-20 space-y-10">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#FF6B1A] mb-3">What's inside</p>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3">Built for the doghouse, not the classroom.</h2>
            <p className="text-sm text-white/60 max-w-xl">
              CoilAegis replaces the greasy notebook and half-broken shared Excel every crew ends up passing around. One platform — physics, telemetry, SOPs, scheduling, payroll, AI.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5" data-testid="feature-grid">
            <article className="bg-[#111827] border border-white/10 rounded-xl p-6 hover:border-[#FF6B1A]/50 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Calculator className="w-5 h-5 text-[#FF6B1A]" strokeWidth={2.5} />
                <h3 className="text-base font-extrabold">Real-Time Engineering</h3>
              </div>
              <p className="text-sm text-white/65">
                Triaxial Von Mises (API RP 5C7 thin-wall), Palmgren-Miner fatigue, live traction-pressure accumulation, buckling onset, and a 3D wellbore viewer. Every result cites the standard.
              </p>
            </article>

            <article className="bg-[#111827] border border-white/10 rounded-xl p-6 hover:border-[#FF6B1A]/50 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <AlertOctagon className="w-5 h-5 text-[#F87171]" strokeWidth={2.5} />
                <h3 className="text-base font-extrabold">17 Emergency SOPs</h3>
              </div>
              <p className="text-sm text-white/65">
                Well-control kicks, lost circulation, stuck pipe, H2S alarms, snubbing incidents, BOP failure. Severity badges + step-by-step immediate actions per IWCF WellCAP, AER 037, CSA Z275.2.
              </p>
            </article>

            <article className="bg-[#111827] border border-white/10 rounded-xl p-6 hover:border-[#FF6B1A]/50 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-[#FF6B1A]" strokeWidth={2.5} />
                <h3 className="text-base font-extrabold">AI Field Assistant</h3>
              </div>
              <p className="text-sm text-white/65">
                Six modes grounded in API RP 5C7, API RP 13D, AER 019/020/037, CSA Z662, CGA G-10.1, IWCF WellCAP. Every answer opens with <em>Action Now</em>, drops into <em>Why / Details</em> on tap.
              </p>
            </article>

            <article className="bg-[#111827] border border-white/10 rounded-xl p-6 hover:border-[#FF6B1A]/50 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-5 h-5 text-[#FF6B1A]" strokeWidth={2.5} />
                <h3 className="text-base font-extrabold">Live Ops + Playback</h3>
              </div>
              <p className="text-sm text-white/65">
                WITS 0 / Modbus / WITSML ingest, 10-minute playback scrubber with timeline annotations, CSV/LAS 2.0 export, auto-generated engineering dossier, and 7-day guest share links.
              </p>
            </article>
          </div>

          <div className="bg-[#111827] border border-white/10 rounded-xl p-6">
            <h2 className="text-xl font-extrabold mb-3">Why crews pick this over a paper JHA</h2>
            <ul className="space-y-2 text-sm text-white/70 list-disc pl-5 marker:text-[#FF6B1A]">
              <li><strong className="text-white">Mobile-first.</strong> Runs on any phone, any browser, any hitch. Metric or Imperial toggle on every sheet.</li>
              <li><strong className="text-white">Cited, not guessed.</strong> Every result carries the API, AER, CSA, or IWCF reference in brackets.</li>
              <li><strong className="text-white">Advisory-only by design.</strong> A safety notice stays on every screen — this app supports safe work practices, it does not replace the licensee program, JHA, or site ERP.</li>
              <li><strong className="text-white">Team-aware.</strong> Invite your tool push and day shift to the same workspace. Shared jobs, shared feedback loop.</li>
              <li><strong className="text-white">30-day free trial.</strong> Full access, no credit card. Upgrade to Pro ($19.99/mo or $179/yr) when you're ready.</li>
            </ul>
          </div>

          <div className="text-center text-xs text-white/40 pt-4">
            <p>Advisory only — CoilAegis is an educational and computational aid. It does not supersede company policy, licensee program, or site ERP. Always verify against your JHA and site-specific procedures.</p>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Login;
