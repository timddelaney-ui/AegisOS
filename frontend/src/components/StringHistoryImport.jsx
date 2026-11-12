import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { API } from "../context/AuthContext";
import { parseStringHistory, stationsToNodeDamage } from "../lib/stringHistoryImporter";

const MAX_BYTES = 10 * 1024 * 1024;

export default function StringHistoryImport({ reel, onDone }) {
  const [result, setResult] = useState(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);

  const onFile = async (file) => {
    setResult(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setResult({ ok: false, errors: ["File is larger than 10 MB."], warnings: [], stations: [] });
      return;
    }
    setFilename(file.name);
    setResult(parseStringHistory(await file.text(), { filename: file.name }));
  };

  const submit = async () => {
    if (!result?.ok) return;
    setBusy(true);
    try {
      const state = await axios.get(`${API}/fatigue/state`, { params: { reel_id: reel.reel_id }, withCredentials: true });
      const spacing = state.data.spacing_ft;
      const damage = stationsToNodeDamage(result.stations, spacing, reel.total_length_ft);
      const body = { reel_id: reel.reel_id, spacing_ft: spacing, damage, source: result.format === "reel-trak" ? "reel-trak" : result.format, filename };
      try {
        await axios.post(`${API}/fatigue/import`, body, { withCredentials: true });
      } catch (e) {
        if (e.response?.status === 409 && window.confirm("This reel already has fatigue history. Replace it with the imported values?")) {
          await axios.post(`${API}/fatigue/import`, { ...body, overwrite: true }, { withCredentials: true });
        } else throw e;
      }
      toast.success(`Imported ${result.stations.length} stations`);
      setResult(null);
      onDone?.();
    } catch (e) {
      const d = e.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 pt-2 border-t border-[#E5E5E5]" data-testid={`import-history-${reel.reel_id}`}>
      <label className="text-[11px] font-bold text-[#595959] uppercase flex items-center gap-1">
        <Upload className="w-3 h-3" /> Import legacy fatigue history (Cerberus / Reel-Trak / CSV / LAS)
      </label>
      <input type="file" accept=".csv,.las,.txt" onChange={(e) => onFile(e.target.files?.[0])} className="text-xs mt-1 max-w-full" />
      {result && (
        <div className="mt-1 text-[11px] space-y-1" role="status">
          {result.errors?.map((m) => <p key={m} className="text-[#B91C1C]">{m}</p>)}
          {result.warnings?.slice(0, 5).map((m) => <p key={m} className="text-[#856404]">{m}</p>)}
          {result.ok && (
            <>
              <p className="text-[#065F46]">{result.stations.length} stations parsed ({result.format}). Worst: {(Math.max(...result.stations.map((s) => s.damage)) * 100).toFixed(1)}%.</p>
              <button disabled={busy} onClick={submit} className="bg-[#FF6B1A] text-white px-2 py-1 rounded font-bold disabled:opacity-50">
                {busy ? "Importing…" : "Apply to this reel"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
