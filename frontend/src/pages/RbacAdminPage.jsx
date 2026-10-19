import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher, isManagement, planRole, ROLE_LABEL } from "../lib/roles";
import { ShieldCheck, Users, Globe, Briefcase, DollarSign, X, TrendingUp, Pencil, Plus, Trash2, Save } from "lucide-react";

export default function RbacAdminPage() {
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);
  const canSetMgmt = isManagement(user);
  const [members, setMembers] = useState([]);
  const [positions, setPositions] = useState([]);
  const [domains, setDomains] = useState([]);
  const [domainInput, setDomainInput] = useState("");
  const [designateTarget, setDesignateTarget] = useState(null);
  const [showLadder, setShowLadder] = useState(false);

  const refresh = async () => {
    try {
      const [m, p, d] = await Promise.all([
        axios.get(`${API}/rbac/members`, { withCredentials: true }).then((r) => r.data?.members || []),
        axios.get(`${API}/positions`, { withCredentials: true }).then((r) => r.data?.positions || []),
        axios.get(`${API}/rbac/workspace/domains`, { withCredentials: true }).then((r) => r.data?.allowed_domains || []).catch(() => []),
      ]);
      setMembers(m); setPositions(p); setDomains(d); setDomainInput(d.join(", "));
    } catch (e) { console.debug("[RbacAdmin] refresh failed", e?.response?.status || e?.message); }
  };
  useEffect(() => { refresh(); }, []);

  const setRole = async (user_id, role) => {
    try {
      await axios.post(`${API}/rbac/promote`, { user_id, role }, { withCredentials: true });
      toast.success(`Role → ${role}`); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const saveDomains = async () => {
    try {
      const arr = domainInput.split(",").map((s) => s.trim()).filter(Boolean);
      await axios.patch(`${API}/rbac/workspace/domains`, { domains: arr }, { withCredentials: true });
      toast.success("Allowlist saved"); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="Crew Admin · Roles, Positions & Wages" subtitle="Promote crew, assign position designations with editable wages, restrict domain." />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
          <h3 className="text-sm font-bold flex items-center gap-1 mb-2"><Globe className="w-4 h-4" />Allowed Email Domains</h3>
          <div className="flex gap-2 items-center">
            <input data-testid="domains-input" placeholder="acme.com, acme-energy.com" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} className="border rounded px-2 py-1 text-xs flex-1" disabled={!canEdit} />
            {canEdit && <button data-testid="domains-save" onClick={saveDomains} className="bg-[#FF6B1A] text-white px-2 py-1 text-xs font-bold rounded">Save</button>}
          </div>
          <p className="text-[10px] text-[#595959] mt-1">Leave empty to allow any Google-signed-in email. Only enforced on team join.</p>
        </div>

        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold flex items-center gap-1"><Briefcase className="w-4 h-4" />Position Designation Ladder</h3>
            <button data-testid="toggle-ladder" onClick={() => setShowLadder(!showLadder)} className="text-[10px] font-bold text-[#FF6B1A]">
              {showLadder ? "Hide" : "Edit"} ladder
            </button>
          </div>
          <p className="text-[10px] text-[#595959] mb-2">
            The company's promotion ladder with default hourly wages. Wages pre-fill when you designate a crew member, but stay editable per-person.
          </p>
          {showLadder && canEdit && (
            <LadderEditor positions={positions} onChange={refresh} />
          )}
          {!showLadder && (
            <div className="flex flex-wrap gap-1">
              {positions.map((p) => (
                <span key={p.position} data-testid={`pos-pill-${p.position}`}
                  className="inline-flex items-center gap-1 text-[10px] font-bold bg-[#FFF7EF] border border-[#FDBA74] text-[#C44A08] px-2 py-0.5 rounded-full">
                  {p.label}
                  <span className="text-[9px] font-normal text-[#595959]">${p.default_hourly.toFixed(2)}/hr</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
          <h3 className="text-sm font-bold flex items-center gap-1 mb-2"><Users className="w-4 h-4" />Members</h3>
          <div className="space-y-1.5">
            {members.map((m) => (
              <div key={m.user_id} data-testid={`member-${m.user_id}`} className="flex items-center gap-2 bg-[#F8FAFC] rounded p-2 text-xs">
                <span className="w-8 h-8 rounded-full bg-[#FF6B1A] text-white font-bold flex items-center justify-center">{(m.name || m.email).charAt(0).toUpperCase()}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate flex items-center gap-1">
                    {m.name || m.email}
                    {m.position_label && (
                      <span data-testid={`member-designation-${m.user_id}`}
                        className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-[#DBEAFE] text-[#1D4ED8] px-1.5 py-0.5 rounded">
                        <Briefcase className="w-2.5 h-2.5" />{m.position_label}
                      </span>
                    )}
                  </p>
                  <p className="text-[#595959] truncate flex items-center gap-1">
                    {m.email}
                    {m.hourly_rate > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#059669]">
                        · <DollarSign className="w-2.5 h-2.5" />{m.hourly_rate.toFixed(2)}/hr
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-[10px] font-bold uppercase bg-black/5 px-1.5 py-0.5 rounded">{ROLE_LABEL[m.role_plan] || m.role_plan}</span>
                {canEdit && (
                  <div className="flex gap-1">
                    <button data-testid={`promote-guest-${m.user_id}`} onClick={() => setRole(m.user_id, "guest")} className="bg-[#FEF3C7] px-2 py-1 rounded font-bold text-[10px]">Guest</button>
                    <button data-testid={`promote-crew-${m.user_id}`} onClick={() => setRole(m.user_id, "crew")} className="bg-[#F3F4F6] px-2 py-1 rounded font-bold text-[10px]">Crew</button>
                    <button data-testid={`promote-sup-${m.user_id}`} onClick={() => setRole(m.user_id, "supervisor")} className="bg-[#DBEAFE] px-2 py-1 rounded font-bold text-[10px]">Supervisor</button>
                    {canSetMgmt && <button data-testid={`promote-mgmt-${m.user_id}`} onClick={() => setRole(m.user_id, "management")} className="bg-[#DCFCE7] px-2 py-1 rounded font-bold text-[10px]">Management</button>}
                    <button
                      data-testid={`designate-${m.user_id}`}
                      onClick={() => setDesignateTarget(m)}
                      className="bg-[#FFF3CD] hover:bg-[#FDE68A] text-[#C44A08] px-2 py-1 rounded font-bold text-[10px] inline-flex items-center gap-0.5">
                      <TrendingUp className="w-2.5 h-2.5" />Designate
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {designateTarget && (
        <DesignationModal
          member={designateTarget}
          positions={positions}
          onClose={() => setDesignateTarget(null)}
          onSaved={() => { setDesignateTarget(null); refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * Modal: assign a position designation (promotion flow).
 * Picking a position pre-fills the wage with the ladder default; the
 * wage field stays editable for retro raises or negotiated hires.
 */
function DesignationModal({ member, positions, onClose, onSaved }) {
  const [position, setPosition] = useState(member.position || "");
  const [wage, setWage] = useState(member.hourly_rate || 0);
  const [busy, setBusy] = useState(false);
  const prevPos = member.position_label || "Unassigned";
  const prevWage = member.hourly_rate || 0;

  // Auto pre-fill wage with the ladder default when the position changes,
  // unless the user has already typed a custom number.
  const [wageTouched, setWageTouched] = useState(false);
  useEffect(() => {
    if (!wageTouched && position) {
      const p = positions.find((x) => x.position === position);
      if (p) setWage(p.default_hourly);
    }
  }, [position, positions, wageTouched]);

  const picked = positions.find((p) => p.position === position);
  const isPromotion = picked && member.position && picked.ladder > (positions.find((p) => p.position === member.position)?.ladder || 0);
  const isDemotion  = picked && member.position && picked.ladder < (positions.find((p) => p.position === member.position)?.ladder || 0);

  const save = async () => {
    if (!position) { toast.error("Pick a position"); return; }
    const w = Number(wage);
    if (!Number.isFinite(w) || w < 0) { toast.error("Wage must be ≥ 0"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/users/designation`, {
        user_id: member.user_id, position, hourly_rate: w,
      }, { withCredentials: true });
      const flavor = isPromotion ? "Promoted" : isDemotion ? "Reassigned" : "Designation set";
      toast.success(`${flavor} · ${r.data.position_label} · $${w.toFixed(2)}/hr`);
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to set designation");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={onClose} data-testid="designation-modal">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg w-full max-w-md p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm uppercase tracking-wider text-[#C44A08] flex items-center gap-1"><TrendingUp className="w-4 h-4" />Position Designation</h3>
          <button onClick={onClose} className="text-[#595959] hover:text-black"><X className="w-4 h-4" /></button>
        </div>

        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2 mb-3">
          <div className="text-[10px] uppercase tracking-wider text-[#595959] mb-0.5">Member</div>
          <div className="text-sm font-bold">{member.name || member.email}</div>
          <div className="text-[11px] text-[#595959]">
            Current: <b>{prevPos}</b>
            {prevWage > 0 && <span className="text-[#059669]"> · ${prevWage.toFixed(2)}/hr</span>}
          </div>
        </div>

        <label className="text-[10px] uppercase font-bold tracking-wider text-[#595959] block mb-1">Position (ladder)</label>
        <select
          data-testid="designation-position"
          value={position}
          onChange={(e) => { setPosition(e.target.value); setWageTouched(false); }}
          className="w-full border rounded px-2 py-1.5 text-sm mb-3">
          <option value="">— Pick a position —</option>
          {positions.map((p) => (
            <option key={p.position} value={p.position}>
              {p.label} · default ${p.default_hourly.toFixed(2)}/hr
            </option>
          ))}
        </select>

        <label className="text-[10px] uppercase font-bold tracking-wider text-[#595959] block mb-1">
          Hourly wage {picked && !wageTouched && <span className="text-[9px] font-normal italic text-[#595959]">· pre-filled from ladder</span>}
          {picked && wageTouched && <span className="text-[9px] font-normal italic text-[#C44A08]">· customized</span>}
        </label>
        <div className="relative mb-3">
          <DollarSign className="w-4 h-4 absolute left-2 top-2 text-[#595959]" />
          <input
            data-testid="designation-wage"
            type="number"
            step="0.25"
            min="0"
            value={wage}
            onChange={(e) => { setWage(e.target.value); setWageTouched(true); }}
            className="w-full border rounded pl-7 pr-10 py-1.5 text-sm tabular-nums" />
          <span className="absolute right-2 top-1.5 text-[10px] text-[#595959]">/hr</span>
        </div>

        {isPromotion && (
          <div className="bg-[#DCFCE7] border border-[#86EFAC] rounded px-2 py-1 mb-3 text-[11px] text-[#166534] font-bold flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />Promotion up the ladder — logged to audit trail.
          </div>
        )}
        {isDemotion && (
          <div className="bg-[#FEE2E2] border border-[#FCA5A5] rounded px-2 py-1 mb-3 text-[11px] text-[#991B1B] font-bold">
            Lateral / downward reassignment — logged to audit trail.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-bold px-3 py-1.5 rounded bg-[#F3F4F6] text-[#595959]">Cancel</button>
          <button
            data-testid="designation-save"
            onClick={save}
            disabled={busy || !position}
            className="text-xs font-bold px-3 py-1.5 rounded bg-[#FF6B1A] text-white disabled:opacity-40">
            {busy ? "Saving…" : "Save Designation"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline editor for the position ladder — supervisors can create custom
 * positions (e.g. "Night Shift Lead") and edit the default wage of any
 * entry. Default positions can be edited but not deleted.
 */
const DEFAULT_POS_KEYS = new Set([
  "trainee", "operator_1", "operator_2", "senior_op",
  "supervisor_1", "supervisor_2", "field_eng", "specialist", "ops_mgr",
]);

function LadderEditor({ positions, onChange }) {
  const [draft, setDraft] = useState({ position: "", label: "", default_hourly: 0, ladder: 50 });
  const [edits, setEdits] = useState({});  // position_key → { label, default_hourly }

  const save = async (p) => {
    const patch = edits[p.position] || {};
    try {
      await axios.post(`${API}/positions`, {
        position: p.position,
        label: patch.label ?? p.label,
        ladder: patch.ladder ?? p.ladder,
        default_hourly: Number(patch.default_hourly ?? p.default_hourly),
      }, { withCredentials: true });
      setEdits((e) => { const n = { ...e }; delete n[p.position]; return n; });
      toast.success(`Ladder updated · ${p.label}`);
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const remove = async (p) => {
    if (!window.confirm(`Delete custom position ${p.label}?`)) return;
    try {
      await axios.delete(`${API}/positions/${p.position}`, { withCredentials: true });
      toast.success(`${p.label} removed`); onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const add = async () => {
    if (!draft.position || !draft.label || !draft.default_hourly) {
      toast.error("Position key, label and wage are required"); return;
    }
    try {
      await axios.post(`${API}/positions`, {
        position: draft.position.toLowerCase().replace(/\s+/g, "_"),
        label: draft.label,
        ladder: Number(draft.ladder) || 50,
        default_hourly: Number(draft.default_hourly),
      }, { withCredentials: true });
      toast.success(`${draft.label} added to ladder`);
      setDraft({ position: "", label: "", default_hourly: 0, ladder: 50 });
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-1 mb-2">
      {positions.map((p) => {
        const e = edits[p.position] || {};
        const touched = Object.keys(e).length > 0;
        return (
          <div key={p.position} data-testid={`ladder-row-${p.position}`} className="flex items-center gap-2 bg-[#F8FAFC] rounded px-2 py-1 text-xs">
            <span className="text-[9px] font-mono text-[#64748B] w-8">{p.ladder}</span>
            <input
              data-testid={`ladder-label-${p.position}`}
              defaultValue={p.label}
              onChange={(ev) => setEdits({ ...edits, [p.position]: { ...e, label: ev.target.value } })}
              className="border rounded px-1.5 py-0.5 text-xs flex-1" />
            <div className="relative">
              <span className="absolute left-1.5 top-0.5 text-[10px] text-[#595959]">$</span>
              <input
                data-testid={`ladder-wage-${p.position}`}
                type="number" step="0.25" min="0"
                defaultValue={p.default_hourly}
                onChange={(ev) => setEdits({ ...edits, [p.position]: { ...e, default_hourly: ev.target.value } })}
                className="border rounded pl-4 pr-1 py-0.5 text-xs w-20 tabular-nums" />
            </div>
            <button
              data-testid={`ladder-save-${p.position}`}
              onClick={() => save(p)}
              disabled={!touched}
              className={`px-1.5 py-0.5 rounded font-bold text-[10px] inline-flex items-center gap-0.5 ${touched ? "bg-[#FF6B1A] text-white" : "bg-[#F3F4F6] text-[#9CA3AF]"}`}>
              <Save className="w-2.5 h-2.5" />
            </button>
            {!DEFAULT_POS_KEYS.has(p.position) && (
              <button data-testid={`ladder-del-${p.position}`} onClick={() => remove(p)} className="text-[#C00000] p-0.5 rounded">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            {DEFAULT_POS_KEYS.has(p.position) && <span className="text-[9px] text-[#9CA3AF] italic">default</span>}
          </div>
        );
      })}
      <div className="flex items-center gap-2 bg-[#FFF7EF] border border-dashed border-[#FDBA74] rounded px-2 py-1 mt-2 text-xs">
        <input data-testid="ladder-new-ladder" type="number" value={draft.ladder}
          onChange={(e) => setDraft({ ...draft, ladder: e.target.value })}
          placeholder="rank" className="border rounded px-1 py-0.5 text-xs w-12 tabular-nums" />
        <input data-testid="ladder-new-key" value={draft.position}
          onChange={(e) => setDraft({ ...draft, position: e.target.value })}
          placeholder="position_key (lowercase)" className="border rounded px-1.5 py-0.5 text-xs w-40" />
        <input data-testid="ladder-new-label" value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          placeholder="Display label" className="border rounded px-1.5 py-0.5 text-xs flex-1" />
        <input data-testid="ladder-new-wage" type="number" step="0.25" value={draft.default_hourly || ""}
          onChange={(e) => setDraft({ ...draft, default_hourly: e.target.value })}
          placeholder="$/hr" className="border rounded px-1.5 py-0.5 text-xs w-20 tabular-nums" />
        <button data-testid="ladder-add" onClick={add} className="bg-[#FF6B1A] text-white px-2 py-1 rounded font-bold text-[10px] inline-flex items-center gap-0.5">
          <Plus className="w-3 h-3" />Add
        </button>
      </div>
    </div>
  );
}
