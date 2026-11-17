import React from "react";
import { Lock, Crown, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTier } from "../context/TierContext";
import { TIER_SPECS, FEATURE_SPECS, minTierFor } from "../lib/tiers";

/**
 * FeatureGate — wrap any UI that should be plan-tier aware.
 *
 * Usage patterns:
 *   <FeatureGate feature="live_ops">            // teaser mode
 *     <LiveOpsHeroCard />                       // only renders if canAccess
 *   </FeatureGate>
 *
 *   <FeatureGate feature="live_ops" strict>     // hide completely
 *     <SensitiveEnterpriseWidget />
 *   </FeatureGate>
 *
 * When `strict` is true (or the feature's visibility is "hidden") the gate
 * removes the node entirely for lower-tier users. Otherwise it renders a
 * compact locked card with an upgrade CTA.
 */
export function FeatureGate({ feature, children, strict = false, fallback = null, className = "" }) {
  const { canAccess, hidesCompletely, showsLockedTeaser, promptUpgrade, featureLabel } = useTier();
  if (canAccess(feature)) return <>{children}</>;
  if (strict || hidesCompletely(feature)) return fallback;
  // Teaser render — show something clickable instead of a blank area.
  if (showsLockedTeaser(feature)) {
    const minT = minTierFor(feature);
    const spec = TIER_SPECS[minT];
    return (
      <button
        type="button"
        data-testid={`feature-gate-teaser-${feature}`}
        onClick={() => promptUpgrade(feature)}
        className={`group relative w-full text-left overflow-hidden rounded-xl border border-white/10 bg-slate-900/80 backdrop-blur px-4 py-3 hover:border-amber-300/40 transition-colors ${className}`}
      >
        <div className="absolute inset-0 opacity-20 group-hover:opacity-30 transition-opacity"
             style={{ background: `radial-gradient(ellipse at 85% 50%, ${spec?.glow || "rgba(245,158,11,0.3)"}, transparent 60%)` }} />
        <div className="relative flex items-center gap-2 text-slate-300">
          <Lock className="w-4 h-4 text-amber-300" />
          <span className="text-sm font-bold">{featureLabel(feature)}</span>
          <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: `${spec?.accent}20`, color: spec?.accent, border: `1px solid ${spec?.accent}40` }}>
            {spec?.label}
          </span>
        </div>
        <div className="relative text-[11px] text-slate-500 mt-1">Tap to see what's included — upgrade in two clicks.</div>
      </button>
    );
  }
  return fallback;
}

/** Route-level gate — redirect lower-tier users to /pricing with a hint. */
export function TierProtectedRoute({ feature, children }) {
  const { canAccess, loaded, featureLabel } = useTier();
  const navigate = useNavigate();
  React.useEffect(() => {
    if (!loaded) return;
    if (canAccess(feature)) return;
    navigate(`/pricing?highlight=${encodeURIComponent(minTierFor(feature))}&from=${encodeURIComponent(featureLabel(feature))}`, { replace: true });
  }, [feature, canAccess, loaded, featureLabel, navigate]);
  if (!loaded || !canAccess(feature)) return null;
  return children;
}

/** Floating upgrade modal shown via `promptUpgrade(featureId)`. */
export function UpgradeModal() {
  const { upgradeFor, dismissUpgrade, featureLabel } = useTier();
  const navigate = useNavigate();
  if (!upgradeFor) return null;
  const minT = minTierFor(upgradeFor);
  const spec = TIER_SPECS[minT];
  return (
    <div
      data-testid="upgrade-modal"
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) dismissUpgrade(); }}
    >
      <div className="w-full max-w-md bg-[#0F172A] border border-white/15 rounded-xl shadow-2xl overflow-hidden text-slate-100">
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <Crown className="w-4 h-4" style={{ color: spec?.accent }} />
          <div className="text-sm font-bold uppercase tracking-wider">Upgrade required</div>
          <button
            data-testid="upgrade-modal-close"
            onClick={dismissUpgrade}
            className="ml-auto text-slate-400 hover:text-white"
            aria-label="Close"
          ><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Feature</div>
          <div className="text-lg font-bold">{featureLabel(upgradeFor)}</div>
          <div className="text-[11px] text-slate-500 pt-1 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" style={{ color: spec?.accent }} />
            Included in <b style={{ color: spec?.accent }}>{spec?.label}</b> and above.
          </div>
          <div className="rounded-lg bg-white/5 border border-white/10 p-3 mt-2">
            <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400">{spec?.label}</div>
            <div className="text-[11px] text-slate-500 mb-2">{spec?.tagline}</div>
            {spec?.price_monthly_cad ? (
              <div className="text-xl font-bold" style={{ color: spec?.accent }}>
                ${spec.price_monthly_cad} CAD<span className="text-xs text-slate-400 font-normal"> / user / month</span>
                <div className="text-[10px] text-slate-500 font-normal mt-1">No tax added.</div>
              </div>
            ) : spec?.price_active_monthly_cad ? (
              <div className="text-sm font-bold" style={{ color: spec?.accent }}>
                ${spec.price_active_monthly_cad.toLocaleString("en-CA")} CAD / active month
                <div className="text-[10px] text-slate-400 font-normal mt-1">
                  ${spec.price_standby_monthly_cad.toLocaleString("en-CA")} CAD / standby month
                </div>
              </div>
            ) : (
              <div className="text-xl font-bold" style={{ color: spec?.accent }}>Custom — contact sales</div>
            )}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              data-testid="upgrade-modal-cancel"
              onClick={dismissUpgrade}
              className="flex-1 px-3 py-1.5 rounded text-xs font-bold bg-white/5 border border-white/15 text-slate-300 hover:bg-white/10"
            >Not now</button>
            <button
              data-testid="upgrade-modal-view-plans"
              onClick={() => { dismissUpgrade(); navigate(`/pricing?highlight=${encodeURIComponent(minT)}`); }}
              className="flex-1 px-3 py-1.5 rounded text-xs font-bold text-black hover:brightness-110"
              style={{ background: spec?.accent }}
            >
              View {spec?.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
