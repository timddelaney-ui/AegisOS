import React from "react";
import { FileSpreadsheet, ShieldCheck, Cloud, Users } from "lucide-react";

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

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white border border-[#D4D4D4] rounded-lg shadow-lg max-w-md w-full p-6 md:p-8">
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
            onClick={handleGoogleLogin}
            className="w-full bg-white border border-[#D4D4D4] hover:border-[#107C41] hover:shadow-sm text-[#262626] py-3 px-4 rounded font-semibold text-sm transition-colors flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
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
      </div>
    </div>
  );
};

export default Login;
