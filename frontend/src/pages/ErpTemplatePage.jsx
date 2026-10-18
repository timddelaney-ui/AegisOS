import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Save, Printer, Trash2, Shield, AlertOctagon, Phone, MapPin,
  Hospital, Compass, Flame, FolderOpen, Plus, X,
} from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import ExcelHeader from "../components/ExcelHeader";

const EMPTY = {
  well_name: "", rig_id: "", scenario_id: "", lsd_uwi: "", operation: "", date: new Date().toISOString().slice(0, 10),
  supervisor_name: "", supervisor_phone: "",
  company_man_name: "", company_man_phone: "",
  hse_advisor: "",
  muster_point: "", windsock_location: "",
  primary_escape_route: "", secondary_escape_route: "",
  nearest_hospital_name: "", nearest_hospital_phone: "", nearest_hospital_distance_km: "",
  air_ambulance_phone: "STARS: 1-888-888-4567",
  h2s_zone: false, h2s_concentration_ppm: "",
  kill_fluid_location: "", bop_rating_mpa: "",
  aer_hotline: "1-800-222-6514", ems_phone: "911",
  additional_contacts: [],
  notes: "",
};

const Field = ({ label, children, span = 1, hint, required }) => (
  <label className={`flex flex-col ${span === 2 ? "sm:col-span-2" : ""}`}>
    <span className="text-[11px] font-semibold text-[#333] mb-0.5 flex items-center gap-0.5">
      {label} {required && <span className="text-[#C00000]">*</span>}
    </span>
    {children}
    {hint && <span className="text-[10px] text-[#777] mt-0.5">{hint}</span>}
  </label>
);

const Input = (props) => (
  <input
    {...props}
    className={`px-2.5 py-1.5 border border-[#CCC] rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B1A]/40 focus:border-[#FF6B1A] bg-white ${props.className || ""}`}
  />
);

const Section = ({ title, Icon, color, children }) => (
  <div className="bg-white border border-[#D4D4D4] rounded-xl p-3.5 shadow-sm print:shadow-none print:border-[#999] print:break-inside-avoid">
    <div className="flex items-center gap-2 mb-2.5">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center ${color}`}>
        <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
      </div>
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#262626]">{title}</h3>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{children}</div>
  </div>
);

const ErpTemplatePage = () => {
  const navigate = useNavigate();
  const { templateId } = useParams();
  const { user } = useAuth();

  const [vals, setVals] = useState(EMPTY);
  const [existingId, setExistingId] = useState(templateId || null);
  const [saving, setSaving] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [list, setList] = useState([]);
  const [scenarios, setScenarios] = useState([]);

  const set = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setVals((prev) => ({ ...prev, [k]: v }));
  };

  // Load existing template
  useEffect(() => {
    if (!existingId) return;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/erp-templates/${existingId}`, { withCredentials: true });
        setVals({ ...EMPTY, ...data, additional_contacts: data.additional_contacts || [] });
      } catch { toast.error("Template not found"); }
    })();
  }, [existingId]);

  // Load CTD scenarios so user can link one
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/ctd-scenarios`, { withCredentials: true });
        setScenarios(data || []);
      } catch { setScenarios([]); }
    })();
  }, []);

  const openList = async () => {
    setListOpen(true);
    try {
      const { data } = await axios.get(`${API}/erp-templates`, { withCredentials: true });
      setList(data || []);
    } catch { setList([]); }
  };

  const save = async () => {
    if (!vals.well_name.trim()) { toast.error("Well name required"); return; }
    setSaving(true);
    const payload = {
      ...vals,
      h2s_concentration_ppm: vals.h2s_concentration_ppm ? parseFloat(vals.h2s_concentration_ppm) : null,
      nearest_hospital_distance_km: vals.nearest_hospital_distance_km ? parseFloat(vals.nearest_hospital_distance_km) : null,
      bop_rating_mpa: vals.bop_rating_mpa ? parseFloat(vals.bop_rating_mpa) : null,
      scenario_id: vals.scenario_id || null,
    };
    try {
      if (existingId) {
        await axios.patch(`${API}/erp-templates/${existingId}`, payload, { withCredentials: true });
        toast.success("Saved");
      } else {
        const { data } = await axios.post(`${API}/erp-templates`, payload, { withCredentials: true });
        setExistingId(data.template_id);
        navigate(`/erp-template/${data.template_id}`, { replace: true });
        toast.success("Created");
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!existingId) return;
    if (!window.confirm("Delete this ERP template?")) return;
    try {
      await axios.delete(`${API}/erp-templates/${existingId}`, { withCredentials: true });
      toast.success("Deleted");
      navigate("/erp-template", { replace: true });
      setExistingId(null);
      setVals(EMPTY);
    } catch { toast.error("Delete failed"); }
  };

  const addContact = () =>
    setVals((v) => ({ ...v, additional_contacts: [...(v.additional_contacts || []), { role: "", name: "", phone: "" }] }));
  const updateContact = (i, k, val) =>
    setVals((v) => ({
      ...v,
      additional_contacts: (v.additional_contacts || []).map((c, idx) => idx === i ? { ...c, [k]: val } : c),
    }));
  const removeContact = (i) =>
    setVals((v) => ({ ...v, additional_contacts: (v.additional_contacts || []).filter((_, idx) => idx !== i) }));

  const linkedScenario = scenarios.find((s) => s.scenario_id === vals.scenario_id);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F3F3F3] to-[#E8ECEF] flex flex-col print:bg-white">
      <div className="print:hidden">
        <ExcelHeader />
      </div>

      <div className="bg-white border-b border-[#D4D4D4] px-3 py-2 flex items-center gap-2 sticky top-0 z-10 print:hidden">
        <button
          data-testid="erp-back-btn"
          onClick={() => navigate("/hub")}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#595959] hover:text-[#FF6B1A]"
        >
          <ArrowLeft className="w-4 h-4" /> Hub
        </button>
        <div className="w-px h-5 bg-[#D4D4D4]" />
        <h1 className="text-[13px] sm:text-sm font-bold text-[#262626] flex-1 truncate">
          Site-Specific ERP Template
        </h1>
        <button
          data-testid="erp-list-btn"
          onClick={openList}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#D4D4D4] bg-white hover:border-[#FF6B1A] text-[11px] font-semibold"
        >
          <FolderOpen className="w-3.5 h-3.5" /> Open
        </button>
        <button
          data-testid="erp-save-btn"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#FF6B1A] text-white text-[11px] font-bold hover:bg-[#C44A08] disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" strokeWidth={2.6} />
          {saving ? "…" : "Save"}
        </button>
        <button
          data-testid="erp-print-btn"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#D4D4D4] bg-white hover:border-[#FF6B1A] text-[11px] font-semibold"
        >
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
        {existingId && (
          <button
            data-testid="erp-delete-btn"
            onClick={del}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#D4D4D4] bg-white hover:border-[#C00000] hover:text-[#C00000] text-[11px] font-semibold"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-10 print:overflow-visible">
        <div className="max-w-4xl mx-auto p-3 space-y-3 print:p-6 print:space-y-2" data-testid="erp-template-sheet">          {/* Printable header strip */}
          <div className="bg-gradient-to-r from-[#8B0000] to-[#C00000] text-white rounded-xl p-3 shadow-sm print:rounded-none print:shadow-none">
            <div className="flex items-center gap-3">
              <AlertOctagon className="w-7 h-7 flex-shrink-0" strokeWidth={2.4} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">SITE-SPECIFIC EMERGENCY RESPONSE PLAN</p>
                <p className="text-base sm:text-lg font-bold truncate">{vals.well_name || "<Well Name>"}</p>
                <p className="text-[11px] opacity-90 truncate">
                  {vals.operation || "Operation"} · Rig {vals.rig_id || "—"} · {vals.date || "—"}
                  {vals.lsd_uwi ? ` · LSD/UWI ${vals.lsd_uwi}` : ""}
                </p>
              </div>
            </div>
          </div>

          <Section title="Well & operation" Icon={MapPin} color="bg-[#DBEAFE] text-[#0056B3]">
            <Field label="Well name" required>
              <Input data-testid="erp-well-name" value={vals.well_name} onChange={set("well_name")} placeholder="e.g. 4-32-45-06W5" />
            </Field>
            <Field label="LSD / UWI">
              <Input data-testid="erp-lsd" value={vals.lsd_uwi} onChange={set("lsd_uwi")} placeholder="100/04-32-045-06W5/00" />
            </Field>
            <Field label="Operation">
              <Input data-testid="erp-op" value={vals.operation} onChange={set("operation")} placeholder="UBD Drill-Out · Fishing · Nitrogen Kick-Off" />
            </Field>
            <Field label="Rig ID">
              <Input data-testid="erp-rig" value={vals.rig_id} onChange={set("rig_id")} placeholder="Rig 7" />
            </Field>
            <Field label="Date">
              <Input data-testid="erp-date" type="date" value={vals.date} onChange={set("date")} />
            </Field>
            <Field label="Linked scenario (optional)" hint="Pulls numeric inputs from a saved CT Drilling scenario">
              <select
                data-testid="erp-scenario"
                value={vals.scenario_id || ""}
                onChange={set("scenario_id")}
                className="px-2.5 py-1.5 border border-[#CCC] rounded text-sm bg-white"
              >
                <option value="">— None —</option>
                {scenarios.map((s) => <option key={s.scenario_id} value={s.scenario_id}>{s.well_name}</option>)}
              </select>
            </Field>
          </Section>

          <Section title="Key personnel" Icon={Shield} color="bg-[#FFF1E6] text-[#C44A08]">
            <Field label="Supervisor / Tool push"><Input data-testid="erp-sup-name" value={vals.supervisor_name} onChange={set("supervisor_name")} /></Field>
            <Field label="Supervisor phone"><Input data-testid="erp-sup-phone" value={vals.supervisor_phone} onChange={set("supervisor_phone")} /></Field>
            <Field label="Licensee company man"><Input data-testid="erp-cm-name" value={vals.company_man_name} onChange={set("company_man_name")} /></Field>
            <Field label="Company man phone"><Input data-testid="erp-cm-phone" value={vals.company_man_phone} onChange={set("company_man_phone")} /></Field>
            <Field label="HSE Advisor" span={2}><Input data-testid="erp-hse" value={vals.hse_advisor} onChange={set("hse_advisor")} placeholder="Name · Phone" /></Field>
          </Section>

          <Section title="Muster, wind & escape" Icon={Compass} color="bg-[#FCE7C0] text-[#C36600]">
            <Field label="Primary muster point" required span={2}>
              <Input data-testid="erp-muster" value={vals.muster_point} onChange={set("muster_point")} placeholder="e.g. 100 m upwind of rig at access road sign" />
            </Field>
            <Field label="Wind sock location">
              <Input data-testid="erp-windsock" value={vals.windsock_location} onChange={set("windsock_location")} placeholder="NE corner of lease, 8 m pole" />
            </Field>
            <Field label="Primary escape route">
              <Input data-testid="erp-escape1" value={vals.primary_escape_route} onChange={set("primary_escape_route")} placeholder="Lease road NW to Hwy 22" />
            </Field>
            <Field label="Secondary escape route" span={2}>
              <Input data-testid="erp-escape2" value={vals.secondary_escape_route} onChange={set("secondary_escape_route")} placeholder="Pipeline right-of-way heading south" />
            </Field>
          </Section>

          <Section title="Medical" Icon={Hospital} color="bg-[#FDE8E8] text-[#C00000]">
            <Field label="Nearest hospital"><Input data-testid="erp-hosp-name" value={vals.nearest_hospital_name} onChange={set("nearest_hospital_name")} placeholder="Rocky Mountain House Health Centre" /></Field>
            <Field label="Hospital phone"><Input data-testid="erp-hosp-phone" value={vals.nearest_hospital_phone} onChange={set("nearest_hospital_phone")} placeholder="403-845-3347" /></Field>
            <Field label="Distance (km)"><Input data-testid="erp-hosp-dist" type="number" step="any" value={vals.nearest_hospital_distance_km} onChange={set("nearest_hospital_distance_km")} /></Field>
            <Field label="Air ambulance / STARS"><Input data-testid="erp-stars" value={vals.air_ambulance_phone} onChange={set("air_ambulance_phone")} /></Field>
            <Field label="EMS"><Input data-testid="erp-ems" value={vals.ems_phone} onChange={set("ems_phone")} /></Field>
            <Field label="AER 24-hr hotline"><Input data-testid="erp-aer" value={vals.aer_hotline} onChange={set("aer_hotline")} /></Field>
          </Section>

          <Section title="Well-control & H2S" Icon={Flame} color="bg-[#F8D7DA] text-[#721C24]">
            <Field label="H2S zone?" span={2}>
              <div className="flex items-center gap-4 mt-1">
                <label className="flex items-center gap-1.5 text-[12px]">
                  <input
                    data-testid="erp-h2s-yes"
                    type="radio" checked={vals.h2s_zone === true}
                    onChange={() => setVals((v) => ({ ...v, h2s_zone: true }))}
                  /> Yes
                </label>
                <label className="flex items-center gap-1.5 text-[12px]">
                  <input
                    data-testid="erp-h2s-no"
                    type="radio" checked={vals.h2s_zone === false}
                    onChange={() => setVals((v) => ({ ...v, h2s_zone: false }))}
                  /> No
                </label>
              </div>
            </Field>
            {vals.h2s_zone && (
              <Field label="Expected H2S concentration (ppm)">
                <Input data-testid="erp-h2s-ppm" type="number" step="any" value={vals.h2s_concentration_ppm} onChange={set("h2s_concentration_ppm")} />
              </Field>
            )}
            <Field label="Kill-fluid location"><Input data-testid="erp-kill" value={vals.kill_fluid_location} onChange={set("kill_fluid_location")} placeholder="500 bbl tank, east of pump — 1050 kg/m³ brine" /></Field>
            <Field label="BOP pressure rating (MPa)"><Input data-testid="erp-bop" type="number" step="any" value={vals.bop_rating_mpa} onChange={set("bop_rating_mpa")} /></Field>
          </Section>

          <Section title="Additional contacts" Icon={Phone} color="bg-[#E0E7FF] text-[#5A67D8]">
            <div className="sm:col-span-2 space-y-1.5">
              {(vals.additional_contacts || []).map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_24px] gap-1.5 items-center" data-testid={`erp-contact-${i}`}>
                  <Input placeholder="Role" value={c.role} onChange={(e) => updateContact(i, "role", e.target.value)} />
                  <Input placeholder="Name" value={c.name} onChange={(e) => updateContact(i, "name", e.target.value)} />
                  <Input placeholder="Phone" value={c.phone} onChange={(e) => updateContact(i, "phone", e.target.value)} />
                  <button onClick={() => removeContact(i)} className="text-[#C4C4C4] hover:text-[#C00000]"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button
                data-testid="erp-add-contact"
                onClick={addContact}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#FF6B1A] hover:text-[#C44A08]"
              >
                <Plus className="w-3 h-3" /> Add contact
              </button>
            </div>
          </Section>

          <div className="bg-white border border-[#D4D4D4] rounded-xl p-3.5 shadow-sm print:shadow-none print:break-inside-avoid">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#262626] mb-2">Notes / scenario detail</h3>
            {linkedScenario && (
              <div className="bg-[#FFF7EF] border border-[#C7E8D4] rounded px-2 py-1.5 mb-2">
                <p className="text-[11px] text-[#C44A08]">
                  <strong>Linked scenario:</strong> {linkedScenario.well_name} ·
                  mode: {linkedScenario.mode}
                </p>
              </div>
            )}
            <textarea
              data-testid="erp-notes"
              value={vals.notes}
              onChange={set("notes")}
              rows={4}
              placeholder="Scenario-specific notes — kick triggers, special hazards, contingency plans…"
              className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm resize-y"
            />
          </div>

          <div className="bg-white border border-[#D4D4D4] rounded-xl p-3 shadow-sm print:shadow-none">
            <p className="text-[10px] text-[#595959] leading-snug">
              Signed by Supervisor: ___________________________ &nbsp;&nbsp;
              Date: _____________ &nbsp;&nbsp; Reviewed by HSE: _______________
            </p>
            <p className="text-[10px] text-[#777] italic mt-2">
              Advisory only · this cover sheet does not replace the licensee's full site-specific ERP, AER Dir 071 ERP Plan, or company evacuation procedures.
            </p>
          </div>
        </div>
      </div>

      {/* Open list drawer */}
      {listOpen && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-end sm:items-center justify-center p-3" onClick={() => setListOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="erp-list-dialog">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-sm font-bold text-[#262626]">Saved ERP templates</h3>
              <button onClick={() => setListOpen(false)}><X className="w-4 h-4 text-[#595959]" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {list.length === 0 ? (
                <p className="text-[12px] text-[#595959] p-4 text-center">No templates saved yet.</p>
              ) : (
                <div className="space-y-2">
                  {list.map((t) => (
                    <button
                      key={t.template_id}
                      data-testid={`erp-list-row-${t.template_id}`}
                      onClick={() => { setListOpen(false); setExistingId(t.template_id); navigate(`/erp-template/${t.template_id}`); }}
                      className="w-full text-left p-3 rounded-lg border border-[#D4D4D4] hover:border-[#FF6B1A] hover:bg-[#FFF7EF]"
                    >
                      <p className="text-sm font-bold text-[#262626] truncate">{t.well_name}</p>
                      <p className="text-[11px] text-[#595959] truncate">
                        {t.operation || "—"} · Rig {t.rig_id || "—"} · {t.date || new Date(t.updated_at).toLocaleDateString()}
                      </p>
                      <p className="text-[10px] text-[#777]">by {t.created_by_name}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body { background: white !important; margin: 0; }
          .print\\:hidden { display: none !important; }
          .print\\:bg-white { background: white !important; }
          .shadow-sm, .shadow-md, .shadow-xl { box-shadow: none !important; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>
    </div>
  );
};

export default ErpTemplatePage;
