import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { isSupervisorOrHigher } from "../lib/roles";
import { Plus, Trash2, Wifi, WifiOff, AlertCircle, Lock, Zap, Loader2, CheckCircle2, XCircle } from "lucide-react";

const PROTOCOLS = [
  { v: "wits0_tcp", l: "WITS 0 — TCP" },
  { v: "wits0_serial", l: "WITS 0 — Serial" },
  { v: "modbus_tcp", l: "Modbus TCP" },
  { v: "witsml_rest", l: "WITSML 1.4 / 2.0 (REST)" },
];

const STATUS_PILL = {
  idle: "bg-[#F3F4F6] text-[#595959]",
  connecting: "bg-[#FFF3CD] text-[#856404] animate-pulse",
  connected: "bg-[#DCFCE7] text-[#065F46]",
  error: "bg-[#F8D7DA] text-[#991B1B]",
};

export default function DaqConfigPage() {
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);
  const [configs, setConfigs] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", protocol: "wits0_tcp", host: "", port: 12345, witsml_url: "", serial_port: "", baud: 9600 });

  const refresh = async () => {
    try { const r = await axios.get(`${API}/daq/configs`, { withCredentials: true }); setConfigs(r.data?.configs || []); }
    catch (e) {
      if (e.response?.status === 403) toast.error("DAQ configs are internal — Crew role or higher required.");
    }
  };
  useEffect(() => { refresh(); }, []);

  const save = async () => {
    if (!canEdit) return;
    if (!form.name.trim()) return toast.error("Name required");
    try {
      await axios.post(`${API}/daq/configs`, form, { withCredentials: true });
      setForm({ name: "", protocol: "wits0_tcp", host: "", port: 12345, witsml_url: "", serial_port: "", baud: 9600 });
      setShowNew(false); refresh(); toast.success("DAQ config saved");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const toggle = async (c) => {
    try {
      await axios.patch(`${API}/daq/configs/${c.config_id}`, { enabled: !c.enabled }, { withCredentials: true });
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this DAQ config?")) return;
    try { await axios.delete(`${API}/daq/configs/${id}`, { withCredentials: true }); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const [testing, setTesting] = useState(null); // config_id currently probing
  const [testResults, setTestResults] = useState({}); // config_id -> {ok, error, sample}
  const testConnection = async (cfg) => {
    setTesting(cfg.config_id);
    setTestResults((r) => ({ ...r, [cfg.config_id]: null }));
    try {
      const r = await axios.post(`${API}/daq/test`, {
        protocol: cfg.protocol,
        host: cfg.host,
        port: cfg.port,
        witsml_url: cfg.witsml_url,
        channel_map: cfg.channel_map,
        modbus_unit_id: cfg.modbus_unit_id,
        timeout_s: 10,
      }, { withCredentials: true });
      setTestResults((rr) => ({ ...rr, [cfg.config_id]: r.data }));
      if (r.data.ok) toast.success(`Probe OK — received sample from ${cfg.name}`);
      else toast.error(`Probe failed — ${r.data.error}`);
    } catch (e) {
      const err = e.response?.data?.detail || e.message || "Probe failed";
      setTestResults((rr) => ({ ...rr, [cfg.config_id]: { ok: false, error: err } }));
      toast.error(err);
    } finally { setTesting(null); }
  };

  return (
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="DAQ Listeners · Phase 2" subtitle="WITS 0 / Modbus TCP / WITSML — add a profile per CT unit, flip Enable when the field test is ready." />
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        <div className="bg-[#DBEAFE] text-[#0056B3] rounded-lg p-2 text-[11px] flex items-start gap-2">
          <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Real DAQ listeners active</p>
            <p>WITS 0 TCP, Modbus TCP, and WITSML REST are live. Add a profile, hit <b>Test</b> to verify your endpoint, then <b>Enable</b> to stream real rig data into Live Ops. Falls back to the simulator while a profile is disabled.</p>
          </div>
        </div>

        {!canEdit && (
          <div className="bg-[#FFF3CD] border border-[#FFE69C] text-[#856404] text-[12px] rounded px-3 py-2 flex items-center gap-2">
            <Lock className="w-4 h-4" /> View-only — Supervisor or Management can edit DAQ profiles.
          </div>
        )}

        {canEdit && (
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
            <button data-testid="toggle-daq-new" onClick={() => setShowNew(!showNew)} className="text-[11px] bg-[#FF6B1A] text-white px-2 py-1 rounded font-bold flex items-center gap-1"><Plus className="w-3 h-3" />Add profile</button>
            {showNew && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <input data-testid="daq-name" placeholder="Name (e.g. Rig 7)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded px-2 py-1" />
                <select data-testid="daq-protocol" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })} className="border rounded px-2 py-1">
                  {PROTOCOLS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                </select>
                {form.protocol === "wits0_serial" ? (
                  <>
                    <input placeholder="Serial port (e.g. /dev/ttyS0)" value={form.serial_port} onChange={(e) => setForm({ ...form, serial_port: e.target.value })} className="border rounded px-2 py-1" />
                    <input type="number" placeholder="Baud" value={form.baud} onChange={(e) => setForm({ ...form, baud: Number(e.target.value) })} className="border rounded px-2 py-1" />
                  </>
                ) : form.protocol === "witsml_rest" ? (
                  <input className="border rounded px-2 py-1 sm:col-span-2" placeholder="https://witsml.company.com/..." value={form.witsml_url} onChange={(e) => setForm({ ...form, witsml_url: e.target.value })} />
                ) : (
                  <>
                    <input data-testid="daq-host" placeholder="Host (IP)" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} className="border rounded px-2 py-1" />
                    <input data-testid="daq-port" type="number" placeholder="Port" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} className="border rounded px-2 py-1" />
                  </>
                )}
                <button data-testid="daq-save" onClick={save} className="bg-[#FF6B1A] text-white px-2 py-1 font-bold rounded sm:col-span-4 justify-self-start">Save profile</button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          {configs.length === 0 && <p className="text-sm text-[#595959] text-center py-8">No DAQ profiles yet.</p>}
          {configs.map((c) => (
            <div key={c.config_id} data-testid={`daq-row-${c.config_id}`} className="bg-white border border-[#D4D4D4] rounded-lg p-2 flex items-center gap-2 flex-wrap">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_PILL[c.status]}`}>
                {c.status === "connected" ? <Wifi className="w-3 h-3 inline mr-0.5" /> : c.status === "error" ? <AlertCircle className="w-3 h-3 inline mr-0.5" /> : <WifiOff className="w-3 h-3 inline mr-0.5" />}
                {c.status}
              </span>
              <span className="font-bold text-sm">{c.name}</span>
              <span className="text-[11px] text-[#595959]">{PROTOCOLS.find((p) => p.v === c.protocol)?.l || c.protocol}</span>
              {c.host && <span className="text-[11px] tabular-nums text-[#595959]">{c.host}:{c.port}</span>}
              {c.serial_port && <span className="text-[11px] tabular-nums text-[#595959]">{c.serial_port} @ {c.baud}</span>}
              {c.witsml_url && <span className="text-[11px] text-[#595959] truncate max-w-[280px]">{c.witsml_url}</span>}
              {c.last_error && <span className="text-[11px] text-[#C00000]">· {c.last_error}</span>}
              <div className="ml-auto flex gap-1 items-center">
                {testResults[c.config_id] && (
                  <span
                    data-testid={`daq-test-result-${c.config_id}`}
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${testResults[c.config_id].ok ? "bg-[#DCFCE7] text-[#065F46]" : "bg-[#F8D7DA] text-[#991B1B]"}`}
                    title={testResults[c.config_id].ok ? JSON.stringify(testResults[c.config_id].sample || {}) : testResults[c.config_id].error}
                  >
                    {testResults[c.config_id].ok
                      ? <><CheckCircle2 className="w-3 h-3" />Sample OK</>
                      : <><XCircle className="w-3 h-3" />{(testResults[c.config_id].error || "").slice(0, 40)}</>}
                  </span>
                )}
                {canEdit && (
                  <>
                    <button
                      data-testid={`daq-test-${c.config_id}`}
                      onClick={() => testConnection(c)}
                      disabled={testing === c.config_id}
                      className="text-[11px] font-bold px-2 py-1 rounded bg-[#0056B3] text-white hover:bg-[#003D7A] disabled:opacity-50 flex items-center gap-1"
                    >
                      {testing === c.config_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}Test
                    </button>
                    <button data-testid={`daq-toggle-${c.config_id}`} onClick={() => toggle(c)} className={`text-[11px] font-bold px-2 py-1 rounded ${c.enabled ? "bg-[#C00000] text-white" : "bg-[#FF6B1A] text-white"}`}>
                      {c.enabled ? "Disable" : "Enable"}
                    </button>
                    <button data-testid={`daq-del-${c.config_id}`} onClick={() => del(c.config_id)} className="text-[#C00000] p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
