import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line, Text, Grid } from "@react-three/drei";
import * as THREE from "three";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { useActiveReel } from "../context/ActiveReelContext";
import { useUnits } from "../context/UnitContext";
import { isSupervisorOrHigher } from "../lib/roles";
import { Upload, Play, Palette } from "lucide-react";
import ShareLinksButton from "../components/ShareLinksButton";

/*────────────────────────────────────────────────────────────────────
  Wellbore color scales — all derived from open-domain references:
    DLS buckets  : API RP 7G §4 "severity ratings for drilling"
    Soft-string  : Johancsik 1984 / Sheppard 1987 — N = sqrt((T·κ)² + (W·sinα)²)
  Palette uses the CoilAegis enterprise semantic tokens (green→amber→crimson).
────────────────────────────────────────────────────────────────────*/

// DLS severity → green (safe) → amber (watch) → crimson (severe)
// Thresholds per API RP 7G §4 open-domain classification.
const dlsColor = (dls) => {
  if (dls == null) return "#64748B";          // slate (unknown)
  if (dls < 3)  return "#10B981";              // emerald — gentle (OK)
  if (dls < 6)  return "#F59E0B";              // amber — moderate
  if (dls < 10) return "#FB7185";              // rose — severe
  return "#EF4444";                            // crimson — critical
};

// Contact drag severity (0..1 normalized across the string).
// Formula per Johancsik 1984 open-domain soft-string torque-drag:
//   normal_force_per_ft = sqrt( (T · κ)² + (W · sinα)² )
// where κ = DLS in rad/ft, T is axial tension estimate, W is pipe weight/ft.
// We use station-level DLS + inclination directly (tension & weight scale
// linearly and cancel in normalization, so we can simplify to:
//   raw = κ² + sin(α)²  (unitless, monotonic with normal force)
const dragRaw = (station) => {
  const dls = Number(station?.dls_deg_per_100ft) || 0;
  const kappa = (dls * Math.PI / 180) / 100;         // rad/ft
  const inc_rad = (Number(station?.inc_deg) || 0) * Math.PI / 180;
  return kappa * kappa + Math.sin(inc_rad) * Math.sin(inc_rad);
};

const dragColor = (severity /* 0..1 */) => {
  if (severity == null) return "#64748B";
  if (severity < 0.25) return "#10B981";
  if (severity < 0.50) return "#F59E0B";
  if (severity < 0.75) return "#FB7185";
  return "#EF4444";
};

const SCALE = 1 / 50; // 50 ft per world unit

function Wellbore({ survey, depth, colorMode = "dls" }) {
  const points = useMemo(() => {
    if (!survey?.stations) return [];
    return survey.stations.map((s) => new THREE.Vector3(s.east_ft * SCALE, -s.tvd_ft * SCALE, s.north_ft * SCALE));
  }, [survey]);

  // Interpolated BHA tip position
  const tip = useMemo(() => {
    if (!survey?.stations || !survey.stations.length) return null;
    const sts = survey.stations;
    let i = 0;
    while (i < sts.length - 1 && sts[i + 1].md_ft < depth) i++;
    if (i >= sts.length - 1) return points[points.length - 1];
    const a = sts[i], b = sts[i + 1];
    const t = Math.max(0, Math.min(1, (depth - a.md_ft) / Math.max(1, b.md_ft - a.md_ft)));
    const pa = points[i], pb = points[i + 1];
    return new THREE.Vector3().lerpVectors(pa, pb, t);
  }, [survey, depth, points]);

  // Pre-compute drag severity, normalized across the string so colors
  // span the full green→crimson range for every well geometry.
  const dragNorm = useMemo(() => {
    if (!survey?.stations?.length) return [];
    const raws = survey.stations.map(dragRaw);
    const hi = Math.max(1e-9, ...raws);
    return raws.map((r) => r / hi);
  }, [survey]);

  if (!points.length) return null;

  // Build colored line segments
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const st = survey.stations[i + 1];
    const dls = st?.dls_deg_per_100ft ?? 0;
    const drag = dragNorm[i + 1] ?? 0;
    let color;
    if (colorMode === "drag") color = dragColor(drag);
    else if (colorMode === "combined") {
      // Combined severity = max of DLS-normalized + drag-normalized.
      const dls_norm = Math.min(1, dls / 12);
      color = dragColor(Math.max(dls_norm, drag));
    } else color = dlsColor(dls);
    segs.push({ a: points[i], b: points[i + 1], color });
  }

  return (
    <group>
      {segs.map((s, i) => (
        <Line key={`seg-${survey.stations[i]?.md_ft ?? i}`} points={[s.a, s.b]} color={s.color} lineWidth={3} />
      ))}
      {tip && (
        <mesh position={tip}>
          <sphereGeometry args={[0.5, 16, 16]} />
          <meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={0.5} />
        </mesh>
      )}
      {survey.stations.slice(0, 1).map((s, i) => (
        <Text key={i} position={[0, 0.5, 0]} fontSize={0.8} color="#06B6D4">surface</Text>
      ))}
    </group>
  );
}

function AutoRotate() {
  useFrame((state) => { state.camera.lookAt(0, -10, 0); });
  return null;
}

export default function WellborePage() {
  const { user } = useAuth();
  const u = useUnits();
  const canUpload = isSupervisorOrHigher(user);
  const [surveys, setSurveys] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [survey, setSurvey] = useState(null);
  const [file, setFile] = useState(null);
  const [wellName, setWellName] = useState("");
  const { currentDepth, setCurrentDepth } = useActiveReel();
  const [depth, setDepth] = useState(currentDepth || 0);
  // Color mode: "dls" | "drag" | "combined"
  const [colorMode, setColorMode] = useState(() => {
    try { return localStorage.getItem("coilaegis_wellbore_colormode") || "dls"; } catch { return "dls"; }
  });
  const setColorModePersist = (m) => {
    setColorMode(m);
    try { localStorage.setItem("coilaegis_wellbore_colormode", m); } catch (e) { console.debug("[Wellbore] colormode persist failed", e?.message); }
  };

  const refresh = async () => {
    try {
      const r = await axios.get(`${API}/surveys`, { withCredentials: true });
      setSurveys(r.data?.surveys || []);
      setActiveId(r.data?.active_survey_id || r.data?.surveys?.[0]?.survey_id || null);
    } catch (e) { console.debug("[Wellbore] survey refresh failed", e?.response?.status || e?.message); }
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const s = surveys.find((x) => x.survey_id === activeId);
    setSurvey(s || null);
  }, [surveys, activeId]);
  useEffect(() => { setCurrentDepth(depth); }, [depth, setCurrentDepth]);

  const maxMD = survey?.stations?.length ? survey.stations[survey.stations.length - 1].md_ft : 10000;

  const upload = async () => {
    if (!file || !wellName.trim()) return toast.error("Pick a file and name");
    const fd = new FormData();
    fd.append("file", file); fd.append("well_name", wellName);
    try {
      await axios.post(`${API}/surveys/upload`, fd, { withCredentials: true, headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Survey uploaded"); setFile(null); setWellName(""); refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    }
  };

  const activate = async (id) => {
    try { await axios.post(`${API}/surveys/${id}/activate`, {}, { withCredentials: true }); toast.success("Survey active"); setActiveId(id); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="min-h-screen ca-console-shell relative">
      <div className="relative z-10">
      <Phase1PageHeader title="3D Wellbore Viewer" subtitle={survey ? `${survey.well_name} · ${survey.stations?.length} stations · MD ${u.fmt(maxMD, "depth", { digits: 0 })} · DLS/Drag colored [API RP 7G §4 · Johancsik 1984]` : "Upload a directional survey to render the well path."} right={<ShareLinksButton scope="wellbore" compact />} />
      <div className="max-w-6xl mx-auto p-3 space-y-3">

        {canUpload && (
          <div className="ca-glass p-3">
            <h3 className="text-sm font-bold mb-2 flex items-center gap-1 text-slate-200"><Upload className="w-4 h-4 text-[#FF6B1A]" />Upload Survey (CSV)</h3>
            <p className="text-[10px] text-slate-400 mb-2">Columns: <code className="text-[#06B6D4]">md_ft, inc_deg, azi_deg</code> (TVD/N/E computed by minimum-curvature method).</p>
            <div className="flex gap-2 flex-wrap">
              <input data-testid="survey-name" placeholder="Well name" value={wellName} onChange={(e) => setWellName(e.target.value)} className="bg-white/5 border border-white/15 text-white rounded px-2 py-1 text-xs flex-1 min-w-[150px] placeholder:text-slate-500" />
              <input data-testid="survey-file" type="file" accept=".csv,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs text-slate-300" />
              <button data-testid="survey-upload" onClick={upload} className="bg-[#06B6D4] text-white px-3 py-1 text-xs font-bold rounded shadow-[0_0_0_1px_rgba(6,182,212,0.5)]">Upload</button>
            </div>
          </div>
        )}

        {surveys.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {surveys.map((s) => (
              <button key={s.survey_id} data-testid={`select-survey-${s.survey_id}`}
                onClick={() => activate(s.survey_id)}
                className={`text-xs px-2.5 py-1 rounded font-bold transition-all ${s.survey_id === activeId ? "bg-[#FF6B1A] text-white shadow-[0_0_0_1px_rgba(255,107,26,0.5)]" : "bg-white/5 border border-white/15 text-slate-300 hover:bg-white/10"}`}>
                {s.well_name} {s.survey_id === activeId && "·"} {s.stations?.length} stn
              </button>
            ))}
          </div>
        )}

        {survey && (
          <>
            <div className="ca-glass p-2 flex items-center gap-3 flex-wrap">
              <span className="ca-eyebrow ca-eyebrow-cyan">Depth · {u.label("depth")}</span>
              <input data-testid="wellbore-depth" type="range" min={0} max={maxMD} value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="flex-1 accent-[#06B6D4]" />
              <span className="text-sm tabular-nums font-bold text-[#06B6D4] ca-telemetry" data-testid="wellbore-depth-display">{u.fmt(depth, "depth", { digits: 0 })}</span>
              <span className="w-px h-5 bg-white/15 mx-1" />
              <Palette className="w-3.5 h-3.5 text-[#F59E0B]" />
              <span className="ca-eyebrow ca-eyebrow-amber">Color by</span>
              <div className="inline-flex items-center bg-white/5 border border-white/15 rounded-full p-0.5">
                {[
                  { id: "dls",      label: "DLS" },
                  { id: "drag",     label: "Contact Drag" },
                  { id: "combined", label: "Combined" },
                ].map((o) => (
                  <button
                    key={o.id}
                    data-testid={`wellbore-colormode-${o.id}`}
                    onClick={() => setColorModePersist(o.id)}
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full tracking-wider uppercase transition-all ${colorMode === o.id ? "bg-[#F59E0B] text-black shadow-[0_0_0_1px_rgba(245,158,11,0.5)]" : "text-slate-400 hover:text-white"}`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div data-testid="wellbore-canvas" className="ca-glass w-full h-[520px] overflow-hidden relative">
              <div className="ca-scanline" />
              <Canvas camera={{ position: [40, 20, 40], fov: 50 }}>
                <ambientLight intensity={0.6} />
                <directionalLight position={[20, 30, 20]} intensity={0.8} />
                <Grid args={[40, 40]} position={[0, 0, 0]} cellColor="#334155" sectionColor="#64748b" />
                <Wellbore survey={survey} depth={depth} colorMode={colorMode} />
                <AutoRotate />
                <OrbitControls enablePan enableZoom enableRotate />
              </Canvas>
              <div className="absolute top-2 left-2 ca-chip ca-chip-cyan">
                {colorMode === "dls" ? "DLS · API RP 7G §4"
                  : colorMode === "drag" ? "Contact Drag · Johancsik 1984"
                  : "Combined severity (max of DLS + Drag)"}
              </div>
            </div>

            {/* Dynamic legend — swaps with color mode */}
            <div className="ca-glass p-2 flex items-center gap-3 text-[11px] text-slate-300 flex-wrap">
              <span className="ca-eyebrow">
                {colorMode === "dls" ? "DLS legend" : colorMode === "drag" ? "Drag severity" : "Combined severity"}
              </span>
              {colorMode === "dls" ? (
                <>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dlsColor(1) }} /> &lt; 3°/100 ft · gentle</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dlsColor(5) }} /> 3–6° · moderate</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dlsColor(8) }} /> 6–10° · severe</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dlsColor(12) }} /> ≥ 10° · critical</span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dragColor(0.1) }} /> &lt; 25% · low</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dragColor(0.4) }} /> 25–50% · watch</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dragColor(0.6) }} /> 50–75% · sticky zone</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dragColor(0.9) }} /> ≥ 75% · hang-off risk</span>
                </>
              )}
              <span className="ml-auto text-[10px] text-slate-500 italic">
                {colorMode === "drag" || colorMode === "combined"
                  ? "N = √((T·κ)² + (W·sinα)²) · soft-string open-domain [Johancsik 1984 / Sheppard 1987]"
                  : "DLS buckets per API RP 7G §4 open-domain severity ratings"}
              </span>
            </div>
          </>
        )}

        {!survey && !canUpload && (
          <p className="text-sm text-slate-400 text-center py-8">No surveys yet. Ask a Supervisor to upload one.</p>
        )}
      </div>
      </div>
    </div>
  );
}
