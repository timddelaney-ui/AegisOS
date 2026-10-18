import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, ShieldCheck, Wrench, AlertTriangle, Package, ListChecks, Users, Radio, Loader2, MessageSquare, Copy, Check } from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { rigLabel } from "../context/RigContext";

import { fmtDateTime, fmtShort } from "../lib/timeFormat";

const fmt = (iso) => fmtDateTime(iso);
const short = (iso) => fmtShort(iso);

const StatCard = ({ label, value, Icon, accent }) => (
  <div className="bg-white border border-[#E5E7EB] rounded-lg p-3 flex items-center gap-3" style={{ borderTop: `3px solid ${accent}` }}>
    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${accent}18`, color: accent }}>
      <Icon className="w-5 h-5" strokeWidth={2.5} />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-[#595959] font-bold">{label}</div>
      <div className="text-xl font-bold text-[#262626] leading-tight">{value}</div>
    </div>
  </div>
);

const Section = ({ title, Icon, accent, children, count }) => (
  <div className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
    <div className="px-3 py-2 flex items-center gap-2 border-b border-[#E5E7EB]" style={{ background: `${accent}10` }}>
      <Icon className="w-4 h-4" style={{ color: accent }} strokeWidth={2.5} />
      <span className="text-[13px] font-bold" style={{ color: accent }}>{title}</span>
      <span className="text-[10px] font-bold text-white px-1.5 py-[1px] rounded-full ml-auto" style={{ background: accent }}>{count}</span>
    </div>
    <div className="p-2 text-[12px]">{children}</div>
  </div>
);

const ManagerDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [hours, setHours] = useState(24);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: d } = await axios.get(`${API}/manager/dashboard`, { params: { hours }, withCredentials: true });
      setData(d);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to load dashboard.");
    } finally { setLoading(false); }
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  const buildTextReport = () => {
    if (!data) return "";
    const L = [];
    L.push(`OPS MANAGER DASHBOARD — ${data.scope === "cross_team" ? "All Teams" : "Team View"}`);
    L.push(`Window: last ${data.hours} h  ·  Generated: ${fmt(data.generated_at)}`);
    L.push("");
    L.push(`RIGS SEEN: ${data.totals.rigs_seen} across ${data.totals.teams_seen} team(s)`);
    for (const r of data.rigs_activity) {
      L.push(`  • ${rigLabel(r.rig_id)} (${r.team_name}) — chat: ${r.last_chat_at ? short(r.last_chat_at) : "—"}, checklist: ${r.last_checklist_at ? short(r.last_checklist_at) : "—"}`);
    }
    L.push("");
    L.push(`SAFETY CERT CHECK-OFFS (${data.safety_events.length})`);
    for (const e of data.safety_events.slice(0, 25)) L.push(`  • ${short(e.created_at)} — ${e.item_label} — ${e.user_name} on ${rigLabel(e.rig_id)} (${e.team_name})`);
    L.push("");
    L.push(`EQUIPMENT MAINTENANCE (${data.maintenance_events.length})`);
    for (const e of data.maintenance_events.slice(0, 25)) L.push(`  • ${short(e.created_at)} — ${e.item_label} — ${e.user_name} on ${rigLabel(e.rig_id)} (${e.team_name})`);
    L.push("");
    L.push(`SAFETY ALERTS (${data.alerts.length})`);
    for (const a of data.alerts.slice(0, 25)) L.push(`  • ${short(a.created_at)} — ${a.threshold_id || "alert"} on ${a.sheet_key || "sheet"} (${rigLabel(a.rig_id || "")} / ${a.team_name})`);
    L.push("");
    L.push(`INVENTORY FLAGS (${data.inventory_flags.length})`);
    for (const i of data.inventory_flags.slice(0, 40)) L.push(`  • [${i.status}] ${i.name} — ${i.team_name} / ${rigLabel(i.rig_id || "")}`);
    L.push("");
    L.push(`OPEN PARTS ORDERS (${data.parts_open.length})`);
    for (const p of data.parts_open.slice(0, 40)) L.push(`  • [${p.status}] ${p.name} — ${p.team_name} / ${rigLabel(p.rig_id || "")}`);
    return L.join("\n");
  };

  const copyReport = async () => {
    const text = buildTextReport();
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2500); }
      catch (err) { console.warn("Clipboard copy fallback failed:", err?.message); }
      document.body.removeChild(ta);
    }
  };

  const role = data?.role || user?.role || "crew";
  const scopeLabel = !data
    ? "Loading…"
    : data.scope === "cross_team"
      ? "All Teams (Ops Manager)"
      : role === "field_manager"
        ? "Your Team (Field Manager)"
        : "Team View";

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col">
      <header className="bg-[#0D6535] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0">
        <button onClick={() => navigate("/hub")} data-testid="manager-back" className="flex items-center gap-1.5 text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-sm font-semibold ml-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Manager Dashboard
          <span className="text-[10px] bg-white/20 px-1.5 py-[2px] rounded font-bold uppercase">{scopeLabel}</span>
        </h1>
      </header>

      <div className="flex-1 p-3 pb-10 overflow-auto">
        <div className="max-w-6xl mx-auto space-y-3">
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-3 flex items-center flex-wrap gap-3">
            <label className="text-[11px] font-semibold text-[#444]">Window:</label>
            <select
              data-testid="manager-window"
              value={hours}
              onChange={(e) => setHours(parseInt(e.target.value, 10))}
              className="text-[11px] border border-[#CCC] rounded px-2 py-1"
            >
              <option value={12}>last 12 h</option>
              <option value={24}>last 24 h</option>
              <option value={48}>last 48 h</option>
              <option value={168}>last 7 days</option>
              <option value={720}>last 30 days</option>
            </select>
            <button
              onClick={load}
              data-testid="manager-refresh"
              disabled={loading}
              className="text-[11px] font-semibold text-[#0D6535] hover:underline disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                data-testid="manager-copy-report"
                onClick={copyReport}
                disabled={!data || loading}
                className="text-[12px] font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-3 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-50"
              >
                {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy Report</>}
              </button>
            </div>
          </div>

          {loading && !data && (
            <div className="flex items-center justify-center py-16 text-[13px] text-[#595959]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Pulling status across the field…
            </div>
          )}
          {error && <div className="bg-[#F8D7DA] border border-[#F5C6CB] text-[#721C24] rounded px-3 py-2 text-[12px]">{error}</div>}

          {data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <StatCard label="Teams" value={data.totals.teams_seen} Icon={Users} accent="#0D6535" />
                <StatCard label="Rigs Active" value={data.totals.rigs_seen} Icon={Radio} accent="#0056B3" />
                <StatCard label="Safety Cert" value={data.totals.safety_events} Icon={ShieldCheck} accent="#C00000" />
                <StatCard label="Maintenance" value={data.totals.maintenance_events} Icon={Wrench} accent="#856404" />
                <StatCard label="Alerts" value={data.totals.alerts} Icon={AlertTriangle} accent="#DC2626" />
                <StatCard label="Inv Flags" value={data.totals.inventory_flags} Icon={Package} accent="#C36600" />
              </div>

              <Section title="Rig activity" Icon={Radio} accent="#0056B3" count={data.rigs_activity.length}>
                {data.rigs_activity.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">No rig activity in this window.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-left text-[10px] uppercase text-[#595959] border-b border-[#E5E7EB]">
                          <th className="py-1.5 pr-2">Rig</th>
                          <th className="py-1.5 pr-2">Team</th>
                          <th className="py-1.5 pr-2">Last chat</th>
                          <th className="py-1.5 pr-2">Last checklist</th>
                          <th className="py-1.5 pr-2 text-right">Msgs</th>
                          <th className="py-1.5 pr-2 text-right">Checks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rigs_activity.map((r) => (
                          <tr key={`${r.team_id}-${r.rig_id}`} data-testid="rig-activity-row" className="border-b border-[#F0F0F0] hover:bg-[#FAFAFA]">
                            <td className="py-1.5 pr-2 font-bold">{rigLabel(r.rig_id)}</td>
                            <td className="py-1.5 pr-2 text-[#595959]">{r.team_name}</td>
                            <td className="py-1.5 pr-2 text-[#595959]">{r.last_chat_at ? short(r.last_chat_at) : "—"}</td>
                            <td className="py-1.5 pr-2 text-[#595959]">{r.last_checklist_at ? short(r.last_checklist_at) : "—"}</td>
                            <td className="py-1.5 pr-2 text-right">{r.chat_count || 0}</td>
                            <td className="py-1.5 pr-2 text-right">{r.checklist_count || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              <Section title="Safety certification check-offs" Icon={ShieldCheck} accent="#C00000" count={data.safety_events.length}>
                {data.safety_events.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">No FLHA / safety check-offs in this window.</div>
                ) : (
                  <ul className="divide-y divide-[#F0F0F0]">
                    {data.safety_events.slice(0, 60).map((e) => (
                      <li key={e.event_id} className="py-1.5 flex flex-wrap gap-x-2">
                        <span className="font-medium text-[#262626]">{e.item_label}</span>
                        <span className="text-[#595959] text-[11px] ml-auto">
                          {e.user_name} · {rigLabel(e.rig_id)} · {e.team_name} · {short(e.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Equipment maintenance log (last 30 days)" Icon={Wrench} accent="#856404" count={data.maintenance_events.length}>
                {data.maintenance_events.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">No PM check-offs in the last 30 days.</div>
                ) : (
                  <ul className="divide-y divide-[#F0F0F0]">
                    {data.maintenance_events.slice(0, 60).map((e) => (
                      <li key={e.event_id} className="py-1.5 flex flex-wrap gap-x-2">
                        <span className="font-medium text-[#262626]">{e.item_label}</span>
                        <span className="text-[10px] uppercase font-bold text-[#856404]">{e.cadence || "pm"}</span>
                        <span className="text-[#595959] text-[11px] ml-auto">
                          {e.user_name} · {rigLabel(e.rig_id)} · {e.team_name} · {short(e.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Skipper safety alerts" Icon={AlertTriangle} accent="#DC2626" count={data.alerts.length}>
                {data.alerts.length === 0 ? (
                  <div className="text-[#8A8A8A] italic px-1">No alerts in this window.</div>
                ) : (
                  <ul className="divide-y divide-[#F0F0F0]">
                    {data.alerts.slice(0, 40).map((a) => (
                      <li key={a.audit_id || a.message_id} className="py-1.5">
                        <div className="text-[11px] font-bold text-[#C00000]">
                          {(a.threshold_id || "alert").toUpperCase()} · {a.sheet_key || "sheet"} · {rigLabel(a.rig_id || "")} · {a.team_name}
                        </div>
                        <div className="text-[11px] text-[#595959]">{fmt(a.created_at)}</div>
                        {a.text && <div className="text-[12px] whitespace-pre-wrap text-[#262626] mt-0.5">{a.text.split("\n").slice(1).join("\n") || a.text}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Section title="Inventory / consumables flags" Icon={Package} accent="#C36600" count={data.inventory_flags.length}>
                  {data.inventory_flags.length === 0 ? (
                    <div className="text-[#8A8A8A] italic px-1">Everything green across the field.</div>
                  ) : (
                    <ul className="divide-y divide-[#F0F0F0]">
                      {data.inventory_flags.slice(0, 40).map((i) => (
                        <li key={i.item_id} className="py-1.5 flex flex-wrap gap-x-2">
                          <span className="text-[10px] font-bold uppercase" style={{ color: i.status === "OOS" ? "#C00000" : "#856404" }}>{i.status}</span>
                          <span className="font-medium">{i.name}</span>
                          {i.quantity != null && <span className="text-[#595959]">{i.quantity} {i.unit || ""}</span>}
                          <span className="text-[11px] text-[#595959] ml-auto">{i.team_name} · {rigLabel(i.rig_id || "")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>

                <Section title="Open parts orders" Icon={ListChecks} accent="#0056B3" count={data.parts_open.length}>
                  {data.parts_open.length === 0 ? (
                    <div className="text-[#8A8A8A] italic px-1">No open parts orders.</div>
                  ) : (
                    <ul className="divide-y divide-[#F0F0F0]">
                      {data.parts_open.slice(0, 40).map((p) => (
                        <li key={p.item_id} className="py-1.5">
                          <div className="flex flex-wrap gap-x-2 items-baseline">
                            <span className="text-[10px] font-bold uppercase text-[#0056B3]">{p.status}</span>
                            <span className="font-medium">{p.name}</span>
                            <span className="text-[11px] text-[#595959] ml-auto">{p.team_name} · {rigLabel(p.rig_id || "")}</span>
                          </div>
                          {p.note && <div className="text-[11px] text-[#595959] italic mt-0.5">{p.note}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManagerDashboard;
