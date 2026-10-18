import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, FileText, Upload, Trash2, FolderOpen, Tag, FileCheck2, Wrench,
  CalendarCheck, BookOpen, Shield, Search, Pencil, X, File as FileIcon,
} from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import ExcelHeader from "../components/ExcelHeader";

const CATEGORIES = [
  { id: "sop", label: "SOPs", Icon: Shield, tint: "bg-[#DBEAFE] text-[#0056B3]" },
  { id: "maintenance", label: "Maintenance Checklists", Icon: Wrench, tint: "bg-[#FCE7C0] text-[#C36600]" },
  { id: "daily_checklist", label: "Daily Checklists", Icon: CalendarCheck, tint: "bg-[#FFF1E6] text-[#C44A08]" },
  { id: "pre_job_checklist", label: "Pre-Job Checklists", Icon: FileCheck2, tint: "bg-[#FDE8E8] text-[#C00000]" },
  { id: "reference", label: "Reference / Manuals", Icon: BookOpen, tint: "bg-[#E0E7FF] text-[#5A67D8]" },
  { id: "regulation", label: "Regulations", Icon: FileText, tint: "bg-[#F3E5F5] text-[#6A1B9A]" },
  { id: "other", label: "Other", Icon: FolderOpen, tint: "bg-[#F0F0F0] text-[#595959]" },
];

const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

const prettySize = (b) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b/1024).toFixed(0)} KB` : `${(b/1024/1024).toFixed(1)} MB`);

const DocumentsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileRef = useRef(null);

  const [docs, setDocs] = useState([]);
  const [byCat, setByCat] = useState({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [upFile, setUpFile] = useState(null);
  const [upName, setUpName] = useState("");
  const [upCategory, setUpCategory] = useState("sop");
  const [upDescription, setUpDescription] = useState("");
  const [upTags, setUpTags] = useState("");

  const [editDoc, setEditDoc] = useState(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("sop");
  const [editDescription, setEditDescription] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/documents`, { withCredentials: true });
      setDocs(data.documents || []);
      setByCat(data.by_category || {});
    } catch { setDocs([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!upName) setUpName(f.name.replace(/\.[^/.]+$/, ""));
    setUpFile(f);
  };

  const doUpload = async () => {
    if (!upFile) { toast.error("Pick a file first"); return; }
    if (!upName.trim()) { toast.error("Document name required"); return; }
    const form = new FormData();
    form.append("file", upFile);
    form.append("name", upName.trim());
    form.append("category", upCategory);
    if (upDescription.trim()) form.append("description", upDescription.trim());
    if (upTags.trim()) form.append("tags", upTags.trim());
    setUploading(true);
    try {
      await axios.post(`${API}/documents`, form, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Uploaded · ${upName.trim()}`);
      setUploadOpen(false);
      setUpFile(null); setUpName(""); setUpCategory("sop"); setUpDescription(""); setUpTags("");
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally { setUploading(false); }
  };

  const openEdit = (d) => {
    setEditDoc(d);
    setEditName(d.name);
    setEditCategory(d.category);
    setEditDescription(d.description || "");
  };
  const saveEdit = async () => {
    if (!editDoc) return;
    try {
      await axios.patch(`${API}/documents/${editDoc.doc_id}`, {
        name: editName.trim(),
        category: editCategory,
        description: editDescription.trim() || null,
      }, { withCredentials: true });
      toast.success("Saved");
      setEditDoc(null);
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const del = async (d) => {
    if (!window.confirm(`Delete "${d.name}"?`)) return;
    try {
      await axios.delete(`${API}/documents/${d.doc_id}`, { withCredentials: true });
      toast.success("Deleted");
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };

  const openDoc = async (d) => {
    // Fetch as blob so Authorization cookies apply, then open in new tab
    try {
      const resp = await axios.get(`${API}/documents/${d.doc_id}/download`, {
        withCredentials: true, responseType: "blob",
      });
      const blobUrl = URL.createObjectURL(resp.data);
      window.open(blobUrl, "_blank");
      // Browser retains it; release after a bit
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch { toast.error("Open failed"); }
  };

  const filtered = docs
    .filter((d) => filter === "all" || d.category === filter)
    .filter((d) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return d.name.toLowerCase().includes(q)
        || (d.description || "").toLowerCase().includes(q)
        || (d.tags || []).some((t) => t.toLowerCase().includes(q));
    });

  const hasTeam = !!user?.team_id;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F3F3F3] to-[#E8ECEF] flex flex-col">
      <ExcelHeader />

      <div className="bg-white border-b border-[#D4D4D4] px-3 py-2 flex items-center gap-2 sticky top-0 z-10">
        <button
          data-testid="docs-back-btn"
          onClick={() => navigate("/hub")}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#595959] hover:text-[#FF6B1A]"
        >
          <ArrowLeft className="w-4 h-4" /> Hub
        </button>
        <div className="w-px h-5 bg-[#D4D4D4]" />
        <h1 className="text-[13px] sm:text-sm font-bold text-[#262626] flex-1 truncate">
          Company Document Library
          <span className="hidden sm:inline text-[#595959] font-normal"> — SOPs · Checklists · References</span>
        </h1>
        {hasTeam && (
          <button
            data-testid="docs-upload-btn"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#FF6B1A] text-white text-[11px] font-bold hover:bg-[#C44A08]"
          >
            <Upload className="w-3.5 h-3.5" strokeWidth={2.6} />
            <span className="hidden sm:inline">Upload</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-10">
        <div className="max-w-4xl mx-auto p-3 space-y-3">

          {!hasTeam && (
            <div className="bg-[#FFF4D6] border border-[#FFE69C] rounded-xl p-3">
              <p className="text-[12px] text-[#7A5900]">
                Join or create a crew first — documents are shared within your team only.
              </p>
            </div>
          )}

          {/* Context explainer */}
          <div className="bg-[#DBEAFE] border border-[#BFDBFE] rounded-xl p-3">
            <p className="text-[12px] text-[#0C4A6E] leading-snug">
              <strong>These documents become part of the AI's reference library.</strong> Upload your company's own SOPs, maintenance checklists, daily pre-job checklists, and reference manuals. When your crew uses the <strong>SOP / ERP AI</strong>, Gemini cites <em>your</em> documents by name alongside AER / API / OH&S / CSA / IWCF standards.
            </p>
          </div>

          {/* Category filters */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              data-testid="docs-filter-all"
              onClick={() => setFilter("all")}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${filter === "all" ? "bg-[#FF6B1A] text-white border-[#FF6B1A]" : "bg-white border-[#D4D4D4] text-[#595959] hover:border-[#FF6B1A]"}`}
            >
              All ({docs.length})
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                data-testid={`docs-filter-${c.id}`}
                onClick={() => setFilter(c.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${filter === c.id ? "bg-[#FF6B1A] text-white border-[#FF6B1A]" : "bg-white border-[#D4D4D4] text-[#595959] hover:border-[#FF6B1A]"}`}
              >
                {c.label} ({byCat[c.id] || 0})
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#595959] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              data-testid="docs-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, description, tag…"
              className="w-full pl-7 pr-3 py-1.5 border border-[#CCC] rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B1A]/40"
            />
          </div>

          {/* List */}
          {loading ? (
            <p className="text-[12px] text-[#595959] py-6 text-center">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-dashed border-[#D4D4D4] rounded-xl p-8 text-center">
              <FolderOpen className="w-10 h-10 text-[#C4C4C4] mx-auto mb-2" />
              <p className="text-[13px] text-[#262626] font-semibold">
                {docs.length === 0 ? "No documents yet" : "Nothing matches that filter"}
              </p>
              <p className="text-[11px] text-[#595959] mt-1">
                {docs.length === 0
                  ? "Upload your first PDF — company SOP, pre-job checklist, maintenance sheet."
                  : "Try another category or clear the search."}
              </p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="docs-list">
              {filtered.map((d) => {
                const cat = CATEGORIES.find((c) => c.id === d.category) || CATEGORIES[CATEGORIES.length - 1];
                const Icon = cat.Icon;
                return (
                  <div
                    key={d.doc_id}
                    data-testid={`docs-row-${d.doc_id}`}
                    className="bg-white border border-[#D4D4D4] rounded-xl p-3 flex items-start gap-3 shadow-sm hover:border-[#FF6B1A]/60 transition-colors"
                  >
                    <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${cat.tint}`}>
                      <Icon className="w-4 h-4" strokeWidth={2.5} />
                    </div>
                    <button
                      onClick={() => openDoc(d)}
                      className="flex-1 min-w-0 text-left"
                      data-testid={`docs-open-${d.doc_id}`}
                    >
                      <p className="text-[13px] font-bold text-[#262626] truncate">{d.name}</p>
                      <p className="text-[11px] text-[#595959] truncate">
                        {CAT_LABEL[d.category] || d.category} · {d.filename} · {prettySize(d.size || 0)} · by {d.uploader_name}
                      </p>
                      {d.description && <p className="text-[11px] text-[#333] mt-0.5 line-clamp-2">{d.description}</p>}
                      {d.tags && d.tags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {d.tags.slice(0, 6).map((t) => (
                            <span key={t} className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-[#F0F0F0] text-[#595959] px-1.5 py-[1px] rounded-full">
                              <Tag className="w-2.5 h-2.5" /> {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {(d.uploader_user_id === user?.user_id || user?.role === "admin" || user?.role === "field_manager" || user?.role === "ops_manager") && (
                        <>
                          <button
                            data-testid={`docs-edit-${d.doc_id}`}
                            onClick={() => openEdit(d)}
                            className="p-1 rounded text-[#595959] hover:text-[#FF6B1A] hover:bg-[#FFF7EF]"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            data-testid={`docs-delete-${d.doc_id}`}
                            onClick={() => del(d)}
                            className="p-1 rounded text-[#595959] hover:text-[#C00000] hover:bg-[#FEE2E2]"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-end sm:items-center justify-center p-3" onClick={() => setUploadOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-md p-4 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="docs-upload-dialog">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#262626]">Upload document</h3>
              <button onClick={() => setUploadOpen(false)}><X className="w-4 h-4 text-[#595959]" /></button>
            </div>
            <div className="space-y-2.5">
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">File (PDF or image, max 15 MB)</span>
                <input
                  ref={fileRef}
                  data-testid="docs-upload-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={onPick}
                  className="w-full text-[12px] mt-1 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-[#D4D4D4] file:bg-[#FFF7EF] file:text-[#C44A08] file:font-bold file:text-[11px]"
                />
                {upFile && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#595959] mt-1">
                    <FileIcon className="w-3 h-3" /> {upFile.name} · {prettySize(upFile.size)}
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Document name</span>
                <input
                  data-testid="docs-upload-name"
                  value={upName}
                  onChange={(e) => setUpName(e.target.value)}
                  placeholder="e.g. CT UBD Drill-Out SOP rev-7"
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B1A]/40"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Category</span>
                <select
                  data-testid="docs-upload-category"
                  value={upCategory}
                  onChange={(e) => setUpCategory(e.target.value)}
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm bg-white"
                >
                  {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Description (shown to the AI)</span>
                <textarea
                  data-testid="docs-upload-description"
                  value={upDescription}
                  onChange={(e) => setUpDescription(e.target.value)}
                  rows={2}
                  placeholder="One line — what this document covers so the AI can reference it accurately."
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm resize-none"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Tags (comma-separated)</span>
                <input
                  data-testid="docs-upload-tags"
                  value={upTags}
                  onChange={(e) => setUpTags(e.target.value)}
                  placeholder="UBD, h2s, pre-job"
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setUploadOpen(false)} className="px-3 py-1.5 text-[12px] font-semibold text-[#595959] hover:text-[#262626]">Cancel</button>
              <button
                data-testid="docs-upload-confirm"
                onClick={doUpload}
                disabled={uploading || !upFile || !upName.trim()}
                className="px-3 py-1.5 bg-[#FF6B1A] hover:bg-[#C44A08] text-white rounded text-[12px] font-bold disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editDoc && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-end sm:items-center justify-center p-3" onClick={() => setEditDoc(null)}>
          <div className="bg-white rounded-xl w-full max-w-md p-4 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="docs-edit-dialog">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#262626]">Edit document</h3>
              <button onClick={() => setEditDoc(null)}><X className="w-4 h-4 text-[#595959]" /></button>
            </div>
            <div className="space-y-2.5">
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Name</span>
                <input
                  data-testid="docs-edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Category</span>
                <select
                  data-testid="docs-edit-category"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm bg-white"
                >
                  {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[#333]">Description</span>
                <textarea
                  data-testid="docs-edit-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full px-2.5 py-2 border border-[#CCC] rounded text-sm resize-none"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditDoc(null)} className="px-3 py-1.5 text-[12px] font-semibold text-[#595959] hover:text-[#262626]">Cancel</button>
              <button
                data-testid="docs-edit-save"
                onClick={saveEdit}
                className="px-3 py-1.5 bg-[#FF6B1A] hover:bg-[#C44A08] text-white rounded text-[12px] font-bold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsPage;
