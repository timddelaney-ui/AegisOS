import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Shield, X, ChevronDown, Loader2, Check, Search, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useAuth, API } from "../context/AuthContext";
import { useTier } from "../context/TierContext";
import { TIER_SPECS, TIER_ORDER } from "../lib/tiers";

/**
 * AdminTierSwitcher — floating 2-tap control that lets admins reassign any
 * user's plan tier for sales demos (and ad-hoc support).
 *
 * Only renders when the viewer is a platform admin (`/api/admin/whoami`).
 * Keeps itself out of the normal UI with a muted shield icon docked at the
 * bottom-right, expanding into a search-and-select panel on click.
 */
export default function AdminTierSwitcher() {
  const { user } = useAuth();
  const { tier: viewerTier, refresh: refreshTier } = useTier();
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(null); // email currently being updated
  const panelRef = useRef(null);

  // Whoami on mount — if the viewer isn't an admin we render nothing.
  useEffect(() => {
    if (!user) return;
    axios
      .get(`${API}/admin/whoami`, { withCredentials: true })
      .then((r) => setIsAdmin(!!r.data?.is_admin))
      .catch(() => setIsAdmin(false));
  }, [user]);

  // Debounced search
  useEffect(() => {
    if (!open || !isAdmin) return;
    const trimmed = q.trim();
    // Seed with the viewer so a 0-char query still has a target to flip
    // (super useful for "demo my own account" sales flows).
    if (trimmed.length < 2) {
      setResults(user ? [{
        email: user.email,
        name: user.name,
        tier: viewerTier,
        subscription_status: null,
        _self: true,
      }] : []);
      return;
    }
    setSearching(true);
    const h = setTimeout(() => {
      axios
        .get(`${API}/admin/users/search`, { params: { q: trimmed }, withCredentials: true })
        .then((r) => setResults(r.data?.users || []))
        .catch((e) => console.debug("[admin-tier] search failed", e?.message))
        .finally(() => setSearching(false));
    }, 240);
    return () => clearTimeout(h);
  }, [q, open, isAdmin, user, viewerTier]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const setTierFor = async (email, nextTier) => {
    setApplying(email);
    try {
      const r = await axios.post(
        `${API}/admin/users/tier`,
        { email, tier: nextTier },
        { withCredentials: true },
      );
      toast.success(`${email} → ${TIER_SPECS[nextTier]?.label} (was ${TIER_SPECS[r.data.previous_tier]?.label || r.data.previous_tier})`);
      // Update the local result row so the UI reflects the change
      setResults((prev) => prev.map((u) => (u.email === email ? { ...u, tier: nextTier } : u)));
      // If the admin flipped their OWN tier, refresh the TierContext so
      // the Hub re-gates in real time without a reload.
      if (user && email.toLowerCase() === (user.email || "").toLowerCase()) {
        refreshTier();
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Tier change failed");
    } finally {
      setApplying(null);
    }
  };

  if (!user || !isAdmin) return null;

  return (
    <div ref={panelRef} className="fixed bottom-4 right-4 z-[1150] font-sans" data-testid="admin-tier-switcher">
      {open ? (
        <div className="w-[360px] bg-[#0F172A] border border-amber-400/40 rounded-xl shadow-2xl overflow-hidden text-slate-100">
          <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 bg-black/40">
            <Shield className="w-4 h-4 text-amber-300" />
            <div className="text-[11px] font-bold uppercase tracking-wider">Admin · Tier switcher</div>
            <button
              data-testid="admin-tier-switcher-close"
              onClick={() => setOpen(false)}
              className="ml-auto text-slate-400 hover:text-white"
              aria-label="Close"
            ><X className="w-4 h-4" /></button>
          </div>
          <div className="p-3 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                data-testid="admin-tier-switcher-search"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by email or name…"
                className="w-full bg-black/40 border border-white/15 rounded pl-7 pr-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-400/60"
              />
              {searching && <Loader2 className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />}
            </div>
            <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
              {results.length === 0 && !searching && (
                <div className="text-[11px] text-slate-500 italic py-6 text-center">
                  Type at least 2 chars to search users.
                </div>
              )}
              {results.map((u) => {
                const current = u.tier;
                return (
                  <div
                    key={u.email}
                    data-testid={`admin-tier-switcher-row-${u.email.replace(/[^a-z0-9]/gi, "")}`}
                    className="rounded-lg border border-white/10 bg-black/30 p-2 space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <UserCog className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-bold text-white truncate flex items-center gap-1.5">
                          {u.name || u.email}
                          {u._self && (
                            <span className="text-[8px] font-bold tracking-wider uppercase bg-amber-400/20 text-amber-300 border border-amber-400/40 px-1.5 py-[1px] rounded">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate font-mono">{u.email}</div>
                      </div>
                      <div className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0"
                           style={{
                             background: `${TIER_SPECS[current]?.accent}20`,
                             color: TIER_SPECS[current]?.accent,
                             border: `1px solid ${TIER_SPECS[current]?.accent}40`,
                           }}>
                        {TIER_SPECS[current]?.label || current}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {TIER_ORDER.map((t) => {
                        const spec = TIER_SPECS[t];
                        const isOn = current === t;
                        const busy = applying === u.email;
                        return (
                          <button
                            key={t}
                            data-testid={`admin-tier-switcher-set-${t}-${u.email.replace(/[^a-z0-9]/gi, "")}`}
                            onClick={() => !isOn && !busy && setTierFor(u.email, t)}
                            disabled={isOn || busy}
                            className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-1.5 flex items-center justify-center gap-1 transition-colors ${
                              isOn
                                ? "cursor-default"
                                : "bg-white/5 hover:bg-white/10 border border-white/15 text-slate-200"
                            } disabled:opacity-70`}
                            style={isOn ? { background: spec.accent, color: "#000" } : undefined}
                          >
                            {busy && !isOn ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : isOn ? (
                              <Check className="w-3 h-3" />
                            ) : null}
                            {spec.label.split(" ")[0]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-slate-500 italic pt-1 border-t border-white/10">
              Tier changes are logged in <code className="text-slate-400">tier_change_log</code>.
              Flipping your own tier re-gates the Hub live.
            </div>
          </div>
        </div>
      ) : (
        <button
          data-testid="admin-tier-switcher-open"
          onClick={() => setOpen(true)}
          title="Admin · Tier switcher"
          className="w-10 h-10 rounded-full bg-[#0F172A] border border-amber-400/50 text-amber-300 shadow-lg hover:bg-black/80 flex items-center justify-center transition-colors"
        >
          <Shield className="w-4 h-4" />
          <ChevronDown className="w-3 h-3 -ml-1 opacity-70" />
        </button>
      )}
    </div>
  );
}
