import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher } from "../lib/roles";
import { Plus, Check, Trash2, ClipboardList } from "lucide-react";

export default function TasksPage() {
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [assignee, setAssignee] = useState("");
  const [filter, setFilter] = useState("open");

  const refresh = async () => {
    try {
      const [t, m] = await Promise.all([
        axios.get(`${API}/tasks`, { params: filter === "all" ? {} : { status: filter }, withCredentials: true }).then((r) => r.data?.tasks || []),
        axios.get(`${API}/rbac/members`, { withCredentials: true }).then((r) => r.data?.members || []).catch(() => []),
      ]);
      setTasks(t); setMembers(m);
    } catch {}
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filter]);

  const addTask = async () => {
    if (!canEdit) return;
    if (!title.trim()) return toast.error("Title required");
    try {
      await axios.post(`${API}/tasks`, { title, detail: detail || undefined, assignee_user_id: assignee || undefined }, { withCredentials: true });
      setTitle(""); setDetail(""); setAssignee(""); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const toggle = async (t) => {
    try {
      await axios.patch(`${API}/tasks/${t.task_id}`, { status: t.status === "done" ? "open" : "done" }, { withCredentials: true });
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const del = async (id) => {
    if (!canEdit) return;
    try { await axios.delete(`${API}/tasks/${id}`, { withCredentials: true }); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const open = tasks.filter((t) => t.status === "open").length;
  const memberName = (id) => members.find((m) => m.user_id === id)?.name || "unassigned";

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="Daily Tasks" subtitle={`${open} open task${open !== 1 ? "s" : ""}`} />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        {canEdit && (
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
            <h3 className="font-bold text-sm mb-2 flex items-center gap-1"><Plus className="w-4 h-4" /> Add Task (Supervisor)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <input data-testid="task-title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded px-2 py-1 sm:col-span-2" />
              <input placeholder="Detail (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} className="border rounded px-2 py-1" />
              <select data-testid="task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="border rounded px-2 py-1">
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>)}
              </select>
            </div>
            <button data-testid="task-add" onClick={addTask} className="mt-2 bg-[#FF6B1A] text-white px-3 py-1 text-xs font-bold rounded">Add</button>
          </div>
        )}

        <div className="flex gap-2 text-xs">
          {["open", "done", "all"].map((f) => (
            <button key={f} data-testid={`task-filter-${f}`} onClick={() => setFilter(f)} className={`px-2 py-1 rounded font-bold uppercase ${filter === f ? "bg-[#FF6B1A] text-white" : "bg-white border border-[#D4D4D4]"}`}>{f}</button>
          ))}
        </div>

        <div className="space-y-1.5">
          {tasks.length === 0 && <p className="text-sm text-[#595959] text-center py-8"><ClipboardList className="w-6 h-6 mx-auto mb-2 text-[#9CA3AF]" />No tasks yet.</p>}
          {tasks.map((t) => (
            <div key={t.task_id} data-testid={`task-row-${t.task_id}`} className={`border rounded-lg p-2 flex items-center gap-2 ${t.status === "done" ? "bg-[#F3F4F6]" : "bg-white"} border-[#D4D4D4]`}>
              <button data-testid={`task-toggle-${t.task_id}`} onClick={() => toggle(t)} className={`w-6 h-6 rounded-md border-2 flex items-center justify-center ${t.status === "done" ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#D4D4D4]"}`}>
                {t.status === "done" && <Check className="w-4 h-4" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold ${t.status === "done" ? "line-through text-[#9CA3AF]" : "text-[#262626]"}`}>{t.title}</p>
                {t.detail && <p className="text-[11px] text-[#595959]">{t.detail}</p>}
                <p className="text-[10px] text-[#595959]">Assigned: {memberName(t.assignee_user_id)}</p>
              </div>
              {canEdit && (
                <button data-testid={`task-delete-${t.task_id}`} onClick={() => del(t.task_id)} className="text-[#C00000] p-1 hover:bg-[#F8D7DA] rounded"><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
