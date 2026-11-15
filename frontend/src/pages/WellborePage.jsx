import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Upload, Users, Plus } from "lucide-react";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { useActiveReel } from "../context/ActiveReelContext";
import { isSupervisorOrHigher, isGuest } from "../lib/roles";
import ShareLinksButton from "../components/ShareLinksButton";
const SurveyRenderer = lazy(() => import("../components/operator/SurveyWellbore3D"));
const SurveyWellbore3D = (props) => <Suspense fallback={<div className="job-loading" role="status">Loading 3D viewer...</div>}><SurveyRenderer {...props} /></Suspense>;
import { ViewerToolbar, ZoomButtons } from "../components/operator/ViewerToolbar";
import { PlugManagerModal, PLUG_TYPES } from "../components/operator/PlugManagerModal";
import { useOperatorUnits } from "../components/operator/useOperatorUnits";
import { DEMO_WELLBORE } from "../lib/wellboreGeometry";
import { PLUGS } from "../lib/operatorConfig";
import { stationAt, surveyTD, DLS_WARN, DLS_CRIT } from "../lib/surveyInterp";

const errorMessage = (error, fallback) => typeof error?.response?.data?.detail === "string"
  ? error.response.data.detail : fallback;

export default function WellborePage() {
  const { user } = useAuth();
  const u = useOperatorUnits();
  const { currentDepth, setCurrentDepth } = useActiveReel();
  const canUpload = !isGuest(user) && (!user?.team_id || isSupervisorOrHigher(user));
  const [surveys, setSurveys] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [file, setFile] = useState(null);
  const [wellName, setWellName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [depth, setDepth] = useState(currentDepth || 14233);
  const [view, setView] = useState("3d");
  const [command, setCommand] = useState(null);
  const [orbit, setOrbit] = useState(false);
  const [plugRecords, setPlugRecords] = useState([]);
  const [canEditPlugs, setCanEditPlugs] = useState(false);
  const [managePlugs, setManagePlugs] = useState(false);
  const [selectedPlug, setSelectedPlug] = useState(null);
  const fileInput = useRef(null);
  const activeSurvey = useRef(activeId);
  activeSurvey.current = activeId;
  const [colorMode, setColorMode] = useState(() => {
    try { return localStorage.getItem("coilaegis_wellbore_colormode") || "dls"; }
    catch { return "dls"; }
  });
  const survey = surveys.find((item) => item.survey_id === activeId) || DEMO_WELLBORE;
  const isDemo = survey === DEMO_WELLBORE;
  const firstMD = survey.stations[0].md_ft;
  const maxMD = surveyTD(survey);
  const atBit = stationAt(survey.stations, depth);
  const plugs = useMemo(() => isDemo ? PLUGS.map((plug) => ({ ...plug, name: plug.id }))
    : plugRecords.map((plug) => ({
      id: plug.plug_id, name: plug.name, start: plug.top_md_ft, end: plug.bottom_md_ft, type: PLUG_TYPES[plug.plug_type],
    })), [isDemo, plugRecords]);

  const refresh = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/surveys`, { withCredentials: true });
      const list = (data.surveys || []).filter((item) => item.stations?.length > 1);
      setSurveys(list);
      setActiveId(data.active_survey_id || list[0]?.survey_id || null);
      setLoadError(null);
    } catch (error) {
      console.error("[Wellbore] survey load failed", error);
      setLoadError(errorMessage(error, "Could not load your saved surveys. The view below is a demo."));
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const loadPlugs = useCallback(async () => {
    if (isDemo) { setPlugRecords([]); setCanEditPlugs(false); return; }
    try {
      const { data } = await axios.get(`${API}/surveys/${activeId}/plugs`, { withCredentials: true });
      if (activeSurvey.current !== activeId) return;
      setPlugRecords(data.plugs || []);
      setCanEditPlugs(Boolean(data.can_edit));
    } catch (error) {
      if (activeSurvey.current === activeId) toast.error(errorMessage(error, "Could not load the well's plug records."));
    }
  }, [activeId, isDemo]);
  useEffect(() => { setPlugRecords([]); setSelectedPlug(null); setCanEditPlugs(false); setManagePlugs(false); loadPlugs(); }, [loadPlugs]);
  useEffect(() => { setDepth((value) => Math.max(firstMD, Math.min(value, maxMD))); }, [activeId, firstMD, maxMD]);
  useEffect(() => { if (!isDemo) setCurrentDepth(depth); }, [depth, isDemo, setCurrentDepth]);

  const sendCommand = (type) => {
    if (["3d", "side", "plan"].includes(type)) {
      setView(type);
      if (type !== "3d") setOrbit(false);
    }
    setCommand((previous) => ({ type, n: (previous?.n || 0) + 1 }));
  };
  const selectSurvey = async (id) => {
    if (id === DEMO_WELLBORE.survey_id) { setActiveId(id); return; }
    const selected = surveys.find((item) => item.survey_id === id);
    const canActivate = isSupervisorOrHigher(user) || selected?.team_id === `personal:${user.user_id}`;
    if (canActivate) {
      try { await axios.post(`${API}/surveys/${id}/activate`, {}, { withCredentials: true }); }
      catch (error) { toast.error(errorMessage(error, "Could not activate this survey.")); return; }
    }
    setActiveId(id);
  };

  const upload = async () => {
    if (!file || !wellName.trim()) { toast.error("Choose a CSV and enter the well name."); return; }
    if (!/\.(csv|txt)$/i.test(file.name)) { toast.error("This upload needs a survey CSV, not a PDF job program."); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error("Survey files must be 4 MB or smaller."); return; }
    const data = new FormData();
    data.append("file", file);
    data.append("well_name", wellName.trim());
    setUploading(true);
    try {
      const response = await axios.post(`${API}/surveys/upload`, data, { withCredentials: true });
      await axios.post(`${API}/surveys/${response.data.survey_id}/activate`, {}, { withCredentials: true });
      toast.success(user?.team_id ? "Survey saved to your team." : "Survey saved privately to your account.");
      setFile(null); setWellName("");
      if (fileInput.current) fileInput.current.value = "";
      await refresh();
    } catch (error) { toast.error(errorMessage(error, "Could not save the survey.")); }
    finally { setUploading(false); }
  };

  const savePlug = async (id, body) => {
    try {
      if (id) await axios.put(`${API}/plugs/${id}`, body, { withCredentials: true });
      else await axios.post(`${API}/surveys/${activeId}/plugs`, body, { withCredentials: true });
      toast.success("Plug saved."); await loadPlugs(); setSelectedPlug(null); return true;
    } catch (error) { toast.error(errorMessage(error, "Could not save the plug.")); return false; }
  };
  const deletePlug = async (id) => {
    try {
      await axios.delete(`${API}/plugs/${id}`, { withCredentials: true });
      toast.success("Plug deleted."); await loadPlugs(); setSelectedPlug(null);
    } catch (error) { toast.error(errorMessage(error, "Could not delete the plug.")); }
  };
  const tickStepFt = (u.isMetric ? 500 / 0.3048 : 2000);

  return (
    <div className="min-h-screen ca-console-shell text-slate-100">
      <Phase1PageHeader title="Wellbore & Plugs" subtitle="Explore the well path, locate plugs and inspect the bit."
        right={!isDemo && user?.team_id === survey.team_id && user?.team_id ? <ShareLinksButton scope="wellbore" compact /> : null} />
      <div className="max-w-6xl mx-auto p-3 space-y-4 pb-24">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className={isDemo ? "text-amber-300" : "text-emerald-300"}>
            {isDemo ? "DEMO — illustrative geometry, not a live well" : `${survey.well_name} · ${survey.stations.length} survey stations`}
          </span>
          <Link to="/team" className="inline-flex items-center gap-2 text-cyan-300"><Users className="w-4 h-4" />{user?.team_id ? "Manage teammates" : "Add a teammate (optional)"}</Link>
        </div>
        {loadError && <div role="alert" className="text-sm text-red-300">{loadError} <button className="underline" onClick={refresh}>Retry</button></div>}
        <section className="rounded-2xl border border-slate-700 bg-[#0D1520] p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Wellbore and plugs</h2>
            <select aria-label="Well survey" value={survey.survey_id} onChange={(event) => selectSurvey(event.target.value)} className="max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
              <option value={DEMO_WELLBORE.survey_id}>Demo horizontal well</option>
              {surveys.map((item) => <option key={item.survey_id} value={item.survey_id}>{item.well_name}</option>)}
            </select>
          </div>
          <ViewerToolbar view={view} orbit={orbit} onCmd={sendCommand} onOrbit={() => setOrbit((value) => !value)} />
          <div className="flex flex-wrap items-center gap-2">
            {[["dls", "DLS"], ["Plain", "Plain"], ["drag", "Contact index"], ["combined", "Combined"]].map(([id, label]) => (
              <button key={id} data-testid={`wellbore-colormode-${id}`} onClick={() => {
                setColorMode(id);
                try { localStorage.setItem("coilaegis_wellbore_colormode", id); }
                catch (error) { console.debug("[Wellbore] color preference could not be saved", error); }
              }} className={`rounded-lg border px-3 py-2 text-xs ${colorMode === id ? "bg-cyan-500 text-slate-950 border-cyan-500" : "border-slate-700 text-slate-300"}`}>{label}</button>
            ))}
          </div>
          <div data-testid="wellbore-canvas" className="relative h-[32rem] md:h-[38rem] rounded-xl border border-slate-700 overflow-hidden bg-[#070C14]">
            <SurveyWellbore3D survey={survey} depthFt={depth} plugs={plugs} bitLabel={`BIT ${u.show(depth, "depth", 1)} ${u.label("depth")}`}
              colorMode={colorMode} fmtDepth={(md) => u.show(md, "depth", 0)} tickStepFt={tickStepFt} command={command} orbit={orbit}
              selectedPlugId={selectedPlug?.id} onSelectPlug={setSelectedPlug} />
            <div className="pointer-events-none absolute top-3 left-3 rounded-xl border border-slate-700 bg-slate-950/85 backdrop-blur p-3 text-xs space-y-1">
              <p className="text-orange-400 font-bold uppercase">At bit{isDemo ? " · demo" : ""}</p>
              <p>MD <b className="font-mono">{u.show(depth, "depth", 1)} {u.label("depth")}</b></p>
              <p>TVD <b className="font-mono">{u.show(atBit.tvd_ft, "depth", 1)} {u.label("depth")}</b></p>
              <p>Incl <b className="font-mono">{atBit.inc_deg.toFixed(1)}°</b></p>
              <p>DLS <b className="font-mono">{u.show(atBit.dls_deg_per_100ft, "dls", 2)} {u.label("dls")}</b></p>
            </div>
            <ZoomButtons onCmd={sendCommand} />
          </div>
          <label className="flex flex-wrap items-center gap-3 text-xs">
            Inspect depth
            <input aria-label="Inspect measured depth" data-testid="wellbore-depth" type="range" min={firstMD} max={maxMD} value={depth} step={1} onChange={(event) => setDepth(Number(event.target.value))} className="flex-1 min-w-[140px] accent-orange-500" />
            <b data-testid="wellbore-depth-display">{u.show(depth, "depth", 1)} {u.label("depth")}</b>
          </label>
          <div className="flex flex-wrap gap-3 text-xs text-slate-300">
            {colorMode === "dls" ? <>
              <span>DLS {u.label("dls")}</span>
              <span className="text-emerald-400">&lt; {u.show(DLS_WARN, "dls", 1)}</span>
              <span className="text-amber-400">{u.show(DLS_WARN, "dls", 1)}–{u.show(DLS_CRIT, "dls", 1)}</span>
              <span className="text-red-400">≥ {u.show(DLS_CRIT, "dls", 1)}</span>
            </> : colorMode === "Plain" ? <span>Plain trajectory coloring.</span>
              : <span>Relative contact index only, not a drag-force calculation. Green &lt;25%, amber 25–50%, pink 50–75%, red ≥75%.</span>}
          </div>
          <p className="text-[11px] text-slate-500">Drag to rotate in 3D; pinch to zoom. Tap a purple plug to inspect it. Color bands are visual guides, not operating limits.</p>
          {selectedPlug && <p role="status" className="rounded-lg bg-purple-500/10 p-3 text-sm text-purple-200"><b>{selectedPlug.name}</b> · {u.show(selectedPlug.start, "depth", 1)}–{u.show(selectedPlug.end, "depth", 1)} {u.label("depth")}</p>}
          {!isDemo && <button onClick={() => setManagePlugs(true)} className="flex items-center gap-2 rounded-lg border border-purple-500/40 px-3 py-2 text-xs text-purple-200"><Plus className="w-4 h-4" />{canEditPlugs ? "Manage plugs" : "View plug records"} · {plugs.length}</button>}
        </section>
        {canUpload && <details className="ca-glass p-4" open={isDemo && !surveys.length}>
          <summary className="cursor-pointer text-sm font-bold"><Upload className="inline w-4 h-4 mr-2 text-orange-400" />Upload your survey</summary>
          <p className="my-3 text-xs text-slate-400">CSV columns: <code>md_ft, inc_deg, azi_deg</code>. Depths must be feet. PDFs and job programs are not survey CSVs. {user?.team_id ? "Saved to your team workspace." : "Saved privately to your account; no team required."}</p>
          <div className="flex flex-wrap gap-3">
            <input aria-label="Well name" data-testid="survey-name" value={wellName} onChange={(event) => setWellName(event.target.value)} placeholder="Well name" className="min-w-0 w-full sm:flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            <input aria-label="Survey CSV file" ref={fileInput} data-testid="survey-file" type="file" accept=".csv,.txt" onChange={(event) => setFile(event.target.files?.[0] || null)} className="max-w-full text-xs" />
            <button data-testid="survey-upload" onClick={upload} disabled={uploading} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold disabled:opacity-50">{uploading ? "Saving..." : "Save survey"}</button>
          </div>
        </details>}
      </div>
      {managePlugs && !isDemo && <PlugManagerModal plugs={plugRecords} canEdit={canEditPlugs} wellName={survey.well_name}
        depthLabel={u.label("depth")} toFt={(value) => u.isMetric ? u.to(value, "depth") : value} fromFt={(value) => u.val(value, "depth")}
        onSave={savePlug} onDelete={deletePlug} onClose={() => setManagePlugs(false)} />}
    </div>
  );
}
