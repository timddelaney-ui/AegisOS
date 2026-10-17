import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeft, Cog, Truck, Anchor, ShieldAlert, Gauge, Plus, Trash2, Loader2,
  Wrench, ChevronRight, Calendar, X, AlertTriangle, CheckCircle2, Edit3, Paperclip,
} from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { useRig, rigLabel } from "../context/RigContext";
import RigSelector from "../components/RigSelector";
import AttachmentUploader from "../components/AttachmentUploader";

const KIND_TABS = [
  { id: "engine",    label: "Engine Hours",     Icon: Cog,         accent: "#0056B3" },
  { id: "injector",  label: "Injector Meters",  Icon: Gauge,       accent: "#0D6535" },
  { id: "lifting",   label: "Lifting Gear",     Icon: Anchor,      accent: "#C36600" },
  { id: "bop_pce",   label: "BOP / PCE Tests",  Icon: ShieldAlert, accent: "#C00000" },
  { id: "reel_iron", label: "Reel & Iron",      Icon: Wrench,      accent: "#7C3AED" },
];

const STATUS_STYLE = {
  ok:       { pill: "bg-[#D4EDDA] text-[#155724] border-[#28A745]", label: "OK",       Icon: CheckCircle2 },
  amber:    { pill: "bg-[#FFF3CD] text-[#856404] border-[#FFE69C]", label: "AMBER",    Icon: AlertTriangle },
  red:      { pill: "bg-[#F8D7DA] text-[#721C24] border-[#F5C6CB]", label: "RED",      Icon: AlertTriangle },
  expired:  { pill: "bg-[#F5C6CB] text-[#721C24] border-[#F1B0B7]", label: "EXPIRED",  Icon: AlertTriangle },
};

const emptyForm = {
  engine:    { name: "", serial_number: "", current_hours: "", service_interval_hours: 250, last_service_hours: "", last_service_date: "", note: "" },
  injector:  { name: "", serial_number: "", cumulative_meters: "", cumulative_hours: "", cycles_count: "", note: "" },
  lifting:   { name: "", serial_number: "", description: "", capacity: "", cert_expiry_date: "", last_inspection_date: "", note: "" },
  bop_pce:   { name: "", serial_number: "", test_type: "function+pressure", last_test_date: "", test_interval_months: 6, note: "" },
  reel_iron: { name: "", serial_number: "", item_type: "iron", working_pressure_psi: "", current_pressure_psi: "", note: "" },
};

const StatusPill = ({ status }) => {
  const s = STATUS_STYLE[status] || STATUS_STYLE.ok;
  const Icon = s.Icon;
  return (
    <span data-testid="equipment-status-pill" className={`text-[9px] font-bold uppercase px-1.5 py-[2px] rounded border flex items-center gap-1 ${s.pill}`}>
      <Icon className="w-3 h-3" strokeWidth={2.5} /> {s.label}
    </span>
  );
};

const KindFields = ({ kind, form, setForm }) => {
  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k, label, placeholder = "") => (
    <input
      data-testid={`equip-${kind}-${k}`}
      value={form[k] ?? ""}
      onChange={(e) => patch(k, e.target.value)}
      placeholder={label + (placeholder ? " " + placeholder : "")}
      inputMode="decimal"
      className="px-2 py-1.5 border border-[#CCC] rounded text-sm w-full"
    />
  );
  const txt = (k, label) => (
    <input
      data-testid={`equip-${kind}-${k}`}
      value={form[k] ?? ""}
      onChange={(e) => patch(k, e.target.value)}
      placeholder={label}
      className="px-2 py-1.5 border border-[#CCC] rounded text-sm w-full"
    />
  );
  const date = (k, label) => (
    <input
      data-testid={`equip-${kind}-${k}`}
      type="date"
      value={form[k] ?? ""}
      onChange={(e) => patch(k, e.target.value)}
      title={label}
      className="px-2 py-1.5 border border-[#CCC] rounded text-sm w-full"
    />
  );

  if (kind === "engine") return (
    <>
      {num("current_hours", "Current hours", "(h)")}
      {num("service_interval_hours", "Service interval", "(h)")}
      {num("last_service_hours", "Last service @ hrs")}
      {date("last_service_date", "Last service date")}
    </>
  );
  if (kind === "injector") return (
    <>
      {num("cumulative_meters", "Cumulative", "(m)")}
      {num("cumulative_hours", "Cumulative", "(h)")}
      {num("cycles_count", "Cycles count")}
    </>
  );
  if (kind === "lifting") return (
    <>
      {txt("description", "Description (sling / shackle / cert #)")}
      {txt("capacity", "Capacity (t / kN)")}
      {date("cert_expiry_date", "Certification expiry")}
      {date("last_inspection_date", "Last inspection")}
    </>
  );
  if (kind === "bop_pce") return (
    <>
      <select
        data-testid={`equip-${kind}-test_type`}
        value={form.test_type} onChange={(e) => patch("test_type", e.target.value)}
        className="px-2 py-1.5 border border-[#CCC] rounded text-sm"
      >
        <option value="function">Function</option>
        <option value="pressure">Pressure</option>
        <option value="function+pressure">Function + Pressure</option>
      </select>
      {date("last_test_date", "Last test date")}
      {num("test_interval_months", "Interval", "(mo)")}
    </>
  );
  if (kind === "reel_iron") return (
    <>
      <select
        data-testid={`equip-${kind}-item_type`}
        value={form.item_type} onChange={(e) => patch("item_type", e.target.value)}
        className="px-2 py-1.5 border border-[#CCC] rounded text-sm"
      >
        <option value="reel">Reel</option>
        <option value="iron">Treating Iron</option>
      </select>
      {num("working_pressure_psi", "MAWP", "(psi)")}
      {num("current_pressure_psi", "Current pressure", "(psi)")}
    </>
  );
  return null;
};

const ItemRow = ({ item, kind, onLog, onDelete, onPatch }) => {
  const [openLog, setOpenLog] = useState(false);
  const [openAtt, setOpenAtt] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [editDraft, setEditDraft] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [logForm, setLogForm] = useState({ hours: "", meters: "", pressure_psi: "", date: "", note: "" });

  const startEdit = () => {
    // Snapshot editable fields — includes base + kind-specific numerics
    setEditDraft({
      name: item.name || "",
      serial_number: item.serial_number || "",
      note: item.note || "",
      current_hours: item.current_hours ?? "",
      service_interval_hours: item.service_interval_hours ?? "",
      last_service_hours: item.last_service_hours ?? "",
      last_service_date: item.last_service_date || "",
      cumulative_meters: item.cumulative_meters ?? "",
      cumulative_hours: item.cumulative_hours ?? "",
      cycles_count: item.cycles_count ?? "",
      description: item.description || "",
      capacity: item.capacity || "",
      cert_expiry_date: item.cert_expiry_date || "",
      last_inspection_date: item.last_inspection_date || "",
      test_type: item.test_type || "",
      test_interval_months: item.test_interval_months ?? "",
      last_test_date: item.last_test_date || "",
      item_type: item.item_type || "",
      working_pressure_psi: item.working_pressure_psi ?? "",
      current_pressure_psi: item.current_pressure_psi ?? "",
    });
    setOpenEdit(true);
  };
  const saveEdit = async () => {
    setSavingEdit(true);
    try {
      const payload = {};
      for (const [k, v] of Object.entries(editDraft)) {
        if (v === "" || v === undefined) continue;
        if (["name", "serial_number", "note", "description", "capacity", "last_service_date", "cert_expiry_date", "last_inspection_date", "last_test_date", "test_type", "item_type"].includes(k)) {
          payload[k] = v;
        } else {
          const n = parseFloat(v);
          if (!isNaN(n)) payload[k] = n;
        }
      }
      await onPatch(item, payload);
      setOpenEdit(false);
    } finally { setSavingEdit(false); }
  };

  const bodyBits = (() => {
    if (kind === "engine") {
      const curr = item.current_hours;
      const last = item.last_service_hours || 0;
      const interval = item.service_interval_hours || 250;
      const dueAt = last + interval;
      const left = curr != null ? dueAt - curr : null;
      return (
        <>
          <span>{curr != null ? `${curr.toFixed(0)} h` : "no hours"}</span>
          <span className="text-[#8A8A8A]">·</span>
          <span>Service @ {dueAt.toFixed(0)} h {left != null && (left <= 0 ? `(overdue ${Math.abs(left).toFixed(0)} h)` : `(${left.toFixed(0)} h left)`)}</span>
          {item.last_service_date && <><span className="text-[#8A8A8A]">·</span><span>Last: {item.last_service_date}</span></>}
        </>
      );
    }
    if (kind === "injector") return (
      <>
        <span>{item.cumulative_meters != null ? `${item.cumulative_meters.toFixed(0)} m` : "0 m"}</span>
        <span className="text-[#8A8A8A]">·</span>
        <span>{item.cumulative_hours != null ? `${item.cumulative_hours.toFixed(1)} h` : "0 h"}</span>
        {item.cycles_count != null && <><span className="text-[#8A8A8A]">·</span><span>{item.cycles_count} cycles</span></>}
      </>
    );
    if (kind === "lifting") return (
      <>
        {item.capacity && <><span>{item.capacity}</span><span className="text-[#8A8A8A]">·</span></>}
        <span>Cert expires: {item.cert_expiry_date || "—"}</span>
        {item.last_inspection_date && <><span className="text-[#8A8A8A]">·</span><span>Last inspected: {item.last_inspection_date}</span></>}
      </>
    );
    if (kind === "bop_pce") return (
      <>
        <span className="uppercase text-[10px] font-bold">{item.test_type || "test"}</span>
        <span className="text-[#8A8A8A]">·</span>
        <span>Last: {item.last_test_date || "—"}</span>
        <span className="text-[#8A8A8A]">·</span>
        <span>Every {item.test_interval_months || 6} mo</span>
      </>
    );
    if (kind === "reel_iron") return (
      <>
        <span className="uppercase text-[10px] font-bold">{item.item_type || "iron"}</span>
        <span className="text-[#8A8A8A]">·</span>
        <span>MAWP {item.working_pressure_psi != null ? `${item.working_pressure_psi.toFixed(0)} psi` : "—"}</span>
        {item.current_pressure_psi != null && <><span className="text-[#8A8A8A]">·</span><span>Current: {item.current_pressure_psi.toFixed(0)} psi</span></>}
      </>
    );
    return null;
  })();

  return (
    <div data-testid={`equip-row-${item.item_id}`} className="p-2.5 border-b border-[#F0F0F0] hover:bg-[#FAFAFA]">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-[#262626]">{item.name}</span>
            {item.serial_number && <span className="text-[11px] text-[#595959]">S/N {item.serial_number}</span>}
            <StatusPill status={item.status} />
          </div>
          <div className="text-[11px] text-[#595959] mt-0.5 flex flex-wrap items-center gap-1.5">{bodyBits}</div>
          {item.reasons?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {item.reasons.map((r) => <span key={`${item.item_id}-${r}`} className="text-[10px] bg-[#FFF3CD] text-[#856404] px-1.5 py-[1px] rounded">{r}</span>)}
            </div>
          )}
          {item.note && <div className="text-[11px] text-[#444] mt-0.5 italic">{item.note}</div>}
        </div>
        <div className="flex flex-col gap-1">
          <button data-testid={`equip-edit-open-${item.item_id}`} onClick={startEdit} className="text-[10px] font-bold text-[#107C41] border border-[#107C41] hover:bg-[#F0F9F3] px-2 py-1 rounded flex items-center gap-1 tap-44"><Edit3 className="w-3 h-3" />Edit</button>
          <button data-testid={`equip-log-open-${item.item_id}`} onClick={() => setOpenLog((v) => !v)} className="text-[10px] font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-2 py-1 rounded flex items-center gap-1"><Edit3 className="w-3 h-3" />Log</button>
          <button data-testid={`equip-att-open-${item.item_id}`} onClick={() => setOpenAtt((v) => !v)} className="text-[10px] font-bold text-[#0D6535] border border-[#0D6535] hover:bg-[#F0F9F3] px-2 py-1 rounded flex items-center gap-1"><Paperclip className="w-3 h-3" />Files</button>
          <button data-testid={`equip-delete-${item.item_id}`} onClick={() => onDelete(item)} className="text-[#C00000] hover:bg-[#F8D7DA] rounded p-1 tap-44"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {openEdit && (
        <div className="mt-2 p-2 bg-[#FFF8E1] border-l-4 border-[#F59E0B] rounded space-y-1.5" data-testid={`equip-edit-form-${item.item_id}`}>
          <div className="text-[10px] uppercase font-bold text-[#856404]">Edit {item.name}</div>
          <input placeholder="Name" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className="w-full px-2 py-1.5 border border-[#CCC] rounded text-sm" data-testid={`equip-edit-name-${item.item_id}`} />
          <input placeholder="Serial number" value={editDraft.serial_number} onChange={(e) => setEditDraft({ ...editDraft, serial_number: e.target.value })} className="w-full px-2 py-1.5 border border-[#CCC] rounded text-sm" data-testid={`equip-edit-serial-${item.item_id}`} />
          <KindFields kind={kind} form={editDraft} setForm={setEditDraft} />
          <input placeholder="Note" value={editDraft.note} onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} className="w-full px-2 py-1.5 border border-[#CCC] rounded text-sm" data-testid={`equip-edit-note-${item.item_id}`} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpenEdit(false)} className="text-[11px] text-[#595959] px-2 py-1">Cancel</button>
            <button data-testid={`equip-edit-save-${item.item_id}`} onClick={saveEdit} disabled={savingEdit || !editDraft.name?.trim()} className="text-[11px] font-bold text-white bg-[#107C41] hover:bg-[#0D6535] px-3 py-1 rounded disabled:opacity-50 inline-flex items-center gap-1">
              {savingEdit ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
      {openAtt && (
        <div className="mt-2 p-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded" data-testid={`equip-att-panel-${item.item_id}`}>
          <div className="text-[10px] uppercase font-bold text-[#595959] mb-1.5">Cert docs, ticket photos, serial-plate pics</div>
          <AttachmentUploader context="equipment" contextRef={item.item_id} compact={false} />
        </div>
      )}
      {openLog && (
        <div className="mt-2 p-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded space-y-1.5" data-testid={`equip-log-form-${item.item_id}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {(kind === "engine" || kind === "injector") && (
              <input placeholder="Hours" inputMode="decimal" value={logForm.hours} onChange={(e) => setLogForm({ ...logForm, hours: e.target.value })} className="px-2 py-1 border border-[#CCC] rounded text-xs" />
            )}
            {kind === "injector" && (
              <input placeholder="Meters" inputMode="decimal" value={logForm.meters} onChange={(e) => setLogForm({ ...logForm, meters: e.target.value })} className="px-2 py-1 border border-[#CCC] rounded text-xs" />
            )}
            {kind === "reel_iron" && (
              <input placeholder="Pressure (psi)" inputMode="decimal" value={logForm.pressure_psi} onChange={(e) => setLogForm({ ...logForm, pressure_psi: e.target.value })} className="px-2 py-1 border border-[#CCC] rounded text-xs" />
            )}
            <input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} className="px-2 py-1 border border-[#CCC] rounded text-xs" />
            <input placeholder="Note" value={logForm.note} onChange={(e) => setLogForm({ ...logForm, note: e.target.value })} className="px-2 py-1 border border-[#CCC] rounded text-xs col-span-2 sm:col-span-1" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {kind === "engine" && (
              <>
                <button data-testid={`equip-log-hours-${item.item_id}`} onClick={() => onLog(item, "hours_update", logForm).then(() => { setLogForm({ hours: "", meters: "", pressure_psi: "", date: "", note: "" }); setOpenLog(false); })} className="text-[10px] font-bold text-white bg-[#0056B3] px-2 py-1 rounded">Update hours</button>
                <button data-testid={`equip-log-service-${item.item_id}`} onClick={() => onLog(item, "service", logForm).then(() => { setLogForm({ hours: "", meters: "", pressure_psi: "", date: "", note: "" }); setOpenLog(false); })} className="text-[10px] font-bold text-white bg-[#0D6535] px-2 py-1 rounded">Mark serviced</button>
              </>
            )}
            {kind === "injector" && (
              <button onClick={() => onLog(item, "meters_update", logForm).then(() => { setLogForm({ hours: "", meters: "", pressure_psi: "", date: "", note: "" }); setOpenLog(false); })} className="text-[10px] font-bold text-white bg-[#0D6535] px-2 py-1 rounded">Update meters/hours</button>
            )}
            {kind === "lifting" && (
              <button onClick={() => onLog(item, "inspection", logForm).then(() => { setLogForm({ hours: "", meters: "", pressure_psi: "", date: "", note: "" }); setOpenLog(false); })} className="text-[10px] font-bold text-white bg-[#0D6535] px-2 py-1 rounded">Log inspection</button>
            )}
            {kind === "bop_pce" && (
              <button onClick={() => onLog(item, "test", logForm).then(() => { setLogForm({ hours: "", meters: "", pressure_psi: "", date: "", note: "" }); setOpenLog(false); })} className="text-[10px] font-bold text-white bg-[#0D6535] px-2 py-1 rounded">Log test</button>
            )}
            {kind === "reel_iron" && (
              <button onClick={() => onLog(item, "pressure_update", logForm).then(() => { setLogForm({ hours: "", meters: "", pressure_psi: "", date: "", note: "" }); setOpenLog(false); })} className="text-[10px] font-bold text-white bg-[#0056B3] px-2 py-1 rounded">Update pressure</button>
            )}
            <button onClick={() => onLog(item, "note", logForm).then(() => { setLogForm({ hours: "", meters: "", pressure_psi: "", date: "", note: "" }); setOpenLog(false); })} className="text-[10px] font-semibold text-[#0D6535] px-2 py-1 rounded border border-[#0D6535]">Add note</button>
          </div>
        </div>
      )}
    </div>
  );
};

const EquipmentPage = () => {
  const navigate = useNavigate();
  const { rigId } = useRig();
  const [tab, setTab] = useState("engine");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm.engine);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const cfg = KIND_TABS.find((t) => t.id === tab);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await axios.get(`${API}/equipment`, { params: { rig_id: rigId, kind: tab }, withCredentials: true });
      setItems(data.items || []);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to load.");
    } finally { setLoading(false); }
  }, [rigId, tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setForm(emptyForm[tab]); setShowAdd(false); }, [tab]);

  const create = async () => {
    if (!form.name?.trim()) return;
    setSaving(true);
    try {
      const payload = { kind: tab, rig_id: rigId, ...form };
      for (const k of Object.keys(payload)) {
        if (payload[k] === "") delete payload[k];
        else if (["current_hours", "service_interval_hours", "last_service_hours", "cumulative_meters", "cumulative_hours", "cycles_count", "test_interval_months", "working_pressure_psi", "current_pressure_psi"].includes(k)) {
          const n = parseFloat(payload[k]); payload[k] = isNaN(n) ? undefined : n;
        }
      }
      await axios.post(`${API}/equipment`, payload, { withCredentials: true });
      setShowAdd(false); setForm(emptyForm[tab]);
      await load();
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to save.");
    } finally { setSaving(false); }
  };

  const logEvent = async (item, action, logForm) => {
    const payload = { action };
    if (logForm.hours) payload.hours = parseFloat(logForm.hours);
    if (logForm.meters) payload.meters = parseFloat(logForm.meters);
    if (logForm.pressure_psi) payload.pressure_psi = parseFloat(logForm.pressure_psi);
    if (logForm.date) payload.date = logForm.date;
    if (logForm.note) payload.note = logForm.note;
    await axios.post(`${API}/equipment/${item.item_id}/log`, payload, { withCredentials: true });
    await load();
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    await axios.delete(`${API}/equipment/${item.item_id}`, { withCredentials: true });
    await load();
  };

  const patchItem = async (item, payload) => {
    await axios.patch(`${API}/equipment/${item.item_id}`, payload, { withCredentials: true });
    await load();
  };

  const summary = useMemo(() => {
    const counts = { ok: 0, amber: 0, red: 0, expired: 0 };
    items.forEach((i) => { counts[i.status] = (counts[i.status] || 0) + 1; });
    return counts;
  }, [items]);

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col">
      <header className="bg-[#0D6535] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0">
        <button onClick={() => navigate("/hub")} data-testid="equipment-back" className="flex items-center gap-1.5 text-sm font-semibold"><ArrowLeft className="w-4 h-4" /> Back</button>
        <h1 className="text-sm font-semibold ml-4 flex items-center gap-2"><Wrench className="w-4 h-4" /> Equipment & Assets · {rigLabel(rigId)}</h1>
      </header>
      <RigSelector />

      <div className="flex-1 p-3 pb-10 overflow-auto">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white border border-[#D4D4D4] rounded p-2 text-center"><div className="text-[10px] text-[#595959] uppercase font-bold">OK</div><div className="text-lg font-bold text-[#155724]">{summary.ok}</div></div>
            <div className="bg-white border border-[#D4D4D4] rounded p-2 text-center"><div className="text-[10px] text-[#595959] uppercase font-bold">Amber</div><div className="text-lg font-bold text-[#856404]">{summary.amber}</div></div>
            <div className="bg-white border border-[#D4D4D4] rounded p-2 text-center"><div className="text-[10px] text-[#595959] uppercase font-bold">Red</div><div className="text-lg font-bold text-[#721C24]">{summary.red}</div></div>
            <div className="bg-white border border-[#D4D4D4] rounded p-2 text-center"><div className="text-[10px] text-[#595959] uppercase font-bold">Expired</div><div className="text-lg font-bold text-[#721C24]">{summary.expired}</div></div>
          </div>

          <div data-testid="equipment-kind-tabs" className="flex gap-1 bg-white border border-[#D4D4D4] rounded-t-lg overflow-x-auto p-1 snap-tabs">
            {KIND_TABS.map((t) => {
              const active = tab === t.id;
              const Icon = t.Icon;
              return (
                <button
                  key={t.id}
                  data-testid={`equipment-tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`flex-shrink-0 sm:flex-1 min-w-[88px] sm:min-w-0 flex items-center justify-center gap-1 px-2 py-2 rounded text-[11px] font-bold uppercase whitespace-nowrap tap-44 ${active ? "text-white" : "text-[#595959] hover:bg-[#F0F9F3]"}`}
                  style={active ? { background: t.accent } : {}}
                >
                  <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="bg-white border border-[#D4D4D4] rounded-b-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-[#E5E7EB] flex items-center justify-between" style={{ background: `${cfg.accent}10` }}>
              <div className="flex items-center gap-2">
                <cfg.Icon className="w-4 h-4" style={{ color: cfg.accent }} strokeWidth={2.5} />
                <span className="text-sm font-bold" style={{ color: cfg.accent }}>{cfg.label}</span>
                <span className="text-[10px] text-[#595959]">{items.length} on {rigLabel(rigId)}</span>
              </div>
              <button
                data-testid={`equipment-add-${tab}`}
                onClick={() => setShowAdd((v) => !v)}
                className="text-xs font-semibold flex items-center gap-1 px-2 py-1 rounded text-white"
                style={{ background: cfg.accent }}
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> Add
              </button>
            </div>

            {showAdd && (
              <div className="p-3 bg-[#F9FAFB] border-b border-[#E5E7EB] space-y-2" data-testid={`equipment-add-form-${tab}`}>
                <div className="grid grid-cols-2 gap-2">
                  <input data-testid={`equip-${tab}-name`} placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                  <input data-testid={`equip-${tab}-serial_number`} placeholder="Serial number" value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                  <KindFields kind={tab} form={form} setForm={setForm} />
                  <input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="col-span-2 px-2 py-1.5 border border-[#CCC] rounded text-sm" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowAdd(false)} className="text-xs text-[#595959] px-3 py-1.5">Cancel</button>
                  <button data-testid={`equipment-save-${tab}`} disabled={saving || !form.name?.trim()} onClick={create} className="text-xs font-bold text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ background: cfg.accent }}>
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                  </button>
                </div>
              </div>
            )}

            {error && <div className="p-2 text-[11px] bg-[#F8D7DA] text-[#721C24]">{error}</div>}
            {loading && <div className="p-6 text-center text-[12px] text-[#595959]"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading…</div>}
            {!loading && items.length === 0 && (
              <div className="p-8 text-center text-[12px] text-[#595959]">No {cfg.label.toLowerCase()} logged on {rigLabel(rigId)}. Tap Add to log the first unit.</div>
            )}
            {items.map((item) => (
              <ItemRow key={item.item_id} item={item} kind={tab} onLog={logEvent} onDelete={remove} onPatch={patchItem} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EquipmentPage;
