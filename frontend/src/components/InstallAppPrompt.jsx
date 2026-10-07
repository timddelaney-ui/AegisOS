import React, { useEffect, useState } from "react";
import { Download, X, Smartphone, Share } from "lucide-react";

// Register the service worker (safe no-op if browser doesn't support it).
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Only register in production builds — the dev-server strips SW too aggressively
  // to be useful, and it can confuse hot reload.
  if (process.env.NODE_ENV !== "production") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      // Non-fatal — the app works fine without SW
      console.debug("SW register failed:", err?.message || err);
    });
  });
}

const STORAGE_KEY = "ctp_install_prompt_dismissed_v1";
const DISMISS_FOR_DAYS = 14;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = () =>
  (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
  window.navigator.standalone === true;

export default function InstallAppPrompt() {
  const [deferred, setDeferred] = useState(null);   // Chrome/Edge/Android beforeinstallprompt event
  const [visible, setVisible] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    // Honor the user's "not now" for N days
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const dismissedAt = new Date(raw);
        const ageDays = (Date.now() - dismissedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays < DISMISS_FOR_DAYS) return;
      }
    } catch {}

    // Chromium path — the browser fires beforeinstallprompt when it decides the PWA is installable
    const onBefore = (e) => {
      e.preventDefault();
      setDeferred(e);
      // Delay the banner so it doesn't collide with the advisory on first load
      setTimeout(() => setVisible(true), 2500);
    };
    window.addEventListener("beforeinstallprompt", onBefore);

    // iOS Safari path — no beforeinstallprompt. Show manual Add-to-Home-Screen help.
    if (isIOS()) {
      setTimeout(() => setVisible(true), 3500);
    }

    const onInstalled = () => setVisible(false);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch {}
    setVisible(false);
    setShowIOSHelp(false);
  };

  const install = async () => {
    if (deferred) {
      try {
        deferred.prompt();
        const { outcome } = await deferred.userChoice;
        setDeferred(null);
        if (outcome === "accepted") setVisible(false);
        else dismiss();  // user cancelled → suppress for N days
      } catch {
        setVisible(false);
      }
    } else if (isIOS()) {
      setShowIOSHelp(true);
    }
  };

  if (!visible) return null;

  return (
    <div
      data-testid="install-app-prompt"
      className="fixed inset-x-0 bottom-0 z-[85] safe-bottom p-2 sm:p-3 flex justify-center pointer-events-none"
    >
      <div className="bg-white rounded-lg shadow-2xl border-l-4 border-[#0D6535] px-3 py-2.5 flex items-start gap-2 pointer-events-auto max-w-md w-full">
        <div className="w-9 h-9 rounded-lg bg-[#0D6535] text-white flex items-center justify-center flex-shrink-0">
          <Smartphone className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          {!showIOSHelp ? (
            <>
              <div className="text-[13px] font-bold text-[#0D6535]">Install CT Workbook</div>
              <div className="text-[11px] text-[#595959] mt-0.5">
                Pin it to your home screen so it opens like a native app — no browser bar.
              </div>
              <div className="flex gap-1.5 mt-2">
                <button
                  onClick={install}
                  data-testid="install-app-accept"
                  className="text-[11px] font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-3 py-1.5 rounded tap-44 inline-flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Install
                </button>
                <button
                  onClick={dismiss}
                  data-testid="install-app-dismiss"
                  className="text-[11px] font-semibold text-[#595959] hover:text-[#262626] px-2 py-1.5 tap-44"
                >
                  Not now
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-[13px] font-bold text-[#0D6535]">Add to Home Screen</div>
              <ol className="text-[11px] text-[#595959] mt-1 space-y-0.5 list-decimal pl-4">
                <li>Tap the <Share className="w-3 h-3 inline mx-0.5 text-[#0D6535]" strokeWidth={2.5} /> Share icon in Safari's toolbar.</li>
                <li>Scroll and tap <strong className="text-[#262626]">Add to Home Screen</strong>.</li>
                <li>Tap <strong className="text-[#262626]">Add</strong>. The icon lands beside your native apps.</li>
              </ol>
              <button onClick={dismiss} className="text-[11px] font-bold text-[#0D6535] mt-2 tap-44">Got it</button>
            </>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="p-1 -mt-1 -mr-1 text-[#8A8A8A] hover:text-[#262626] tap-44"
          data-testid="install-app-close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
