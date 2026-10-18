import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth, API, isProUser } from "../context/AuthContext";
import {
  FileSpreadsheet, FolderOpen, Users, Sparkles, ChevronRight, Crown, AlertTriangle,
  MessageSquare, Wrench, GraduationCap, AlertOctagon, FileText, Calendar, Gauge,
  Ticket, MessageSquarePlus, Zap, Menu, ShieldCheck, HardHat, ClipboardList, Flame, Mail,
  Layers, Activity, Thermometer, Box, Package, Clock, CheckSquare, DollarSign, UserCog,
} from "lucide-react";
import { workbookData } from "../mock/workbookData";
import ExcelHeader from "../components/ExcelHeader";
import RigSelector from "../components/RigSelector";
import AIPanel from "../components/AIPanel";
import { usePullToRefresh, PullIndicator } from "../hooks/usePullToRefresh";

const greetings = ["Kettle's on", "Ready for shift", "How's the shift", "Morning, hand", "Evening, tool push", "Coffee's brewing"];
const proTips = [
  "Tap any sheet tab at the bottom of the workbook to jump between operations.",
  "The AI 'Training' mode explains what's happening downhole in plain English — good for a new hand.",
  "Save a job before you head out — it syncs to the whole crew if you're on a team.",
  "The Emergency SOP tab has 17 scenarios with AER/OH&S citations. Bookmark it.",
  "Switch to Metric units in the sheet — every calculated result converts automatically.",
  "Ask the AI 'Troubleshoot' about surface symptoms and it'll walk you through diagnosis.",
];

const HubCard = ({ Icon, title, subtitle, onClick, accent, badge, gradient, "data-testid": testId }) => (
  <button
    data-testid={testId}
    onClick={onClick}
    className={`group relative overflow-hidden rounded-xl border border-[#D4D4D4] bg-white p-4 text-left shadow-sm hover:shadow-md hover:border-[#107C41] transition-all hover:-translate-y-0.5 ${gradient || ""}`}
  >
    <div className="flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${accent || "bg-[#E6F4EA] text-[#107C41]"}`}>
        <Icon className="w-5 h-5" strokeWidth={2.2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h3 className="text-sm font-bold text-[#262626]">{title}</h3>
          {badge && <span className="text-[9px] font-bold px-1.5 py-[2px] bg-[#FFF3CD] text-[#856404] rounded">{badge}</span>}
        </div>
        <p className="text-[11px] text-[#595959] mt-0.5 leading-snug">{subtitle}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-[#C4C4C4] group-hover:text-[#107C41] flex-shrink-0" />
    </div>
  </button>
);

const StatChip = ({ Icon, value, label, color }) => (
  <div className="flex flex-col items-center bg-white border border-[#D4D4D4] rounded-lg py-2.5 px-2 shadow-sm">
    <div className={`w-6 h-6 rounded flex items-center justify-center mb-1 ${color || "bg-[#E6F4EA] text-[#107C41]"}`}>
      <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
    </div>
    <p className="text-lg font-bold text-[#262626] tabular-nums">{value}</p>
    <p className="text-[10px] text-[#595959] uppercase font-semibold">{label}</p>
  </div>
);

const Hub = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [team, setTeam] = useState(null);
  const [activeTreatment, setActiveTreatment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState("assistant");

  const loadAll = useCallback(async () => {
    const rigId = (() => { try { return localStorage.getItem("ctp_active_rig_v2") || "RIG1"; } catch { return "RIG1"; } })();
    const [j, t, trt] = await Promise.all([
      axios.get(`${API}/jobs`, { withCredentials: true }).then((r) => r.data).catch(() => []),
      axios.get(`${API}/teams/me`, { withCredentials: true }).then((r) => r.data).catch(() => null),
      axios.get(`${API}/treatments/active`, { params: { rig_id: rigId }, withCredentials: true }).then((r) => r.data?.treatment).catch(() => null),
    ]);
    setJobs(j || []);
    setTeam(t);
    setActiveTreatment(trt || null);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const { ref: pullRef, progress, refreshing: pulling } = usePullToRefresh(loadAll);

  const isPro = isProUser(user);
  const trial = useMemo(() => {
    if (!user?.trial_expires_at) return { active: false, daysLeft: 0 };
    const exp = new Date(user.trial_expires_at).getTime();
    const ms = exp - Date.now();
    if (ms <= 0) return { active: false, daysLeft: 0 };
    return { active: true, daysLeft: Math.floor(ms / 86400000) };
  }, [user]);

  const firstName = (user?.name || "hand").split(" ")[0];
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  const greeting = greetings[Math.floor(Date.now() / 86400000) % greetings.length];
  const proTip = proTips[Math.floor(Date.now() / 86400000) % proTips.length];

  const recentJob = jobs[0];
  const teamJobCount = jobs.filter((j) => j.visibility === "team").length;

  const openAI = (mode) => { setAiMode(mode); setAiOpen(true); };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F3F3F3] to-[#E8ECEF] flex flex-col">
      <ExcelHeader />
      <RigSelector />

      <div className="flex-1 overflow-y-auto pb-8 scroll-smooth-mobile" ref={pullRef}>
        <PullIndicator progress={progress} refreshing={pulling} />
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          {/* Greeting */}
          <div className="pt-2">
            <p className="text-[11px] font-semibold text-[#107C41] uppercase tracking-wide">{timeOfDay} shift</p>
            <h1 className="text-2xl font-bold text-[#262626]">{greeting}, {firstName}.</h1>
            <p className="text-sm text-[#595959] mt-0.5">
              {isPro
                ? "Pro is unlocked. Every sheet, every SOP, and the AI are yours."
                : trial.active
                ? `You've got ${trial.daysLeft} day${trial.daysLeft !== 1 ? "s" : ""} of trial left — kick the tires.`
                : "Trial's ended — grab Pro and get back to work."}
            </p>
          </div>

          {/* Status stat row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatChip
              Icon={isPro ? Crown : Calendar}
              value={isPro ? "Pro" : trial.active ? trial.daysLeft : 0}
              label={isPro ? "Active" : trial.active ? "Days left" : "Trial ended"}
              color={isPro ? "bg-[#FFF3CD] text-[#856404]" : trial.active ? "bg-[#FFF3CD] text-[#856404]" : "bg-[#F8D7DA] text-[#721C24]"}
            />
            <StatChip Icon={FolderOpen} value={jobs.length} label="Saved" />
            <StatChip Icon={Users} value={team ? team.members?.length || 1 : 0} label="Crew" />
            <StatChip Icon={FileSpreadsheet} value="17" label="Sheets" />
          </div>

          {/* Primary CTA row */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => navigate("/app")}
              className="bg-[#107C41] hover:bg-[#0D6535] text-white py-4 rounded-xl shadow-md flex flex-col items-center justify-center gap-1 transition-all hover:-translate-y-0.5"
            >
              <FileSpreadsheet className="w-6 h-6" strokeWidth={2} />
              <span className="text-sm font-bold">Open Workbook</span>
              <span className="text-[10px] opacity-80">17 sheets · live calcs</span>
            </button>
            <button
              onClick={() => openAI("assistant")}
              className="bg-white border-2 border-[#107C41] text-[#107C41] hover:bg-[#F0F9F3] py-4 rounded-xl shadow-md flex flex-col items-center justify-center gap-1 transition-all hover:-translate-y-0.5"
            >
              <Sparkles className="w-6 h-6" strokeWidth={2} />
              <span className="text-sm font-bold">Ask the AI</span>
              <span className="text-[10px] opacity-70">Gemini 2.5 Flash</span>
            </button>
          </div>

          {/* AI mode shortcuts */}
          <div>
            <p className="text-[11px] font-bold text-[#595959] uppercase mb-1.5 tracking-wide flex items-center gap-1">
              <Zap className="w-3 h-3" /> Quick AI Moves
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { mode: "sop_erp", Icon: ShieldCheck, label: "SOP / ERP", tint: "bg-[#DBEAFE] text-[#0056B3]" },
                { mode: "troubleshoot", Icon: Wrench, label: "Troubleshoot", tint: "bg-[#FFF3CD] text-[#856404]" },
                { mode: "training", Icon: GraduationCap, label: "Training", tint: "bg-[#E0E7FF] text-[#5A67D8]" },
                { mode: "program", Icon: FileText, label: "Job Program", tint: "bg-[#E6F4EA] text-[#0D6535]" },
                { mode: "emergency", Icon: AlertOctagon, label: "Emergency", tint: "bg-[#F8D7DA] text-[#721C24]" },
                { mode: "interpret", Icon: Gauge, label: "Explain Results", tint: "bg-[#CFE2FF] text-[#084298]" },
                { mode: "assistant", Icon: MessageSquare, label: "Field Chat", tint: "bg-[#E6F4EA] text-[#107C41]" },
              ].map(({ mode, Icon, label, tint }) => (
                <button
                  key={mode}
                  data-testid={`hub-ai-move-${mode}`}
                  onClick={() => openAI(mode)}
                  className="bg-white border border-[#D4D4D4] hover:border-[#107C41] rounded-lg p-2.5 flex items-center gap-2 shadow-sm transition-colors"
                >
                  <div className={`w-7 h-7 rounded flex items-center justify-center ${tint}`}>
                    <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </div>
                  <span className="text-[12px] font-semibold text-[#262626]">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recent activity + Crew */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="bg-white border border-[#D4D4D4] rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-[#262626] flex items-center gap-1.5">
                  <FolderOpen className="w-4 h-4 text-[#107C41]" /> Recent Jobs
                </h3>
                <button onClick={() => navigate("/jobs")} className="text-[11px] text-[#107C41] font-semibold hover:underline">See all</button>
              </div>
              {loading ? (
                <p className="text-[11px] text-[#595959]">Loading…</p>
              ) : jobs.length === 0 ? (
                <p className="text-[12px] text-[#595959]">No jobs saved yet. Fill in a sheet and hit Save.</p>
              ) : (
                <div className="space-y-1.5">
                  {jobs.slice(0, 3).map((j) => (
                    <button
                      key={j.job_id}
                      onClick={() => navigate("/app", { state: { loadJob: j } })}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-[#F0F9F3] border border-transparent hover:border-[#107C41]/30 transition-colors"
                    >
                      <p className="text-[12px] font-semibold text-[#262626] truncate">{j.title}</p>
                      <p className="text-[10px] text-[#595959] truncate">
                        {workbookData[j.sheet_key]?.title || j.sheet_key} · {new Date(j.updated_at).toLocaleDateString()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-[#D4D4D4] rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-[#262626] flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-[#107C41]" /> Crew
                </h3>
                <button onClick={() => navigate("/team")} className="text-[11px] text-[#107C41] font-semibold hover:underline">Manage</button>
              </div>
              {team ? (
                <>
                  <p className="text-[13px] font-semibold text-[#262626]">{team.name}</p>
                  <p className="text-[11px] text-[#595959] mt-0.5">
                    {team.members?.length || 1} member{(team.members?.length || 1) !== 1 ? "s" : ""} · {teamJobCount} shared job{teamJobCount !== 1 ? "s" : ""}
                  </p>
                  <div className="mt-2 flex -space-x-2">
                    {(team.members || []).slice(0, 5).map((m) => (
                      m.picture ? (
                        <img key={m.user_id} src={m.picture} alt="" className="w-6 h-6 rounded-full border-2 border-white" />
                      ) : (
                        <div key={m.user_id} className="w-6 h-6 rounded-full bg-[#107C41] text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
                          {m.name?.charAt(0)}
                        </div>
                      )
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[12px] text-[#595959] mb-2">You're rolling solo. Create a crew to share jobs with your shift.</p>
                  <button onClick={() => navigate("/team")} className="text-[11px] font-bold text-[#107C41] hover:underline">Create a crew →</button>
                </>
              )}
            </div>
          </div>

          {/* Manager Dashboard shortcut — only visible to Field/Ops Managers */}
          {(user?.role === "field_manager" || user?.role === "ops_manager") && (
            <button
              data-testid="hub-manager-link"
              onClick={() => navigate("/manager")}
              className="w-full bg-gradient-to-r from-[#0D6535] to-[#0A4F28] text-white rounded-xl p-4 shadow-md flex items-center gap-3 hover:shadow-lg transition-all"
            >
              <ShieldCheck className="w-8 h-8 flex-shrink-0" strokeWidth={2} />
              <div className="flex-1 text-left">
                <p className="text-sm font-bold">
                  Manager Dashboard
                  <span className="ml-2 text-[10px] bg-white/20 px-1.5 py-[2px] rounded font-bold uppercase">
                    {user.role === "ops_manager" ? "All teams" : "Your team"}
                  </span>
                </p>
                <p className="text-[11px] opacity-90">Rig activity, safety cert check-offs, PM logs, alerts, low-stock flags — all in one view.</p>
              </div>
              <ChevronRight className="w-5 h-5" />
            </button>
          )}

          {/* Cards row */}
          <div className="grid gap-2 sm:grid-cols-2">
            <HubCard
              data-testid="hub-ctd-tile"
              Icon={Flame}
              title="CT Drilling Calculator"
              subtitle="Stand-alone balanced & underbalanced drilling solver. ECD, BHP, N₂ GLR, choke & UB-margin."
              accent="bg-[#FDE8E8] text-[#C00000]"
              onClick={() => navigate("/ctd-calculator")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-reels-tile"
              Icon={Layers}
              title="String & Reel Manager"
              subtitle="Tapered CT reel profile — the active reel feeds every sheet, Von Mises egg, and fatigue heatmap."
              accent="bg-[#FEF3C7] text-[#92400E]"
              onClick={() => navigate("/reels")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-vm-tile"
              Icon={Gauge}
              title="Triaxial · Von Mises Egg"
              subtitle="API RP 5C7 live operating envelope. Visual alert when operating point crosses 80% SMYS."
              accent="bg-[#FDE8E8] text-[#C00000]"
              onClick={() => navigate("/stress")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-fatigue-tile"
              Icon={Activity}
              title="Reel Fatigue Heatmap"
              subtitle="Palmgren-Miner damage per station, driven by live traction pressure. Green → red at 80% derate."
              accent="bg-[#F0F9F3] text-[#0D6535]"
              onClick={() => navigate("/fatigue")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-wellbore-tile"
              Icon={Box}
              title="3D Wellbore Viewer"
              subtitle="Minimum-curvature survey rendered in 3D. DLS color-coded, BHA tip animates with depth."
              accent="bg-[#DBEAFE] text-[#0056B3]"
              onClick={() => navigate("/wellbore")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-certs-tile"
              Icon={ShieldCheck}
              title="Crew Certifications"
              subtitle="Lifting, iron, PCE, CT unit, snubbing, H2S, first aid — expiry traffic lights."
              accent="bg-[#DCFCE7] text-[#065F46]"
              onClick={() => navigate("/certs")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-tasks-tile"
              Icon={CheckSquare}
              title="Daily Tasks"
              subtitle="Supervisor-assigned tasks. Crew ticks them complete through the day."
              accent="bg-[#E0E7FF] text-[#4338CA]"
              onClick={() => navigate("/tasks")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-parts-orders-tile"
              Icon={Package}
              title="Parts Orders"
              subtitle="Crew submit → Supervisor approve → Procurement. Audit trail on every move."
              accent="bg-[#FCE7C0] text-[#C36600]"
              onClick={() => navigate("/parts-orders")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-timecards-tile"
              Icon={DollarSign}
              title="Timecards & Payroll"
              subtitle="Daily hours by job + pay code. Two-step approval. CSV export, per pay-period."
              accent="bg-[#DCFCE7] text-[#065F46]"
              onClick={() => navigate("/timecards")}
              badge="NEW"
            />
            {(user?.role === "field_manager" || user?.role === "ops_manager" || user?.role === "admin") && (
              <HubCard
                data-testid="hub-crew-admin-tile"
                Icon={UserCog}
                title="Crew Admin"
                subtitle="Promote crew ↔ Supervisor ↔ Management, set base pay rates, restrict workspace domain."
                accent="bg-[#E0E7FF] text-[#5A67D8]"
                onClick={() => navigate("/crew-admin")}
                badge="NEW"
              />
            )}
            <HubCard
              data-testid="hub-docs-tile"
              Icon={FileText}
              title="Company Documents"
              subtitle="Upload SOPs, maintenance & daily checklists. AI references them alongside industry standards."
              accent="bg-[#DBEAFE] text-[#0056B3]"
              onClick={() => navigate("/documents")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-erp-tile"
              Icon={AlertOctagon}
              title="Site-Specific ERP Template"
              subtitle="1-page emergency response cover sheet — crew, muster point, hospital. Fill, save, print."
              accent="bg-[#FDE8E8] text-[#C00000]"
              onClick={() => navigate("/erp-template")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-crew-contacts-tile"
              Icon={Mail}
              title="Crew Email Contacts"
              subtitle="Address book for shift-end handover emails. Mark defaults for one-click send."
              accent="bg-[#E6F4EA] text-[#0D6535]"
              onClick={() => navigate("/crew-contacts")}
              badge="NEW"
            />
            <HubCard
              Icon={Wrench}
              title="Equipment & Assets"
              subtitle="Engine hours, injector meters, lifting certs, BOP/PCE tests, reel + iron MAWP — all flagged."
              accent="bg-[#FCE7C0] text-[#C36600]"
              onClick={() => navigate("/equipment")}
              badge="NEW"
            />
            <HubCard
              Icon={Calendar}
              title="Crew Schedule"
              subtitle="Assign day/night shifts with 14/14, 20/10 rotations. Print or save as PDF."
              accent="bg-[#DBEAFE] text-[#0056B3]"
              onClick={() => navigate("/schedule")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-treatment-tile"
              Icon={ClipboardList}
              title={activeTreatment ? `Treatment: ${activeTreatment.name}` : "Treatment Log"}
              subtitle={activeTreatment
                ? `LIVE · ${activeTreatment.entry_count || 0} entries · started by ${activeTreatment.created_by_name}. Tap to continue logging.`
                : "Timestamped job log everyone on the rig sees in real time. Perfect for handovers and post-jobs."}
              accent={activeTreatment ? "bg-[#DCFCE7] text-[#065F46]" : "bg-[#F0F9F3] text-[#0D6535]"}
              onClick={() => navigate("/treatment")}
              badge={activeTreatment ? "LIVE" : "NEW"}
            />
            <HubCard
              Icon={AlertOctagon}
              title="Emergency SOPs"
              subtitle="17 scenarios with AER/OH&S citations. Bookmark before your next well."
              accent="bg-[#F8D7DA] text-[#C00000]"
              onClick={() => navigate("/app", { state: { openEmergency: true } })}
            />
            <HubCard
              Icon={GraduationCap}
              title="Training Mode"
              subtitle="New hand? Get plain-English walk-throughs of what's happening downhole."
              accent="bg-[#E0E7FF] text-[#5A67D8]"
              onClick={() => openAI("training")}
              badge="NEW"
            />
            <HubCard
              data-testid="hub-redeem-tile"
              Icon={Ticket}
              title="Have an Invite Code?"
              subtitle="Redeem a code from your admin for exclusive Pro access."
              accent="bg-[#FFF3CD] text-[#856404]"
              onClick={() => document.dispatchEvent(new CustomEvent("open-redeem"))}
            />
            <HubCard
              data-testid="hub-feedback-tile"
              Icon={MessageSquarePlus}
              title="Send Feedback"
              subtitle="Bug, idea, or feature request — every submission gets reviewed."
              accent="bg-[#E6F4EA] text-[#107C41]"
              onClick={() => document.dispatchEvent(new CustomEvent("open-feedback"))}
            />
          </div>

          {/* Pro tip */}
          <div className="bg-white border border-[#D4D4D4] rounded-xl p-3 shadow-sm flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#FFF3CD] flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-[#856404]" strokeWidth={2.5} />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold text-[#856404] uppercase tracking-wide">Tip of the shift</p>
              <p className="text-[12px] text-[#333] leading-snug">{proTip}</p>
            </div>
          </div>

          {/* Upgrade nudge (only if not Pro) */}
          {!isPro && (
            <div className="bg-gradient-to-r from-[#107C41] to-[#0D6535] text-white rounded-xl p-4 shadow-md flex items-center gap-3">
              <Crown className="w-8 h-8 flex-shrink-0" strokeWidth={2} />
              <div className="flex-1">
                <p className="text-sm font-bold">Cheaper than a coffee</p>
                <p className="text-[11px] opacity-90">$2.99/mo or $24.99/yr — every sheet, AI, Emergency SOPs, and jobs.</p>
              </div>
              <button onClick={() => navigate("/pricing")} className="bg-white text-[#0D6535] px-3 py-2 rounded text-sm font-bold hover:bg-[#F0F9F3]">
                Upgrade
              </button>
            </div>
          )}

          <p className="text-[10px] text-center text-[#595959] pt-4">
            Advisory only · Verify against site-specific ERP · API RP 5C7 · AER Directive 037 · CSA Z662
          </p>
        </div>
      </div>

      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} initialMode={aiMode} contextBuilder={() => ({ sheet_key: "HUB" })} />
    </div>
  );
};

export default Hub;
