import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Users, Mail, Plus, Trash2, Pencil, X, Star, StarOff, Check,
} from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import ExcelHeader from "../components/ExcelHeader";

const ROLES = [
  "Day-shift Supervisor", "Night-shift Supervisor", "Tool Push", "Company Man",
  "HSE Advisor", "Office Dispatcher", "Operations Manager", "Crew Member", "Other",
];

const CrewContactsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", role: "", is_default_recipient: true });
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/crew/contacts`, { withCredentials: true });
      setContacts(data.contacts || []);
    } catch { setContacts([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", email: "", role: "", is_default_recipient: true });
    setOpen(true);
  };
  const openEdit = (c) => {
    setEditing(c);
    setForm({ name: c.name, email: c.email, role: c.role || "", is_default_recipient: !!c.is_default_recipient });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Name and email required"); return;
    }
    setBusy(true);
    try {
      if (editing) {
        await axios.patch(`${API}/crew/contacts/${editing.contact_id}`, form, { withCredentials: true });
        toast.success("Saved");
      } else {
        await axios.post(`${API}/crew/contacts`, form, { withCredentials: true });
        toast.success("Contact added");
      }
      setOpen(false);
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  const toggleDefault = async (c) => {
    try {
      await axios.patch(`${API}/crew/contacts/${c.contact_id}`,
        { is_default_recipient: !c.is_default_recipient }, { withCredentials: true });
      refresh();
    } catch { toast.error("Update failed"); }
  };

  const del = async (c) => {
    if (!window.confirm(`Remove ${c.name} from the crew address book?`)) return;
    try {
      await axios.delete(`${API}/crew/contacts/${c.contact_id}`, { withCredentials: true });
      toast.success("Removed");
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };

  const hasTeam = !!user?.team_id;
  const defaultCount = contacts.filter((c) => c.is_default_recipient).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F3F3F3] to-[#E8ECEF] flex flex-col">
      <ExcelHeader />

      <div className="bg-white border-b border-[#D4D4D4] px-3 py-2 flex items-center gap-2 sticky top-0 z-10">
        <button
          data-testid="cc-back-btn"
          onClick={() => navigate("/hub")}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#595959] hover:text-[#107C41]"
        >
          <ArrowLeft className="w-4 h-4" /> Hub
        </button>
        <div className="w-px h-5 bg-[#D4D4D4]" />
        <h1 className="text-[13px] sm:text-sm font-bold text-[#262626] flex-1 truncate">
          Crew Email Contacts <span className="hidden sm:inline text-[#595959] font-normal">— Shift-End Recipients</span>
        </h1>
        {hasTeam && (
          <button
            data-testid="cc-add-btn"
            onClick={openCreate}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#107C41] text-white text-[11px] font-bold hover:bg-[#0D6535]"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.6} /> <span className="hidden sm:inline">Add contact</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-10">
        <div className="max-w-3xl mx-auto p-3 space-y-3">
          {!hasTeam && (
            <div className="bg-[#FFF4D6] border border-[#FFE69C] rounded-xl p-3">
              <p className="text-[12px] text-[#7A5900]">Join or create a crew — the address book is team-scoped.</p>
            </div>
          )}

          <div className="bg-[#DBEAFE] border border-[#BFDBFE] rounded-xl p-3">
            <p className="text-[12px] text-[#0C4A6E] leading-snug">
              <strong>These contacts receive shift-end handover emails.</strong> Mark everyone who <em>always</em> gets the digest as a <strong>default recipient</strong> ({defaultCount} currently default). Supervisors can still add one-off addresses per send. Emails show the supervisor's name in the From line and Reply-To goes to the supervisor's account.
            </p>
          </div>

          {loading ? (
            <p className="text-[12px] text-[#595959] py-6 text-center">Loading…</p>
          ) : contacts.length === 0 ? (
            <div className="bg-white border border-dashed border-[#D4D4D4] rounded-xl p-8 text-center">
              <Users className="w-10 h-10 text-[#C4C4C4] mx-auto mb-2" />
              <p className="text-[13px] text-[#262626] font-semibold">No crew contacts yet</p>
              <p className="text-[11px] text-[#595959] mt-1">
                Add the day-shift supervisor, night-shift supervisor, office dispatcher, HSE advisor, and anyone else who needs the shift report.
              </p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="cc-list">
              {contacts.map((c) => (
                <div
                  key={c.contact_id}
                  data-testid={`cc-row-${c.contact_id}`}
                  className="bg-white border border-[#D4D4D4] rounded-xl p-3 flex items-center gap-3 shadow-sm"
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${c.is_default_recipient ? "bg-[#107C41] text-white" : "bg-[#F0F0F0] text-[#595959]"}`}>
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[13px] font-bold text-[#262626] truncate">{c.name}</p>
                      {c.is_default_recipient && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-[#E6F4EA] text-[#0D6535] px-1.5 py-[1px] rounded-full">
                          <Check className="w-2.5 h-2.5" /> DEFAULT
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#595959] truncate">
                      <Mail className="inline w-3 h-3 mr-1" />{c.email}
                      {c.role && <> · {c.role}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      data-testid={`cc-toggle-${c.contact_id}`}
                      onClick={() => toggleDefault(c)}
                      className="p-1.5 rounded text-[#595959] hover:text-[#107C41] hover:bg-[#F0F9F3]"
                      title={c.is_default_recipient ? "Unset default" : "Set as default recipient"}
                    >
                      {c.is_default_recipient ? <Star className="w-3.5 h-3.5 text-[#107C41] fill-[#107C41]" /> : <StarOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      data-testid={`cc-edit-${c.contact_id}`}
                      onClick={() => openEdit(c)}
                      className="p-1.5 rounded text-[#595959] hover:text-[#107C41] hover:bg-[#F0F9F3]"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      data-testid={`cc-delete-${c.contact_id}`}
                      onClick={() => del(c)}
                      className="p-1.5 rounded text-[#595959] hover:text-[#C00000] hover:bg-[#FEE2E2]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-end sm:items-center justify-center p-3" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-md p-4 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="cc-dialog">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#262626]">{editing ? "Edit contact" : "Add crew contact"}</h3>
              <button onClick={() => setOpen(false)}><X className="w-4 h-4 text-[#595959]" /></button>
            </div>
            <div className="space-y-2.5">
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Name *</span>
                <input
                  data-testid="cc-form-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. John Smith"
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#107C41]/40"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Email *</span>
                <input
                  data-testid="cc-form-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="john@yourcompany.com"
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Role</span>
                <select
                  data-testid="cc-form-role"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm bg-white"
                >
                  <option value="">—</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 cursor-pointer" data-testid="cc-form-default-wrap">
                <input
                  data-testid="cc-form-default"
                  type="checkbox"
                  checked={form.is_default_recipient}
                  onChange={(e) => setForm((f) => ({ ...f, is_default_recipient: e.target.checked }))}
                  className="w-4 h-4 accent-[#107C41]"
                />
                <span className="text-[12px] text-[#262626]">
                  <strong>Default recipient</strong> — receives every shift-end handover automatically.
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-[12px] font-semibold text-[#595959] hover:text-[#262626]">Cancel</button>
              <button
                data-testid="cc-form-save"
                onClick={save}
                disabled={busy || !form.name.trim() || !form.email.trim()}
                className="px-3 py-1.5 bg-[#107C41] hover:bg-[#0D6535] text-white rounded text-[12px] font-bold disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CrewContactsPage;
