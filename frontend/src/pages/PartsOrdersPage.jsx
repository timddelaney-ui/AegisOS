import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher } from "../lib/roles";
import { Plus, Check, X, Package } from "lucide-react";

const STATUS_LABEL = {
  pending_supervisor: "Pending Supervisor Approval",
  approved: "Approved — Awaiting Procurement",
  ordered: "Ordered",
  received: "Received",
  rejected: "Rejected",
};

const STATUS_COLOR = {
  pending_supervisor: "bg-[#FFF3CD] text-[#856404]",
  approved: "bg-[#DBEAFE] text-[#1E40AF]",
  ordered: "bg-[#E0E7FF] text-[#4338CA]",
  received: "bg-[#DCFCE7] text-[#065F46]",
  rejected: "bg-[#F8D7DA] text-[#991B1B]",
};

export default function PartsOrdersPage() {
  const { user } = useAuth();
  const canApprove = isSupervisorOrHigher(user);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ part_number: "", description: "", quantity: 1, needed_by: "" });

  const refresh = async () => {
    try { const r = await axios.get(`${API}/parts-orders`, { withCredentials: true }); setOrders(r.data?.orders || []); } catch {}
  };
  useEffect(() => { refresh(); }, []);

  const submit = async () => {
    if (!form.description.trim()) return toast.error("Description required");
    try {
      await axios.post(`${API}/parts-orders`, {
        part_number: form.part_number || undefined,
        description: form.description,
        quantity: Math.max(1, Number(form.quantity) || 1),
        needed_by: form.needed_by || undefined,
      }, { withCredentials: true });
      setForm({ part_number: "", description: "", quantity: 1, needed_by: "" });
      toast.success("Order submitted");
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const approve = async (id) => {
    try { await axios.post(`${API}/parts-orders/${id}/approve`, {}, { withCredentials: true }); toast.success("Approved"); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const reject = async (id) => {
    const comment = window.prompt("Reject reason?") || "";
    try { await axios.post(`${API}/parts-orders/${id}/reject`, { comment }, { withCredentials: true }); toast.success("Rejected"); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const move = async (id, newStatus) => {
    try { await axios.post(`${API}/parts-orders/${id}/status`, { new_status: newStatus }, { withCredentials: true }); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const pending = orders.filter((o) => o.status === "pending_supervisor");

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="Parts Orders" subtitle={`${orders.length} total · ${pending.length} pending`} />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
          <h3 className="text-sm font-bold mb-2 flex items-center gap-1"><Plus className="w-4 h-4" />Submit new order</h3>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs">
            <input placeholder="Part #" value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} className="border rounded px-2 py-1" />
            <input data-testid="po-desc" placeholder="Description *" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="border rounded px-2 py-1 sm:col-span-2" />
            <input type="number" placeholder="Qty" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="border rounded px-2 py-1" />
            <input placeholder="Needed by YYYY-MM-DD" value={form.needed_by} onChange={(e) => setForm({ ...form, needed_by: e.target.value })} className="border rounded px-2 py-1" />
          </div>
          <button data-testid="po-submit" onClick={submit} className="mt-2 bg-[#107C41] text-white px-3 py-1 text-xs font-bold rounded">
            {canApprove ? "Submit (auto-approved)" : "Submit for Supervisor Approval"}
          </button>
        </div>

        <div className="space-y-1.5">
          {orders.length === 0 && <p className="text-sm text-[#595959] text-center py-8"><Package className="w-6 h-6 mx-auto mb-2 text-[#9CA3AF]" />No parts orders yet.</p>}
          {orders.map((o) => (
            <div key={o.po_id} data-testid={`po-row-${o.po_id}`} className="bg-white border border-[#D4D4D4] rounded-lg p-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_COLOR[o.status]}`}>{STATUS_LABEL[o.status] || o.status}</span>
                <p className="text-sm font-bold flex-1">{o.part_number ? `${o.part_number} · ` : ""}{o.description}</p>
                <span className="text-xs tabular-nums font-bold">x{o.quantity}</span>
              </div>
              <p className="text-[11px] text-[#595959] mt-0.5">
                By {o.created_by} · {o.created_at?.slice(0, 10)}
                {o.needed_by && ` · needed ${o.needed_by.slice(0, 10)}`}
              </p>
              {canApprove && o.status === "pending_supervisor" && (
                <div className="flex gap-2 mt-2">
                  <button data-testid={`po-approve-${o.po_id}`} onClick={() => approve(o.po_id)} className="bg-[#107C41] text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1"><Check className="w-3.5 h-3.5" />Approve</button>
                  <button data-testid={`po-reject-${o.po_id}`} onClick={() => reject(o.po_id)} className="bg-[#C00000] text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1"><X className="w-3.5 h-3.5" />Reject</button>
                </div>
              )}
              {canApprove && o.status === "approved" && (
                <button data-testid={`po-ordered-${o.po_id}`} onClick={() => move(o.po_id, "ordered")} className="mt-2 bg-[#0056B3] text-white text-xs font-bold px-2 py-1 rounded">Mark Ordered</button>
              )}
              {canApprove && o.status === "ordered" && (
                <button data-testid={`po-received-${o.po_id}`} onClick={() => move(o.po_id, "received")} className="mt-2 bg-[#065F46] text-white text-xs font-bold px-2 py-1 rounded">Mark Received</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
