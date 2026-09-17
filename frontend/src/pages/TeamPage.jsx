import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "../context/AuthContext";
import { ArrowLeft, Users, Copy, Check, LogOut, Plus, Loader2, MessageSquare, Package, Beaker, Wrench, ListChecks, FileText } from "lucide-react";
import CrewChat from "../components/CrewChat";
import TeamItemsList from "../components/TeamItemsList";
import RigChecklists from "../components/RigChecklists";
import RigSelector from "../components/RigSelector";
import HandoverModal from "../components/HandoverModal";
import { useRig, rigLabel } from "../context/RigContext";

const HUB_TABS = [
  { id: "chat",        label: "Crew Chat",   Icon: MessageSquare, badge: "chat",      color: "#0D6535", sub: "Team messages, Skipper AI, safety alerts" },
  { id: "rig",         label: "Rig Checks",  Icon: ListChecks,    badge: "checklist", color: "#C00000", sub: "Safety / Ops / PM check-offs" },
  { id: "inventory",   label: "Inventory",   Icon: Package,       color: "#856404",   sub: "Stock levels, locations" },
  { id: "consumables", label: "Consumables", Icon: Beaker,        color: "#7C3AED",   sub: "Fluids, additives, chemistry" },
  { id: "parts_order", label: "Parts Order", Icon: Wrench,        color: "#C36600",   sub: "Requested / ordered / received" },
  { id: "todo",        label: "To-Do List",  Icon: ListChecks,    color: "#0056B3",   sub: "Open jobs, priority, due dates" },
];

const TeamPage = () => {
  const navigate = useNavigate();
  const { user, checkAuth } = useAuth();
  const { rigId, unreadFor, markSeen } = useRig();
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("choose"); // choose | create | join
  const [teamName, setTeamName] = useState("");
  const [hubTab, setHubTab] = useState(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const unread = unreadFor(rigId);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/teams/me`, { withCredentials: true });
      setTeam(data);
    } catch (e) { setTeam(null); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const createTeam = async () => {
    if (!teamName.trim()) return;
    setSubmitting(true); setError(null);
    try {
      await axios.post(`${API}/teams`, { name: teamName.trim() }, { withCredentials: true });
      await checkAuth();
      await load();
      setMode("choose");
    } catch (e) { setError(e.response?.data?.detail || "Failed to create team"); }
    setSubmitting(false);
  };

  const joinTeam = async () => {
    if (!inviteCode.trim()) return;
    setSubmitting(true); setError(null);
    try {
      await axios.post(`${API}/teams/join`, { invite_code: inviteCode.trim().toUpperCase() }, { withCredentials: true });
      await checkAuth();
      await load();
      setMode("choose");
    } catch (e) { setError(e.response?.data?.detail || "Invalid invite code"); }
    setSubmitting(false);
  };

  const leaveTeam = async () => {
    if (!window.confirm("Leave this team? You can rejoin with the invite code later.")) return;
    await axios.post(`${API}/teams/leave`, {}, { withCredentials: true });
    await checkAuth();
    setTeam(null);
  };

  const copyCode = () => {
    if (!team) return;
    navigator.clipboard.writeText(team.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col">
      <header className="bg-[#107C41] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0">
        <button onClick={() => navigate("/app")} className="flex items-center gap-1.5 text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-sm font-semibold ml-4">Crew / Team</h1>
      </header>
      <RigSelector />

      <div className="flex-1 p-4 pb-10 overflow-auto">
        <div className="max-w-xl mx-auto">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#107C41]" /></div>
          ) : team ? (
            <>
            <div className="bg-white border border-[#D4D4D4] rounded-lg shadow-sm p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded bg-[#107C41] flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[#262626]">{team.name}</h2>
                  <p className="text-xs text-[#595959]">{team.members?.length || 0} member{(team.members?.length || 0) !== 1 ? "s" : ""}</p>
                </div>
              </div>

              <div className="bg-[#F8F9FA] border border-[#D4D4D4] rounded p-3 mb-4">
                <p className="text-[11px] text-[#595959] font-semibold uppercase mb-1">Invite Code</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-lg font-mono font-bold text-[#107C41] tracking-wider">{team.invite_code}</code>
                  <button onClick={copyCode} className="flex items-center gap-1 bg-white border border-[#D4D4D4] hover:border-[#107C41] px-2.5 py-1.5 rounded text-xs font-semibold text-[#444]">
                    {copied ? <><Check className="w-3.5 h-3.5 text-[#107C41]" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                </div>
                <p className="text-[11px] text-[#595959] mt-2">Share this code with crew members so they can join.</p>
              </div>

              <div>
                <h3 className="text-xs font-bold text-[#444] uppercase mb-2">Members</h3>
                <div className="space-y-1.5">
                  {(team.members || []).map((m) => (
                    <div key={m.user_id} className="flex items-center gap-2 bg-[#FAFAFA] border border-[#EFEFEF] rounded px-2.5 py-2">
                      {m.picture ? <img src={m.picture} alt={m.name} className="w-6 h-6 rounded-full" /> : <div className="w-6 h-6 rounded-full bg-[#D4D4D4] flex items-center justify-center text-[10px] font-bold text-[#595959]">{m.name?.charAt(0)}</div>}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#262626] truncate">{m.name}{m.user_id === team.owner_id ? " (Owner)" : ""}</p>
                        <p className="text-[11px] text-[#595959] truncate">{m.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={leaveTeam} className="mt-5 w-full flex items-center justify-center gap-2 border border-[#F5C6CB] hover:bg-[#FFF5F5] text-[#C00000] py-2 rounded text-sm font-semibold">
                <LogOut className="w-4 h-4" /> Leave Team
              </button>
            </div>

            {/* TEAM HUB — big tap-friendly tiles instead of a cramped tab strip */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#595959]">
                  {rigLabel(rigId)} Hub
                </div>
                <button
                  data-testid="open-handover"
                  onClick={() => setHandoverOpen(true)}
                  className="text-[11px] font-bold text-white bg-[#0D6535] hover:bg-[#0A4F28] px-2.5 py-1 rounded flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" strokeWidth={2.5} />
                  Generate Handover
                </button>
              </div>

              {!hubTab && (
                <div data-testid="team-hub-tiles" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {HUB_TABS.map((t) => {
                    const Icon = t.Icon;
                    const showDot = t.badge && unread[t.badge];
                    return (
                      <button
                        key={t.id}
                        data-testid={`team-hub-tile-${t.id}`}
                        onClick={() => {
                          setHubTab(t.id);
                          if (t.badge) markSeen(rigId, t.badge);
                        }}
                        className="relative group bg-white border border-[#D4D4D4] hover:border-[#107C41] hover:shadow-md hover:-translate-y-0.5 transition-all rounded-xl p-3 sm:p-4 text-left overflow-hidden"
                        style={{ borderTop: `3px solid ${t.color || "#107C41"}` }}
                      >
                        <div className="flex items-start gap-2">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${t.color || "#107C41"}18`, color: t.color || "#107C41" }}>
                            <Icon className="w-5 h-5" strokeWidth={2.5} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-bold text-[#262626] leading-tight">{t.label}</div>
                            <div className="text-[10px] text-[#595959] mt-0.5">{t.sub}</div>
                          </div>
                          {showDot && (
                            <span data-testid={`hub-tile-unread-${t.id}`} className="w-2 h-2 rounded-full bg-[#DC2626] animate-pulse absolute top-2 right-2" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {hubTab && (
                <>
                  <div className="flex items-center justify-between mb-2 mt-1">
                    <button
                      data-testid="team-hub-back-to-tiles"
                      onClick={() => setHubTab(null)}
                      className="text-[12px] font-semibold text-[#0D6535] hover:underline flex items-center gap-1"
                    >
                      ← All Hub sections
                    </button>
                    <div className="flex items-center gap-2">
                      {HUB_TABS.map((t) => {
                        const active = hubTab === t.id;
                        const Icon = t.Icon;
                        const showDot = !active && t.badge && unread[t.badge];
                        return (
                          <button
                            key={t.id}
                            data-testid={`team-hub-quicktab-${t.id}`}
                            onClick={() => {
                              setHubTab(t.id);
                              if (t.badge) markSeen(rigId, t.badge);
                            }}
                            title={t.label}
                            className={`relative w-8 h-8 rounded flex items-center justify-center transition-colors ${active ? "text-white" : "text-[#595959] hover:bg-[#F0F9F3]"}`}
                            style={active ? { background: t.color || "#107C41" } : {}}
                          >
                            <Icon className="w-4 h-4" strokeWidth={2.5} />
                            {showDot && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#DC2626]" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="bg-white border border-[#D4D4D4] rounded-lg p-2">
                    {hubTab === "chat" && <CrewChat currentUserId={user?.user_id} />}
                    {hubTab === "rig" && <RigChecklists />}
                    {hubTab !== "chat" && hubTab !== "rig" && <TeamItemsList kind={hubTab} />}
                  </div>
                </>
              )}
            </div>
            <HandoverModal open={handoverOpen} onClose={() => setHandoverOpen(false)} />
            </>
          ) : mode === "choose" ? (
            <div className="space-y-3">
              <div className="bg-white border border-[#D4D4D4] rounded-lg p-5 text-center">
                <Users className="w-10 h-10 text-[#107C41] mx-auto mb-2" strokeWidth={2} />
                <h2 className="text-lg font-bold text-[#262626] mb-1">Work with your crew</h2>
                <p className="text-sm text-[#595959] mb-4">Create a team to share jobs with tool pushes, supervisors, and operators.</p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => setMode("create")} className="w-full bg-[#107C41] hover:bg-[#0D6535] text-white py-2.5 rounded font-semibold text-sm flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" /> Create a Team
                  </button>
                  <button onClick={() => setMode("join")} className="w-full bg-white border border-[#D4D4D4] hover:border-[#107C41] text-[#262626] py-2.5 rounded font-semibold text-sm">
                    Join with Invite Code
                  </button>
                </div>
              </div>
            </div>
          ) : mode === "create" ? (
            <div className="bg-white border border-[#D4D4D4] rounded-lg p-5">
              <h2 className="text-lg font-bold mb-3">Create a Team</h2>
              <label className="text-xs font-semibold text-[#444] block mb-1">Team name</label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Precision CT Crew A"
                className="w-full bg-[#FAFAFA] border border-[#CCC] px-3 py-2 rounded text-sm outline-none focus:border-[#107C41] focus:ring-2 focus:ring-[#107C41]/10"
              />
              {error && <p className="text-xs text-[#C00000] mt-2">{error}</p>}
              <div className="flex gap-2 mt-4">
                <button onClick={() => setMode("choose")} className="flex-1 border border-[#D4D4D4] text-[#444] py-2 rounded text-sm font-semibold">Cancel</button>
                <button onClick={createTeam} disabled={submitting} className="flex-1 bg-[#107C41] hover:bg-[#0D6535] text-white py-2 rounded text-sm font-semibold flex items-center justify-center gap-2">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Create
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-[#D4D4D4] rounded-lg p-5">
              <h2 className="text-lg font-bold mb-3">Join a Team</h2>
              <label className="text-xs font-semibold text-[#444] block mb-1">Invite Code</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="ABC12XYZ"
                maxLength={12}
                className="w-full bg-[#FAFAFA] border border-[#CCC] px-3 py-2 rounded text-sm font-mono tracking-wider uppercase outline-none focus:border-[#107C41] focus:ring-2 focus:ring-[#107C41]/10"
              />
              {error && <p className="text-xs text-[#C00000] mt-2">{error}</p>}
              <div className="flex gap-2 mt-4">
                <button onClick={() => setMode("choose")} className="flex-1 border border-[#D4D4D4] text-[#444] py-2 rounded text-sm font-semibold">Cancel</button>
                <button onClick={joinTeam} disabled={submitting} className="flex-1 bg-[#107C41] hover:bg-[#0D6535] text-white py-2 rounded text-sm font-semibold flex items-center justify-center gap-2">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Join
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeamPage;
