import React from "react";
import { FileSpreadsheet, ShieldCheck, Cloud, Users, Sparkles, AlertOctagon, Calculator, BookOpen } from "lucide-react";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
const Login = () => {
  const handleGoogleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/app";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col">
      <header className="bg-[#107C41] text-white h-12 flex items-center justify-between px-4 shadow-md flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" strokeWidth={2.5} />
          <h1 className="text-sm font-semibold tracking-wide">CT_Field_Operations.xlsx</h1>
        </div>
        <div className="text-[10px] bg-white/20 px-1.5 py-[3px] rounded font-medium">MOBILE SPREADSHEET</div>
      </header>

      <main className="flex-1">
        {/* Hero / sign-in section */}
        <section className="flex flex-col items-center justify-center p-4 pt-8 md:pt-12">
          <div className="max-w-2xl w-full text-center mb-6">
            <h2 className="text-3xl md:text-4xl font-bold text-[#262626] mb-3 leading-tight" data-testid="home-hero-title">
              The Coiled Tubing Field Workbook for Real Crews
            </h2>
            <p className="text-sm md:text-base text-[#595959] max-w-xl mx-auto">
              Mobile-first physics calculations, Emergency SOPs, and an AI Field Assistant for coiled tubing, well-control, and wireline crews across Alberta, BC, and the Duvernay. API 5CT and AER Directive-aligned — built in the doghouse, not the boardroom.
            </p>
          </div>

          <div className="bg-white border border-[#D4D4D4] rounded-lg shadow-lg max-w-md w-full p-6 md:p-8" data-testid="login-card">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded bg-[#107C41] flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5 text-white" strokeWidth={2.5} />
              </div>
              <h2 className="text-lg font-bold text-[#262626]">CT Field Workbook</h2>
            </div>
            <p className="text-sm text-[#595959] mb-6">
              API-compliant field calculations for coiled tubing operations. Sign in to save jobs and sync across your crew.
            </p>

            <button
              data-testid="google-signin-btn"
              onClick={handleGoogleLogin}
              className="w-full bg-white border border-[#D4D4D4] hover:border-[#107C41] hover:shadow-sm text-[#262626] py-3 px-4 rounded font-semibold text-sm transition-colors flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span>Sign in with Google</span>
            </button>

            <div className="mt-6 grid grid-cols-1 gap-3 text-xs text-[#444]">
              <div className="flex items-center gap-2"><Cloud className="w-4 h-4 text-[#107C41]" strokeWidth={2} /><span>Save field jobs to the cloud</span></div>
              <div className="flex items-center gap-2"><Users className="w-4 h-4 text-[#107C41]" strokeWidth={2} /><span>Share calculations with your crew</span></div>
              <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#107C41]" strokeWidth={2} /><span>API 5CT & AER Directive compliant</span></div>
            </div>

            <div className="mt-6 bg-[#E6F4EA] border border-[#107C41]/30 rounded p-3 text-xs">
              <p className="font-bold text-[#0D6535] mb-1">30-Day Free Trial — No credit card</p>
              <p className="text-[#0D6535]">Full access to 6 core sheets free for 30 days. Then <span className="font-semibold">$2.99/month</span> or <span className="font-semibold">$24.99/year</span> (30% off) to keep every sheet + Emergency SOPs + AI assistant.</p>
            </div>
          </div>
        </section>

        {/* SEO-rich content section */}
        <section className="max-w-4xl mx-auto px-4 py-10 md:py-16 space-y-10">
          <div className="text-center">
            <h2 className="text-2xl md:text-3xl font-bold text-[#262626] mb-3">Built for the doghouse, not the classroom</h2>
            <p className="text-sm text-[#595959] max-w-2xl mx-auto">
              CT Field Workbook replaces the greasy notebook and half-broken Excel file every coiled-tubing crew ends up passing around. Seventeen operation sheets, seventeen emergency SOPs, an AI Field Assistant on call — all in your pocket, offline-friendly, Metric or Imperial.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6" data-testid="feature-grid">
            <article className="bg-white border border-[#D4D4D4] rounded-lg p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Calculator className="w-5 h-5 text-[#107C41]" strokeWidth={2.5} />
                <h3 className="text-base font-bold text-[#262626]">17 Real Physics Sheets</h3>
              </div>
              <p className="text-sm text-[#595959]">
                Pipe stretch and free-point, sand cleanout, fishing operations, CT milling and drilling, pill spotting, frac-through-CT, annular frac, mechanical and hydraulic sleeves, nitrogen kickoff and purge, acid stimulation, scale squeeze, cement plug, well abandonment, CT perforating, and precision free-point. Every calculation ties back to a cited standard.
              </p>
            </article>

            <article className="bg-white border border-[#D4D4D4] rounded-lg p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <AlertOctagon className="w-5 h-5 text-[#C00000]" strokeWidth={2.5} />
                <h3 className="text-base font-bold text-[#262626]">17 Emergency SOPs</h3>
              </div>
              <p className="text-sm text-[#595959]">
                Well-control kicks, lost circulation, stuck pipe, H2S alarms, snubbing incidents, uncontrolled descent, BOP failure, and more — each with severity badges and step-by-step immediate actions per IWCF WellCAP, AER Directive 037, and CSA Z275.2.
              </p>
            </article>

            <article className="bg-white border border-[#D4D4D4] rounded-lg p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-[#107C41]" strokeWidth={2.5} />
                <h3 className="text-base font-bold text-[#262626]">AI Field Assistant</h3>
              </div>
              <p className="text-sm text-[#595959]">
                Six modes — Field Assistant, Explain Results, Troubleshoot, Training, Job Program, and Emergency — powered by Gemini and grounded in API RP 5C7, API RP 13D, AER Directives 019/020/037, CSA Z662, CGA G-10.1, and IWCF WellCAP. Every answer starts with an <em>Action Now</em> block and drops into <em>Why / Details</em> on tap.
              </p>
            </article>

            <article className="bg-white border border-[#D4D4D4] rounded-lg p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-5 h-5 text-[#107C41]" strokeWidth={2.5} />
                <h3 className="text-base font-bold text-[#262626]">Live Simulations & Saved Jobs</h3>
              </div>
              <p className="text-sm text-[#595959]">
                Every input drives a live SVG schematic — wellbore, coil, BHA, packer, gauge readings — that updates as you type. Save any job to the cloud, share it with your crew, and pull it back up in the field the next day.
              </p>
            </article>
          </div>

          <div className="bg-white border border-[#D4D4D4] rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[#262626] mb-3">Why crews pick this over a paper JHA</h2>
            <ul className="space-y-2 text-sm text-[#444] list-disc pl-5">
              <li><strong>Mobile-first.</strong> Runs on any phone, any browser, any hitch. Metric or Imperial toggle on every sheet.</li>
              <li><strong>Cited, not guessed.</strong> Every result carries the API, AER, CSA, or IWCF reference in brackets.</li>
              <li><strong>Advisory-only by design.</strong> A safety notice stays on every screen — this app supports safe work practices, it does not replace the licensee program, JHA, or site ERP.</li>
              <li><strong>Team-aware.</strong> Invite your tool push and day tour to the same workspace. Shared jobs, shared feedback loop.</li>
              <li><strong>30-day free trial.</strong> Six core sheets unlocked, no credit card. Upgrade to Pro ($2.99/mo or $24.99/yr) for all 17 sheets, Emergency SOPs, and AI.</li>
            </ul>
          </div>

          <div className="text-center text-xs text-[#595959] pt-4">
            <p>Advisory only — CT Field Workbook is an educational and computational aid. It does not supersede company policy, licensee program, or site ERP. Always verify against your JHA and site-specific procedures.</p>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Login;
