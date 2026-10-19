import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Shield, ShieldCheck, Lock, Sparkles, KeyRound, History, Globe,
  CheckCircle2, Loader2, ArrowLeft, RefreshCw,
} from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { useTier } from "../context/TierContext";
import { TIER_SPECS, TIER_ENTERPRISE } from "../lib/tiers";
import ExcelHeader from "../components/ExcelHeader";

/**
 * SecurityCompliancePage — bundled Enterprise feature covering the four
 * subsystems from the Security & Compliance tab:
 *   (a) workspace status (TLS version, data region, team isolation)
 *   (b) encrypted-at-rest treatment / dossier notes (per-team Fernet key)
 *   (c) AI privacy mode (PII scrubber before upstream LLM calls)
 *   (d) audit log tail (append-only ledger of sensitive actions)
 */
export default function SecurityCompliancePage() {
  const { user } = useAuth();
  const { tier, betaUnlock } = useTier();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [termsDraft, setTermsDraft] = useState("");

  const canEdit = tier === TIER_ENTERPRISE || betaUnlock;
  const enterpriseAccent = TIER_SPECS.enterprise.accent;

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, se, lg] = await Promise.all([
        axios.get(`${API}/security/status`, { withCredentials: true }),
        axios.get(`${API}/security/settings`, { withCredentials: true }).catch(() => ({ data: null })),
        axios.get(`${API}/security/audit-log?limit=25`, { withCredentials: true }).catch(() => ({ data: { rows: [] } })),
      ]);
      setStatus(s.data);
      setSettings(se.data || s.data?.settings || null);
      setLog(lg.data?.rows || []);
      setTermsDraft(((se.data || s.data?.settings)?.extra_redaction_terms || []).join(", "));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load security status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const patch = async (next) => {
    setSaving(true);
    try {
      const { data } = await axios.put(`${API}/security/settings`, next, { withCredentials: true });
      setSettings(data);
      toast.success("Security settings saved.");
      // Refresh audit tail so the user sees the write they just made.
      const lg = await axios.get(`${API}/security/audit-log?limit=25`, { withCredentials: true });
      setLog(lg.data?.rows || []);
      // Status chip in header depends on these flags too.
      const s = await axios.get(`${API}/security/status`, { withCredentials: true });
      setStatus(s.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    if (!window.confirm("Rotate team encryption key?\n\nExisting encrypted notes continue to work via the key history ring. The new key is used for all FUTURE writes.")) return;
    setRotating(true);
    try {
      await axios.post(`${API}/security/key/rotate`, {}, { withCredentials: true });
      toast.success("Encryption key rotated. History preserved.");
      await refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Rotation failed");
    } finally {
      setRotating(false);
    }
  };

  const secureActive = !!status?.secure_mode_active;

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100">
      <ExcelHeader />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} data-testid="security-back" className="text-slate-400 hover:text-white flex items-center gap-1 text-xs font-bold">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex-1" />
          <button
            onClick={refresh}
            disabled={loading}
            data-testid="security-refresh"
            className="text-slate-400 hover:text-white flex items-center gap-1 text-xs font-bold"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>
        <div className="relative overflow-hidden rounded-xl border border-white/10 p-5 mb-5"
             style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E293B 100%)" }}>
          <div className="absolute inset-0 opacity-25 pointer-events-none"
               style={{ background: `radial-gradient(ellipse 500px 220px at 85% 10%, ${TIER_SPECS.enterprise.glow}, transparent 60%)` }} />
          <div className="relative flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${enterpriseAccent}20`, border: `1px solid ${enterpriseAccent}60` }}>
              {secureActive ? <ShieldCheck className="w-5 h-5" style={{ color: enterpriseAccent }} /> : <Shield className="w-5 h-5 text-slate-400" />}
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Security &amp; Compliance</div>
              <h1 className="text-xl sm:text-2xl font-bold" data-testid="security-page-title">
                Enterprise privacy posture
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Bundled Enterprise feature · included in the custom quote. Four coordinated subsystems: TLS transport status, encrypted-at-rest notes, AI PII scrubber, append-only audit log.
              </p>
            </div>
            {!canEdit && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
                    style={{ background: "#F59E0B20", color: "#F59E0B", border: "1px solid #F59E0B60" }}>
                Enterprise required
              </span>
            )}
          </div>
        </div>

        {/* (a) Workspace status */}
        <SectionCard
          testid="security-section-status"
          icon={<Globe className="w-4 h-4" />}
          title="Workspace status"
          subtitle="Transport, residency, and team isolation summary — stamp this on client-facing exports."
          accent={enterpriseAccent}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatusTile label="TLS version" value={status?.tls_version || "—"} ok={!!status?.tls_version} />
            <StatusTile label="Data region" value={status?.data_region || "—"} ok={!!status?.data_region} />
            <StatusTile
              label="Team isolation"
              value={status?.team_isolated ? "Isolated" : "Shared workspace"}
              ok={!!status?.team_isolated}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-3">
            Every API call runs through the same encrypted channel — including the dossier email send. The <code className="text-slate-300">[🔒 TLS 1.3]</code> chip in the header reflects this status in real time.
          </div>
        </SectionCard>

        {/* (b) Encrypted at rest */}
        <SectionCard
          testid="security-section-encryption"
          icon={<Lock className="w-4 h-4" />}
          title="Encrypted treatment / dossier notes"
          subtitle="New treatment entries, dossier notes, and crew contacts are symmetric-encrypted at rest with a per-team Fernet key held on the server. DB dumps / backup leaks can't disclose field notes."
          accent={enterpriseAccent}
        >
          <SettingToggle
            label="Enable encryption at rest"
            testid="security-toggle-encryption"
            on={!!settings?.encryption_enabled}
            disabled={!canEdit || saving}
            onChange={(v) => patch({ encryption_enabled: v })}
          />
          {settings?.encryption_enabled && (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
              <KeyRound className="w-3.5 h-3.5" />
              Team key {settings?.key_initialized ? <b className="text-emerald-400 ml-1">initialized</b> : <b className="text-amber-300 ml-1">not yet created</b>}
              <button
                onClick={rotate}
                disabled={!canEdit || rotating}
                data-testid="security-rotate-key"
                className="ml-auto text-[10px] font-bold uppercase tracking-wide bg-white/5 border border-white/15 rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40 flex items-center gap-1"
              >
                {rotating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Rotate key
              </button>
            </div>
          )}
        </SectionCard>

        {/* (c) AI privacy mode */}
        <SectionCard
          testid="security-section-ai-privacy"
          icon={<Sparkles className="w-4 h-4" />}
          title="AI privacy mode"
          subtitle="Before any string is sent to the AI (Gemini / OpenAI), job numbers (J-204), well names, and your custom terms are replaced with placeholders. Nothing sensitive leaves the pod."
          accent={enterpriseAccent}
        >
          <SettingToggle
            label="Scrub PII before every AI call"
            testid="security-toggle-ai-privacy"
            on={!!settings?.ai_privacy_mode}
            disabled={!canEdit || saving}
            onChange={(v) => patch({ ai_privacy_mode: v })}
          />
          <div className="mt-4">
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">
              Custom redaction terms <span className="text-slate-500 font-normal normal-case">(up to 20, comma-separated — e.g. customer or crew names)</span>
            </label>
            <input
              data-testid="security-redaction-terms"
              value={termsDraft}
              onChange={(e) => setTermsDraft(e.target.value)}
              disabled={!canEdit}
              placeholder="Acme Oil, Crew Alpha, Rig Theta…"
              className="w-full bg-black/40 border border-white/15 rounded px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-400/60"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                data-testid="security-save-terms"
                onClick={() => patch({ extra_redaction_terms: termsDraft.split(",").map((x) => x.trim()).filter(Boolean) })}
                disabled={!canEdit || saving}
                className="px-3 py-1.5 rounded text-xs font-bold text-black hover:brightness-110 disabled:opacity-40"
                style={{ background: enterpriseAccent }}
              >
                {saving ? "Saving…" : "Save terms"}
              </button>
              <span className="text-[10px] text-slate-500">
                {(settings?.extra_redaction_terms || []).length} term{(settings?.extra_redaction_terms || []).length === 1 ? "" : "s"} active
              </span>
            </div>
          </div>
        </SectionCard>

        {/* (d) Audit log */}
        <SectionCard
          testid="security-section-audit"
          icon={<History className="w-4 h-4" />}
          title="Audit log"
          subtitle="Append-only ledger of security-sensitive actions. Includes settings changes, key rotations, dossier email sends, and admin tier flips."
          accent={enterpriseAccent}
        >
          <SettingToggle
            label="Enable audit logging"
            testid="security-toggle-audit"
            on={!!settings?.audit_log_enabled}
            disabled={!canEdit || saving}
            onChange={(v) => patch({ audit_log_enabled: v })}
          />
          <div className="mt-3 border border-white/10 rounded-lg overflow-hidden">
            <div className="bg-black/40 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 border-b border-white/10">
              Last {log.length} actions
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              {log.length === 0 && (
                <div className="text-[11px] text-slate-500 italic py-6 text-center">
                  No logged actions yet — toggle a setting and this ledger will populate.
                </div>
              )}
              {log.map((r) => (
                <div
                  key={r._id || `${r.at}-${r.action}`}
                  data-testid="security-audit-row"
                  className="px-3 py-2 border-b border-white/5 last:border-0 flex items-start gap-2 text-[11px] hover:bg-white/5"
                >
                  <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: enterpriseAccent }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-slate-400">{(r.at || "").slice(0, 19).replace("T", " ")}Z</div>
                    <div className="text-slate-200">
                      <b className="text-slate-100">{r.action}</b>
                      {r.target_type && <span className="text-slate-500"> · {r.target_type}</span>}
                      {r.actor_email && <span className="text-slate-500"> · by {r.actor_email}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

const SectionCard = ({ icon, title, subtitle, accent, children, testid }) => (
  <div data-testid={testid} className="relative rounded-xl border border-white/10 bg-[#0F172A] p-5 mb-4 overflow-hidden">
    <div className="absolute inset-0 opacity-10 pointer-events-none"
         style={{ background: `radial-gradient(ellipse 400px 180px at 90% 0%, ${accent}, transparent 60%)` }} />
    <div className="relative">
      <div className="flex items-start gap-2 mb-3">
        <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: `${accent}15`, color: accent }}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold">{title}</h2>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  </div>
);

const StatusTile = ({ label, value, ok }) => (
  <div className="rounded-lg bg-black/40 border border-white/10 px-3 py-2">
    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
      {ok ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Shield className="w-3 h-3 text-slate-500" />}
      {label}
    </div>
    <div className="text-sm font-bold font-mono text-slate-100">{value}</div>
  </div>
);

const SettingToggle = ({ label, on, disabled, onChange, testid }) => (
  <label className={`flex items-center justify-between gap-3 py-1.5 ${disabled ? "opacity-70" : "cursor-pointer"}`}>
    <span className="text-sm text-slate-200">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={testid}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-white/10"} ${disabled ? "cursor-not-allowed" : ""}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  </label>
);
