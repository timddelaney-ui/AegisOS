import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Paperclip, X, Loader2, FileText, Trash2, Image as ImageIcon, Download } from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { useRig } from "../context/RigContext";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/*,application/pdf";
const MAX_BYTES = 15 * 1024 * 1024;

const humanSize = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * AttachmentThumb — renders an image inline (fetched as blob to avoid leaking cookies to CDNs)
 * or a PDF chip. Delete only if `canDelete`.
 */
export const AttachmentThumb = ({ attachment, canDelete = false, onDelete }) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const url = `${API}${attachment.download_url}`;
  const isImage = attachment.kind === "image";

  useEffect(() => {
    if (!isImage) return;
    let active = true;
    let created = null;
    (async () => {
      try {
        const r = await axios.get(url, { withCredentials: true, responseType: "blob" });
        if (!active) return;
        created = URL.createObjectURL(r.data);
        setBlobUrl(created);
      } catch (e) {
        console.warn("Attachment thumb fetch failed:", e?.response?.status || e?.message);
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [url, isImage]);

  return (
    <div data-testid={`attachment-thumb-${attachment.attachment_id}`} className="relative group border border-[#D4D4D4] rounded-lg overflow-hidden bg-white flex flex-col text-[10px]">
      {isImage ? (
        <div className="w-full h-20 sm:h-24 bg-[#F3F3F3] flex items-center justify-center">
          {blobUrl ? (
            <img src={blobUrl} alt={attachment.filename} className="w-full h-full object-cover" />
          ) : failed ? (
            <ImageIcon className="w-6 h-6 text-[#8A8A8A]" />
          ) : (
            <Loader2 className="w-4 h-4 animate-spin text-[#8A8A8A]" />
          )}
        </div>
      ) : (
        <a
          href={url}
          download={attachment.filename}
          data-testid={`attachment-pdf-${attachment.attachment_id}`}
          className="w-full h-20 sm:h-24 bg-[#F8D7DA] flex flex-col items-center justify-center text-[#721C24] gap-1"
          onClick={(e) => { e.preventDefault(); window.open(url, "_blank", "noopener,noreferrer"); }}
        >
          <FileText className="w-6 h-6" strokeWidth={2} />
          <span className="font-bold uppercase text-[9px]">PDF</span>
        </a>
      )}
      <div className="p-1.5 border-t border-[#F0F0F0]">
        <div className="truncate font-semibold text-[#262626]" title={attachment.filename}>{attachment.filename}</div>
        <div className="flex items-center justify-between text-[9px] text-[#595959]">
          <span>{humanSize(attachment.size)} · {attachment.uploader_name}</span>
          <div className="flex items-center gap-1">
            {isImage && <a href={url} download={attachment.filename} onClick={(e) => { e.preventDefault(); window.open(url, "_blank"); }} className="hover:text-[#0D6535]" title="Open"><Download className="w-3 h-3" /></a>}
            {canDelete && (
              <button data-testid={`attachment-del-${attachment.attachment_id}`} onClick={() => onDelete(attachment)} className="hover:text-[#C00000]" title="Delete">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * AttachmentUploader — team-scoped uploader. Accepts JPG/PNG/HEIC/PDF ≤15 MB.
 * - `context`: equipment | chat | handover | checklist
 * - `contextRef`: opaque ID string used to filter attachments in list view
 * - `onUploaded`: called after successful upload
 * - `hideList`: if true, only shows the upload button (list rendered elsewhere)
 */
const AttachmentUploader = ({ context, contextRef, onUploaded, hideList = false, compact = false, label }) => {
  const { user } = useAuth();
  const { rigId } = useRig();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadList = useCallback(async () => {
    if (hideList) return;
    setLoading(true);
    try {
      const params = { context };
      if (contextRef) params.context_ref = contextRef;
      const { data } = await axios.get(`${API}/attachments`, { params, withCredentials: true });
      setItems(data.attachments || []);
    } catch (e) {
      console.debug("Attachment list failed:", e?.response?.status || e?.message);
    } finally { setLoading(false); }
  }, [context, contextRef, hideList]);

  useEffect(() => { loadList(); }, [loadList]);

  const pick = () => inputRef.current?.click();

  const validate = (f) => {
    if (!f) return "Pick a file";
    if (f.size > MAX_BYTES) return `Too big (${(f.size/1024/1024).toFixed(1)} MB). Max 15 MB.`;
    const type = f.type || "";
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const okType = ALLOWED_MIME.includes(type) || ["jpg","jpeg","png","webp","heic","heif","pdf"].includes(ext);
    if (!okType) return "Only JPG, PNG, HEIC, WEBP or PDF.";
    return null;
  };

  const upload = async (file) => {
    const bad = validate(file);
    if (bad) { setError(bad); return; }
    setError(null); setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("context", context);
      if (contextRef) fd.append("context_ref", contextRef);
      if (rigId)      fd.append("rig_id", rigId);
      const { data } = await axios.post(`${API}/attachments`, fd, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploaded && onUploaded(data);
      await loadList();
    } catch (e) {
      setError(e.response?.data?.detail || "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const del = async (att) => {
    if (!window.confirm(`Delete "${att.filename}"?`)) return;
    try {
      await axios.delete(`${API}/attachments/${att.attachment_id}`, { withCredentials: true });
      await loadList();
    } catch (e) {
      alert(e.response?.data?.detail || "Delete failed.");
    }
  };

  return (
    <div data-testid={`attachment-uploader-${context}`} className={compact ? "" : "space-y-2"}>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={pick}
          disabled={uploading}
          data-testid={`attachment-pick-${context}`}
          className={`flex items-center gap-1 rounded font-semibold ${compact ? "text-[10px] px-1.5 py-1 text-[#0D6535] hover:bg-[#F0F9F3]" : "text-[11px] px-2.5 py-1.5 bg-[#0D6535] hover:bg-[#0A4F28] text-white"} disabled:opacity-50`}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" strokeWidth={2.5} />}
          {label || (compact ? "Attach" : "Attach photo or PDF")}
        </button>
        <input
          ref={inputRef}
          data-testid={`attachment-input-${context}`}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        {!compact && !hideList && (
          <span className="text-[10px] text-[#595959]">JPG · PNG · HEIC · PDF · 15 MB max</span>
        )}
        {error && <span data-testid={`attachment-error-${context}`} className="text-[10px] text-[#C00000] font-semibold">{error}<button onClick={() => setError(null)} className="ml-1"><X className="w-3 h-3 inline" /></button></span>}
      </div>

      {!hideList && (
        <div>
          {loading && items.length === 0 ? (
            <div className="text-[11px] text-[#595959] italic">Loading attachments…</div>
          ) : items.length === 0 ? (
            <div className="text-[11px] text-[#8A8A8A] italic">No attachments yet.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {items.map((att) => (
                <AttachmentThumb
                  key={att.attachment_id}
                  attachment={att}
                  canDelete={att.uploader_user_id === user?.user_id}
                  onDelete={del}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AttachmentUploader;
