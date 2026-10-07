import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Loader2, Calendar, Printer, ChevronLeft, ChevronRight,
  Users, Pencil, Trash2, X, UserPlus, Copy, Save,
} from "lucide-react";
import { API } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";
import RigSelector from "../components/RigSelector";

const ROLES = ["Operator", "Supervisor", "Chief Op", "Swamper", "Pump Op", "Pusher", "Crane Op", "Other"];
const PATTERNS_ROTATING = [
  { id: "14/14", label: "14/14 rotation" },
  { id: "20/10", label: "20/10 rotation" },
  { id: "7/7",   label: "7/7 rotation" },
  { id: "custom",label: "Custom on/off" },
];
const PATTERNS_ONE_OFF = [{ id: "one_off", label: "One-off shift" }];
const ALL_PATTERNS = [...PATTERNS_ONE_OFF, ...PATTERNS_ROTATING];

// Per-crew-member colour so managers can see at a glance who's on what rig.
const CREW_PALETTE = [
  "#0D6535", "#0056B3", "#7C3AED", "#C36600", "#DB2777",
  "#059669", "#B91C1C", "#0891B2", "#4338CA", "#CA8A04",
  "#0F766E", "#9333EA", "#EA580C", "#65A30D", "#BE185D",
  "#0369A1", "#7C2D12", "#4D7C0F", "#6D28D9", "#B45309",
];
const hashName = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
};
const crewColor = (name) => CREW_PALETTE[hashName(name || "?") % CREW_PALETTE.length];
const crewInitials = (name) => (name || "?").trim().split(/\s+/).map((p) => p[0]?.toUpperCase() || "").join("").slice(0, 2) || "?";

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isoDate = (d) => d.toISOString().slice(0, 10);
const shiftLabel = (tour) => (tour === "night" ? "Night shift" : "Day shift");

const buildWeeks = (start, count = 2) => {
  const s = new Date(start);
  s.setDate(s.getDate() - s.getDay()); // back to Sunday
  return Array.from({ length: count * 7 }, (_, i) => addDays(s, i));
};

const shiftCoversDay = (shift, day) => {
  const d = isoDate(day);
  return shift.start_date <= d && (shift.end_date || shift.start_date) >= d;
};

// ─────────────────────────────────────────────────────────────
// Single-shift form (used inline on the schedule page)
// ─────────────────────────────────────────────────────────────
const SingleShiftForm = ({ rigId, onSaved, onCancel }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [f, setF] = useState({
    crew_member_name: "", role: "Operator", tour: "day",
    pattern: "one_off", start_date: isoDate(new Date()), end_date: "",
    rotation_days_on: 14, rotation_days_off: 14, repeat_cycles: 1, note: "",
  });

  const submit = async () => {
    if (!f.crew_member_name?.trim()) { setError("Enter a crew member name."); return; }
    setSaving(true); setError(null);
    try {
      const payload = { ...f, rig_id: rigId };
      if (payload.pattern !== "one_off") delete payload.end_date;
      if (payload.pattern === "one_off" && !payload.end_date) payload.end_date = payload.start_date;
      if (payload.pattern !== "custom") { delete payload.rotation_days_on; delete payload.rotation_days_off; }
      payload.repeat_cycles = parseInt(payload.repeat_cycles, 10) || 1;
      await axios.post(`${API}/schedule`, payload, { withCredentials: true });
      toast.success(`Shift saved for ${f.crew_member_name.trim()}.`);
      onSaved?.(f.start_date);
    } catch (e) {
      const msg = e.response?.data?.detail || "Failed to save shift.";
      setError(msg);
      toast.error(msg);
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white border border-[#D4D4D4] rounded-lg p-3 space-y-2 print:hidden" data-testid="schedule-add-form">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <input data-testid="sched-name" placeholder="Crew member *" value={f.crew_member_name}
          onChange={(e) => setF({ ...f, crew_member_name: e.target.value })}
          className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm" />
        <select data-testid="sched-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}
          className="px-2 py-1.5 border border-[#CCC] rounded text-sm">
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select data-testid="sched-tour" value={f.tour} onChange={(e) => setF({ ...f, tour: e.target.value })}
          className="px-2 py-1.5 border border-[#CCC] rounded text-sm">
          <option value="day">Day shift</option>
          <option value="night">Night shift</option>
        </select>
        <select data-testid="sched-pattern" value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value })}
          className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm">
          {ALL_PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <div className="col-span-2 grid grid-cols-2 gap-2">
          <input data-testid="sched-start" type="date" value={f.start_date}
            onChange={(e) => setF({ ...f, start_date: e.target.value })}
            className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
          {f.pattern === "one_off" ? (
            <input data-testid="sched-end" type="date" value={f.end_date}
              onChange={(e) => setF({ ...f, end_date: e.target.value })}
              className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
          ) : (
            <input data-testid="sched-cycles" type="number" min="1" max="24" placeholder="Cycles"
              value={f.repeat_cycles}
              onChange={(e) => setF({ ...f, repeat_cycles: e.target.value })}
              className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
          )}
        </div>
        {f.pattern === "custom" && (
          <>
            <input placeholder="Days on" type="number" value={f.rotation_days_on}
              onChange={(e) => setF({ ...f, rotation_days_on: parseInt(e.target.value, 10) || 0 })}
              className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
            <input placeholder="Days off" type="number" value={f.rotation_days_off}
              onChange={(e) => setF({ ...f, rotation_days_off: parseInt(e.target.value, 10) || 0 })}
              className="px-2 py-1.5 border border-[#CCC] rounded text-sm" />
          </>
        )}
        <input placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}
          className="col-span-full px-2 py-1.5 border border-[#CCC] rounded text-sm" />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs text-[#595959] px-3 py-1.5">Cancel</button>
        <button data-testid="schedule-save" disabled={saving || !f.crew_member_name?.trim()}
          onClick={submit}
          className="text-xs font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-4 py-1.5 rounded disabled:opacity-50 inline-flex items-center gap-1">
          {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : "Save shift"}
        </button>
      </div>
      {error && <div className="text-[11px] text-[#721C24]" data-testid="schedule-error">{error}</div>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Crew Builder / Editor modal
// ─────────────────────────────────────────────────────────────
const emptyCrewDraft = () => ({
  name: "Crew A",
  tour: "day",
  pattern: "14/14",
  rotation_days_on: 14,
  rotation_days_off: 14,
  start_date: isoDate(new Date()),
  repeat_cycles: 6,
  members: [{ name: "", role: "Supervisor" }],
  auto_create_opposite: true,
  opposite_name: "",
  note: "",
});

const CrewBuilderModal = ({ open, rigId, editing, onClose, onSaved }) => {
  const [draft, setDraft] = useState(emptyCrewDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDraft({
        name: editing.name || "Crew",
        tour: editing.tour || "day",
        pattern: editing.pattern || "14/14",
        rotation_days_on: editing.rotation_days_on || 14,
        rotation_days_off: editing.rotation_days_off || 14,
        start_date: editing.start_date || isoDate(new Date()),
        repeat_cycles: editing.repeat_cycles || 6,
        members: (editing.members || []).length ? editing.members.map((m) => ({ ...m })) : [{ name: "", role: "Supervisor" }],
        auto_create_opposite: false,
        opposite_name: "",
        note: editing.note || "",
      });
    } else {
      setDraft(emptyCrewDraft());
    }
    setError(null);
  }, [open, editing]);

  if (!open) return null;

  const setMember = (i, key, v) => {
    setDraft((d) => ({ ...d, members: d.members.map((m, idx) => (idx === i ? { ...m, [key]: v } : m)) }));
  };
  const addMember = () => setDraft((d) => ({ ...d, members: [...d.members, { name: "", role: "Operator" }] }));
  const removeMember = (i) => setDraft((d) => ({ ...d, members: d.members.filter((_, idx) => idx !== i) }));

  const submit = async () => {
    const cleanMembers = draft.members.filter((m) => m.name?.trim());
    if (!cleanMembers.length) { setError("Add at least one crew member."); return; }
    if (draft.pattern === "custom" && (!draft.rotation_days_on || !draft.rotation_days_off)) {
      setError("Custom rotation needs both days-on and days-off."); return;
    }
    setSaving(true); setError(null);
    try {
      const payload = {
        rig_id: rigId,
        name: draft.name.trim() || "Crew",
        tour: draft.tour,
        pattern: draft.pattern,
        rotation_days_on: draft.pattern === "custom" ? parseInt(draft.rotation_days_on, 10) : null,
        rotation_days_off: draft.pattern === "custom" ? parseInt(draft.rotation_days_off, 10) : null,
        start_date: draft.start_date,
        repeat_cycles: parseInt(draft.repeat_cycles, 10) || 6,
        members: cleanMembers.map((m) => ({ name: m.name.trim(), role: m.role })),
        note: draft.note || null,
      };
      if (editing) {
        await axios.patch(`${API}/crews/${editing.crew_id}`, payload, { withCredentials: true });
        toast.success(`${payload.name} updated — schedule regenerated.`);
      } else {
        payload.auto_create_opposite = !!draft.auto_create_opposite;
        payload.opposite_name = draft.opposite_name || null;
        await axios.post(`${API}/crews`, payload, { withCredentials: true });
        toast.success(`${payload.name} created${payload.auto_create_opposite ? " with opposite crew" : ""} — shifts generated.`);
      }
      onSaved?.(draft.start_date);
      onClose();
    } catch (e) {
      const msg = e.response?.data?.detail || "Failed to save crew.";
      setError(msg);
      toast.error(msg);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[95] flex items-end sm:items-center justify-center sm:p-2 print:hidden dialog-sheet" data-testid="crew-builder-modal">
      <div className="bg-white w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-lg shadow-2xl border-t-4 border-[#0D6535] dialog-sheet-panel">
        <div className="sticky top-0 bg-[#F0F9F3] px-3 py-2 flex items-center gap-2 border-b border-[#D1E7DD] z-10">
          <Users className="w-4 h-4 text-[#0D6535]" />
          <h2 className="text-sm font-bold text-[#0D6535] flex-1">{editing ? `Edit ${editing.name}` : "New crew"}</h2>
          <button onClick={onClose} className="p-1 hover:bg-white rounded" data-testid="crew-builder-close"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-3 py-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="col-span-2 text-[11px] font-semibold text-[#595959] block">
              Crew name
              <input data-testid="crew-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="mt-1 w-full px-2 py-1.5 border border-[#CCC] rounded text-sm font-normal" />
            </label>
            <label className="text-[11px] font-semibold text-[#595959] block">
              Shift type
              <select data-testid="crew-tour" value={draft.tour} onChange={(e) => setDraft({ ...draft, tour: e.target.value })}
                className="mt-1 w-full px-2 py-1.5 border border-[#CCC] rounded text-sm font-normal">
                <option value="day">Day shift</option>
                <option value="night">Night shift</option>
              </select>
            </label>
            <label className="text-[11px] font-semibold text-[#595959] block">
              Rotation
              <select data-testid="crew-pattern" value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
                className="mt-1 w-full px-2 py-1.5 border border-[#CCC] rounded text-sm font-normal">
                {PATTERNS_ROTATING.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-[#595959] block">
              Crew-change date
              <input data-testid="crew-start-date" type="date" value={draft.start_date}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                className="mt-1 w-full px-2 py-1.5 border border-[#CCC] rounded text-sm font-normal" />
            </label>
            <label className="text-[11px] font-semibold text-[#595959] block">
              Cycles
              <input data-testid="crew-cycles" type="number" min="1" max="24" value={draft.repeat_cycles}
                onChange={(e) => setDraft({ ...draft, repeat_cycles: e.target.value })}
                className="mt-1 w-full px-2 py-1.5 border border-[#CCC] rounded text-sm font-normal" />
            </label>
            {draft.pattern === "custom" && (
              <>
                <label className="text-[11px] font-semibold text-[#595959] block">
                  Days on
                  <input type="number" min="1" max="60" value={draft.rotation_days_on}
                    onChange={(e) => setDraft({ ...draft, rotation_days_on: parseInt(e.target.value, 10) || 0 })}
                    className="mt-1 w-full px-2 py-1.5 border border-[#CCC] rounded text-sm font-normal" />
                </label>
                <label className="text-[11px] font-semibold text-[#595959] block">
                  Days off
                  <input type="number" min="1" max="60" value={draft.rotation_days_off}
                    onChange={(e) => setDraft({ ...draft, rotation_days_off: parseInt(e.target.value, 10) || 0 })}
                    className="mt-1 w-full px-2 py-1.5 border border-[#CCC] rounded text-sm font-normal" />
                </label>
              </>
            )}
          </div>

          {/* Members */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-bold text-[#0D6535] uppercase tracking-wide">Personnel on duty</div>
              <button onClick={addMember} data-testid="crew-add-member"
                className="text-[11px] font-bold text-[#0D6535] border border-[#0D6535] px-2 py-0.5 rounded flex items-center gap-1 hover:bg-[#F0F9F3]">
                <UserPlus className="w-3 h-3" /> Add member
              </button>
            </div>
            <div className="space-y-1.5">
              {draft.members.map((m, i) => (
                <div key={i} className="flex items-center gap-1.5" data-testid={`crew-member-row-${i}`}>
                  <span className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                    style={{ background: crewColor(m.name || `slot-${i}`) }}>
                    {crewInitials(m.name || "?")}
                  </span>
                  <input placeholder="Full name" value={m.name} onChange={(e) => setMember(i, "name", e.target.value)}
                    data-testid={`crew-member-name-${i}`}
                    className="flex-1 px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                  <select value={m.role} onChange={(e) => setMember(i, "role", e.target.value)}
                    data-testid={`crew-member-role-${i}`}
                    className="w-28 px-2 py-1.5 border border-[#CCC] rounded text-sm">
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button onClick={() => removeMember(i)} data-testid={`crew-member-remove-${i}`}
                    disabled={draft.members.length === 1}
                    className="p-1 text-[#B91C1C] hover:bg-[#FEF2F2] rounded disabled:opacity-30">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Opposite crew — only on create */}
          {!editing && (
            <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded p-2 space-y-2">
              <label className="flex items-center gap-2 text-[12px] font-semibold text-[#262626] cursor-pointer">
                <input type="checkbox" checked={draft.auto_create_opposite}
                  data-testid="crew-auto-opposite"
                  onChange={(e) => setDraft({ ...draft, auto_create_opposite: e.target.checked })} />
                Also create the opposite crew (flips days-on ↔ days-off and shift type)
              </label>
              {draft.auto_create_opposite && (
                <input placeholder={`Opposite crew name (default: ${draft.name.trim().endsWith("A") ? draft.name.trim().replace(/A$/,"B") : draft.name + " (opposite)"})`}
                  value={draft.opposite_name}
                  data-testid="crew-opposite-name"
                  onChange={(e) => setDraft({ ...draft, opposite_name: e.target.value })}
                  className="w-full px-2 py-1.5 border border-[#CCC] rounded text-sm" />
              )}
              <div className="text-[10px] text-[#595959] italic">
                The opposite crew starts empty — add its members later from the crew list.
              </div>
            </div>
          )}

          <label className="text-[11px] font-semibold text-[#595959] block">
            Note (optional)
            <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              className="mt-1 w-full px-2 py-1.5 border border-[#CCC] rounded text-sm font-normal" />
          </label>

          {error && <div className="text-[11px] text-[#721C24] bg-[#F8D7DA] border border-[#F5C6CB] rounded px-2 py-1" data-testid="crew-builder-error">{error}</div>}
        </div>

        <div className="sticky bottom-0 bg-[#F9FAFB] border-t border-[#E5E7EB] px-3 py-2 flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs text-[#595959] px-3 py-1.5">Cancel</button>
          <button data-testid="crew-save" disabled={saving} onClick={submit}
            className="text-xs font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-4 py-1.5 rounded disabled:opacity-50 inline-flex items-center gap-1">
            {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : (<><Save className="w-3 h-3" /> {editing ? "Save changes" : "Create crew"}</>)}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
const CrewSchedulePage = () => {
  const navigate = useNavigate();
  const { rigId } = useRig();
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const [shifts, setShifts] = useState([]);
  const [crews, setCrews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingCrew, setEditingCrew] = useState(null);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "grid";
    try {
      const saved = localStorage.getItem("ctp_schedule_view_v1");
      if (saved) return saved;
    } catch {}
    return window.innerWidth < 640 ? "list" : "grid";
  });

  useEffect(() => {
    try { localStorage.setItem("ctp_schedule_view_v1", viewMode); } catch {}
  }, [viewMode]);

  const days = useMemo(() => buildWeeks(anchor, 2), [anchor]);
  const rangeStart = isoDate(days[0]);
  const rangeEnd = isoDate(days[days.length - 1]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [sched, crewList] = await Promise.all([
        axios.get(`${API}/schedule`, { params: { rig_id: rigId, start: rangeStart, end: rangeEnd }, withCredentials: true }),
        axios.get(`${API}/crews`, { params: { rig_id: rigId }, withCredentials: true }),
      ]);
      setShifts(sched.data.shifts || []);
      setCrews(crewList.data.crews || []);
    } catch (e) { setError(e.response?.data?.detail || "Failed to load."); }
    finally { setLoading(false); }
  }, [rigId, rangeStart, rangeEnd]);

  useEffect(() => { load(); }, [load]);

  const onShiftSaved = async (startDate) => {
    setShowAdd(false);
    if (startDate) setAnchor(startDate);
    await load();
  };

  const onCrewSaved = async (startDate) => {
    if (startDate) setAnchor(startDate);
    await load();
  };

  const removeShift = async (shift) => {
    if (!window.confirm(`Delete ${shift.crew_member_name}'s shift on ${shift.start_date}?`)) return;
    try {
      await axios.delete(`${API}/schedule/${shift.shift_id}`, { withCredentials: true });
      toast.success("Shift deleted.");
      await load();
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed."); }
  };

  const deleteCrew = async (crew) => {
    if (!window.confirm(`Delete ${crew.name} and all its generated shifts?`)) return;
    try {
      await axios.delete(`${API}/crews/${crew.crew_id}`, { withCredentials: true });
      toast.success(`${crew.name} deleted.`);
      await load();
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed."); }
  };

  const printSchedule = () => window.print();

  // Group shifts by crew member for a row-per-person view.
  const rows = useMemo(() => {
    const map = new Map();
    for (const s of shifts) {
      const key = s.crew_member_name;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return Array.from(map.entries()).map(([name, list]) => ({
      name,
      role: list[0].role,
      crew_name: list[0].crew_name,
      shifts: list,
    }));
  }, [shifts]);

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col print:bg-white">
      <header className="bg-[#0D6535] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0 print:hidden">
        <button onClick={() => navigate("/hub")} data-testid="schedule-back" className="flex items-center gap-1.5 text-sm font-semibold"><ArrowLeft className="w-4 h-4" /> Back</button>
        <h1 className="text-sm font-semibold ml-4 flex items-center gap-2"><Calendar className="w-4 h-4" /> Crew Schedule · {rigLabel(rigId)}</h1>
      </header>
      <div className="print:hidden"><RigSelector /></div>

      <div className="flex-1 p-3 pb-10 overflow-auto">
        <div className="max-w-6xl mx-auto space-y-3">
          {/* ── Crew Manager ────────────────────────────────── */}
          <div className="bg-white border border-[#D4D4D4] rounded-lg print:hidden" data-testid="crew-manager">
            <div className="px-3 py-2 border-b border-[#E5E7EB] flex items-center gap-2">
              <Users className="w-4 h-4 text-[#0D6535]" />
              <div className="text-[13px] font-bold text-[#0D6535] flex-1">Crews on {rigLabel(rigId)}</div>
              <button data-testid="crew-new"
                onClick={() => { setEditingCrew(null); setBuilderOpen(true); }}
                className="text-[11px] font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-2 py-1 rounded flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> New crew
              </button>
            </div>
            <div className="p-3">
              {crews.length === 0 ? (
                <div className="text-[12px] text-[#595959] italic">
                  No crews yet — click <strong>New crew</strong> to build one with personnel and rotation days. Individual shifts still work below.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {crews.map((c) => (
                    <div key={c.crew_id} className="border border-[#E5E7EB] rounded p-2 flex flex-col gap-1.5" data-testid={`crew-card-${c.crew_id}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-6 h-6 rounded text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                          style={{ background: crewColor(c.name) }}>{crewInitials(c.name)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-bold truncate">{c.name}</div>
                          <div className="text-[10px] text-[#595959]">
                            {shiftLabel(c.tour)} · {c.pattern === "custom" ? `${c.rotation_days_on}/${c.rotation_days_off}` : c.pattern} · starts {c.start_date} · {c.repeat_cycles} cycles
                          </div>
                        </div>
                        <button onClick={() => { setEditingCrew(c); setBuilderOpen(true); }} data-testid={`crew-edit-${c.crew_id}`}
                          className="p-1 text-[#0D6535] hover:bg-[#F0F9F3] rounded" title="Edit crew">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteCrew(c)} data-testid={`crew-delete-${c.crew_id}`}
                          className="p-1 text-[#B91C1C] hover:bg-[#FEF2F2] rounded" title="Delete crew">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(c.members || []).length === 0 && (
                          <span className="text-[10px] italic text-[#B45309]">No members yet — click <Pencil className="w-2.5 h-2.5 inline" /> to add.</span>
                        )}
                        {(c.members || []).map((m, idx) => (
                          <span key={`${c.crew_id}-${idx}`} className="inline-flex items-center gap-1 text-[10px] bg-[#F0F9F3] border border-[#D1E7DD] rounded-full px-1.5 py-0.5">
                            <span className="w-3.5 h-3.5 rounded-full text-white flex items-center justify-center text-[7px] font-bold" style={{ background: crewColor(m.name) }}>{crewInitials(m.name)}</span>
                            <span className="font-semibold text-[#262626]">{m.name}</span>
                            <span className="text-[#8A8A8A]">· {m.role}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Schedule nav bar ───────────────────────────────── */}
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-3 flex items-center gap-2 flex-wrap print:hidden">
            <button data-testid="schedule-prev" onClick={() => setAnchor(isoDate(addDays(anchor, -14)))} className="p-2 rounded hover:bg-[#F0F9F3] tap-44" aria-label="Previous"><ChevronLeft className="w-4 h-4" /></button>
            <div className="text-[12px] sm:text-[13px] font-bold">{new Date(days[0]).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {new Date(days[days.length-1]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
            <button data-testid="schedule-next" onClick={() => setAnchor(isoDate(addDays(anchor, 14)))} className="p-2 rounded hover:bg-[#F0F9F3] tap-44" aria-label="Next"><ChevronRight className="w-4 h-4" /></button>
            <button data-testid="schedule-today" onClick={() => setAnchor(isoDate(new Date()))} className="text-[11px] font-semibold text-[#0D6535] hover:underline px-2 py-2 tap-44">Today</button>
            <div className="ml-auto flex gap-1.5 flex-wrap">
              <div className="inline-flex rounded border border-[#0D6535] overflow-hidden" data-testid="schedule-view-toggle">
                <button onClick={() => setViewMode("list")} data-testid="schedule-view-list"
                  className={`text-[11px] font-bold px-2 py-1.5 ${viewMode === "list" ? "bg-[#0D6535] text-white" : "text-[#0D6535] hover:bg-[#F0F9F3]"}`}>List</button>
                <button onClick={() => setViewMode("grid")} data-testid="schedule-view-grid"
                  className={`text-[11px] font-bold px-2 py-1.5 ${viewMode === "grid" ? "bg-[#0D6535] text-white" : "text-[#0D6535] hover:bg-[#F0F9F3]"}`}>Grid</button>
              </div>
              <button data-testid="schedule-print" onClick={printSchedule} className="text-[11px] font-bold text-[#0D6535] border border-[#0D6535] px-2 py-1.5 rounded flex items-center gap-1 tap-44"><Printer className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Print / PDF</span><span className="sm:hidden">PDF</span></button>
              <button data-testid="schedule-add-open" onClick={() => setShowAdd((v) => !v)} className="text-[11px] font-bold text-[#0D6535] border border-[#0D6535] px-2 py-1.5 rounded flex items-center gap-1 tap-44"><Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">One-off shift</span><span className="sm:hidden">Shift</span></button>
            </div>
          </div>

          {showAdd && (
            <SingleShiftForm rigId={rigId} onSaved={onShiftSaved} onCancel={() => setShowAdd(false)} />
          )}

          {/* ── Mobile list view (one card per person) ──────── */}
          {viewMode === "list" && (
            <div className="space-y-2 print:hidden" data-testid="schedule-list-view">
              {loading && <div className="p-6 text-center text-[12px] text-[#595959]"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading…</div>}
              {!loading && rows.length === 0 && (
                <div className="bg-white border border-[#D4D4D4] rounded-lg p-6 text-center text-[12px] text-[#595959]">
                  No shifts for {rigLabel(rigId)} in this 14-day window.<br />
                  <span className="text-[11px] italic">Try <strong>Today</strong>, or the arrows — rotation shifts may sit outside the current view.</span>
                </div>
              )}
              {rows.map((r) => (
                <div key={r.name} className="bg-white border border-[#D4D4D4] rounded-lg p-3" data-testid={`sched-list-row-${r.name}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-9 h-9 rounded-full text-white flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: crewColor(r.name) }}>
                      {crewInitials(r.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-[#262626] truncate">{r.name}</div>
                      <div className="text-[10px] font-semibold uppercase text-[#595959] tracking-wide truncate">
                        {r.role}{r.crew_name ? ` · ${r.crew_name}` : ""}
                      </div>
                    </div>
                    <div className="text-[10px] text-[#595959] text-right flex-shrink-0">
                      {r.shifts.length} shift{r.shifts.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {days.map((d) => {
                      const covering = r.shifts.filter((s) => shiftCoversDay(s, d));
                      const isWknd = [0, 6].includes(d.getDay());
                      const s = covering[0];
                      return (
                        <button
                          key={isoDate(d)}
                          onClick={() => s && removeShift(s)}
                          disabled={!s}
                          className={`flex flex-col items-center rounded py-1 border ${s ? "border-transparent cursor-pointer" : "border-dashed border-[#E5E7EB] cursor-default"}`}
                          style={s ? { background: crewColor(s.crew_member_name), opacity: s.tour === "night" ? 0.78 : 1 } : {}}
                          data-testid={s ? `sched-list-cell-${s.shift_id}` : undefined}
                          title={s ? `${shiftLabel(s.tour)} · ${s.start_date}${s.end_date && s.end_date !== s.start_date ? " → " + s.end_date : ""}${s.note ? " · " + s.note : ""}\n(Tap to delete)` : "Off"}
                        >
                          <span className={`text-[8px] font-bold uppercase ${s ? "text-white/90" : (isWknd ? "text-[#C00000]" : "text-[#8A8A8A]")}`}>
                            {d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}
                          </span>
                          <span className={`text-[12px] font-bold ${s ? "text-white" : (isWknd ? "text-[#C00000]" : "text-[#262626]")}`}>
                            {d.getDate()}
                          </span>
                          {s && <span className="text-[8px] font-bold text-white/90 leading-none">{s.tour === "night" ? "N" : "D"}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Desktop grid view (14-day table) ────────────── */}
          {viewMode === "grid" && (
          <div className="bg-white border border-[#D4D4D4] rounded-lg overflow-hidden print:border-0" id="schedule-print-area">
            <div className="px-3 py-2 border-b border-[#E5E7EB] flex items-center justify-between print:border-0">
              <div className="text-[13px] font-bold text-[#0D6535]">{rigLabel(rigId)} · 14-day crew schedule</div>
              <div className="text-[10px] text-[#595959]">{new Date(days[0]).toLocaleDateString()} – {new Date(days[days.length-1]).toLocaleDateString()}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-2 py-1.5 bg-[#F9FAFB] border-b border-[#E5E7EB] sticky left-0">Crew / Role</th>
                    {days.map((d) => (
                      <th key={isoDate(d)} className={`text-center px-1 py-1 bg-[#F9FAFB] border-b border-[#E5E7EB] font-normal ${[0,6].includes(d.getDay()) ? "text-[#C00000]" : "text-[#262626]"}`} style={{ minWidth: 34 }}>
                        <div className="text-[9px] uppercase">{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                        <div className="text-[10px] font-bold">{d.getDate()}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={days.length + 1} className="p-6 text-center text-[12px] text-[#595959]"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading…</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={days.length + 1} className="p-8 text-center text-[12px] text-[#595959]">
                      No shifts scheduled for {rigLabel(rigId)} in this window.<br />
                      <span className="text-[11px] italic">Try <strong>Today</strong>, or the arrows — rotation shifts may sit outside the current 14-day view.</span>
                    </td></tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.name} data-testid={`sched-row-${r.name}`} className="border-b border-[#F0F0F0]">
                      <td className="px-2 py-1.5 text-[11px] font-bold sticky left-0 bg-white">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                            style={{ background: crewColor(r.name) }}
                            title={r.name}
                          >
                            {crewInitials(r.name)}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate">{r.name}</div>
                            <div className="text-[9px] font-semibold uppercase text-[#595959]">
                              {r.role}{r.crew_name ? ` · ${r.crew_name}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      {days.map((d) => {
                        const covering = r.shifts.filter((s) => shiftCoversDay(s, d));
                        return (
                          <td key={isoDate(d)} className="p-0 border-l border-[#F0F0F0] align-middle">
                            {covering.length === 0 ? (
                              <div className="h-6" />
                            ) : (
                              <div className="flex flex-col gap-[1px] p-[1px]">
                                {covering.map((s) => (
                                  <button
                                    key={s.shift_id}
                                    onClick={() => removeShift(s)}
                                    title={`${s.crew_member_name} · ${s.role} · ${shiftLabel(s.tour)} · ${s.start_date}${s.end_date && s.end_date !== s.start_date ? " → " + s.end_date : ""}${s.note ? " · " + s.note : ""}\n(Click to delete)`}
                                    className="h-5 rounded text-[9px] font-bold text-white flex items-center justify-center print:text-black print:bg-white print:border"
                                    style={{ background: crewColor(s.crew_member_name), opacity: s.tour === "night" ? 0.72 : 1 }}
                                    data-testid={`sched-cell-${s.shift_id}`}
                                  >
                                    {s.tour === "night" ? "N" : "D"}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 bg-[#F9FAFB] flex flex-wrap gap-3 text-[10px] print:bg-white">
              {rows.map((r) => (
                <span key={r.name} className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full text-white flex items-center justify-center text-[7px] font-bold" style={{ background: crewColor(r.name) }}>
                    {crewInitials(r.name)}
                  </span>
                  <span className="font-semibold text-[#262626]">{r.name}</span>
                  <span className="text-[#8A8A8A]">· {r.role}</span>
                </span>
              ))}
              {rows.length > 0 && <span className="ml-auto italic text-[#595959]">D = day shift · N = night shift · click a cell to delete</span>}
              {rows.length === 0 && <span className="italic text-[#595959]">Colour blocks are assigned per crew member so managers see who's on which rig at a glance.</span>}
            </div>
          </div>
          )}

          {error && <div className="text-[11px] text-[#721C24] bg-[#F8D7DA] border border-[#F5C6CB] rounded px-2 py-1" data-testid="schedule-page-error">{error}</div>}
        </div>
      </div>

      <CrewBuilderModal
        open={builderOpen}
        rigId={rigId}
        editing={editingCrew}
        onClose={() => { setBuilderOpen(false); setEditingCrew(null); }}
        onSaved={onCrewSaved}
      />

      {/* Print-specific styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .print\\:border-0 { border: 0 !important; }
          .print\\:text-black { color: #000 !important; }
          .print\\:bg-white { background: #fff !important; }
          .print\\:border { border: 1px solid #333 !important; }
          #schedule-print-area { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
};

export default CrewSchedulePage;
