import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "../context/AuthContext";
import { ArrowLeft, Loader2, Bug, Lightbulb, Palette, Calculator, HelpCircle, ShieldAlert } from "lucide-react";
import { fmtDateTime as fmtDT } from "../lib/timeFormat";

const CATEGORY_META = {
  bug: { label: "Bug", Icon: Bug, color: "text-[#C00000] bg-[#F8D7DA] border-[#F5C6CB]" },
  idea: { label: "Idea", Icon: Lightbulb, color: "text-[#856404] bg-[#FFF3CD] border-[#FFE69C]" },
  ux: { label: "UX", Icon: Palette, color: "text-[#5A67D8] bg-[#E0E7FF] border-[#C7D2FE]" },
  data_accuracy: { label: "Data", Icon: Calculator, color: "text-[#C44A08] bg-[#FFF1E6] border-[#B7E4C7]" },
  other: { label: "Other", Icon: HelpCircle, color: "text-[#595959] bg-[#F8F9FA] border-[#D4D4D4]" },
};

const STATUS_OPTIONS = ["new", "in_review", "in_progress", "done", "wontfix"];
const STATUS_COLOR = {
  new: "bg-[#FFF3CD] text-[#856404]",
  in_review: "bg-[#E0E7FF] text-[#5A67D8]",
  in_progress: "bg-[#CFE2FF] text-[#084298]",
  done: "bg-[#D1E7DD] text-[#0F5132]",
  wontfix: "bg-[#E2E3E5] text-[#41464B]",
};

const AdminFeedback = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [isAdmin, setIsAdmin] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: w } = await axios.get(`${API}/admin/whoami`, { withCredentials: true });
        setIsAdmin(w.is_admin);
        if (w.is_admin) {
          const { data } = await axios.get(`${API}/feedback`, { withCredentials: true });
          setItems(data);
        }
      } catch (e) { setIsAdmin(false); }
      setLoading(false);
    })();
  }, []);

  const updateItem = async (id, patch) => {
    const { data } = await axios.patch(`${API}/feedback/${id}`, patch, { withCredentials: true });
    setItems((prev) => prev.map((it) => (it.feedback_id === id ? data : it)));
  };

  const filtered = filter === "all" ? items : items.filter((it) => it.status === filter);

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col">
      <header className="bg-[#FF6B1A] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0">
        <button onClick={() => navigate("/app")} className="flex items-center gap-1.5 text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-sm font-semibold ml-4">User Feedback · Admin</h1>
      </header>
      <div className="flex-1 p-4 overflow-auto">
        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#FF6B1A]" /></div>
          ) : !isAdmin ? (
            <div className="bg-white border border-[#D4D4D4] rounded-lg p-6 text-center">
              <ShieldAlert className="w-10 h-10 text-[#C00000] mx-auto mb-2" strokeWidth={2} />
              <h2 className="text-base font-bold text-[#262626] mb-1">Admin access only</h2>
              <p className="text-sm text-[#595959]">Your account (<code>{user?.email}</code>) is not authorised to view feedback. Add your email to the ADMIN_EMAILS environment variable to gain access.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {["all", ...STATUS_OPTIONS].map((s) => (
                  <button key={s} onClick={() => setFilter(s)}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${filter === s ? "bg-[#FF6B1A] text-white border-[#FF6B1A]" : "bg-white text-[#444] border-[#D4D4D4] hover:border-[#FF6B1A]"}`}>
                    {s === "all" ? "All" : s.replace("_", " ")}
                    <span className={`ml-1 text-[10px] ${filter === s ? "text-white/80" : "text-[#595959]"}`}>
                      ({s === "all" ? items.length : items.filter((it) => it.status === s).length})
                    </span>
                  </button>
                ))}
              </div>
              {filtered.length === 0 ? (
                <div className="bg-white border border-[#D4D4D4] rounded-lg p-6 text-center text-sm text-[#595959]">No feedback yet.</div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((it) => {
                    const cat = CATEGORY_META[it.category] || CATEGORY_META.other;
                    const CatIcon = cat.Icon;
                    return (
                      <div key={it.feedback_id} className="bg-white border border-[#D4D4D4] rounded shadow-sm p-3">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-[2px] rounded border ${cat.color}`}>
                            <CatIcon className="w-3 h-3" strokeWidth={2.5} />{cat.label.toUpperCase()}
                          </span>
                          <select value={it.status} onChange={(e) => updateItem(it.feedback_id, { status: e.target.value })}
                            className={`text-[10px] font-bold px-2 py-[2px] rounded border-0 outline-none cursor-pointer ${STATUS_COLOR[it.status] || ""}`}>
                            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace("_", " ").toUpperCase()}</option>)}
                          </select>
                          <span className="text-[10px] text-[#595959] ml-auto">{fmtDT(it.created_at)}</span>
                        </div>
                        <h3 className="text-sm font-bold text-[#262626]">{it.subject}</h3>
                        <p className="text-[12px] text-[#333] mt-1 whitespace-pre-wrap">{it.message}</p>
                        <div className="text-[10px] text-[#595959] mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>from <strong>{it.user_name || "—"}</strong> ({it.user_email})</span>
                          {it.page && <span>page: <code>{it.page}</code></span>}
                        </div>
                        <textarea placeholder="Admin notes (only you see these)" defaultValue={it.admin_notes || ""}
                          onBlur={(e) => e.target.value !== (it.admin_notes || "") && updateItem(it.feedback_id, { admin_notes: e.target.value })}
                          className="w-full mt-2 bg-[#FAFAFA] border border-[#EFEFEF] rounded px-2 py-1 text-[11px] resize-none focus:outline-none focus:border-[#FF6B1A]" rows={2} />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminFeedback;
