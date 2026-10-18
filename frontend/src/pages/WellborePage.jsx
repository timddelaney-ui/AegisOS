import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line, Text, Grid } from "@react-three/drei";
import * as THREE from "three";
import { Phase1PageHeader } from "../components/Phase1Header";
import { useAuth, API } from "../context/AuthContext";
import { useActiveReel } from "../context/ActiveReelContext";
import { isSupervisorOrHigher } from "../lib/roles";
import { Upload, Play } from "lucide-react";

// Color-code a station by DLS (deg per 100 ft)
const dlsColor = (dls) => {
  if (dls == null) return "#0056B3";
  if (dls < 3) return "#FF6B1A";
  if (dls < 6) return "#CA8A04";
  if (dls < 10) return "#C36600";
  return "#C00000";
};

const SCALE = 1 / 50; // 50 ft per world unit

function Wellbore({ survey, depth }) {
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

  if (!points.length) return null;

  // Build colored line segments
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dls = survey.stations[i + 1]?.dls_deg_per_100ft ?? 0;
    segs.push({ a: points[i], b: points[i + 1], color: dlsColor(dls) });
  }

  return (
    <group>
      {segs.map((s, i) => (
        <Line key={i} points={[s.a, s.b]} color={s.color} lineWidth={3} />
      ))}
      {tip && (
        <mesh position={tip}>
          <sphereGeometry args={[0.5, 16, 16]} />
          <meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={0.5} />
        </mesh>
      )}
      {survey.stations.slice(0, 1).map((s, i) => (
        <Text key={i} position={[0, 0.5, 0]} fontSize={0.8} color="#0056B3">surface</Text>
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
  const canUpload = isSupervisorOrHigher(user);
  const [surveys, setSurveys] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [survey, setSurvey] = useState(null);
  const [file, setFile] = useState(null);
  const [wellName, setWellName] = useState("");
  const { currentDepth, setCurrentDepth } = useActiveReel();
  const [depth, setDepth] = useState(currentDepth || 0);

  const refresh = async () => {
    try {
      const r = await axios.get(`${API}/surveys`, { withCredentials: true });
      setSurveys(r.data?.surveys || []);
      setActiveId(r.data?.active_survey_id || r.data?.surveys?.[0]?.survey_id || null);
    } catch {}
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
    <div className="min-h-screen bg-[#F3F3F3]">
      <Phase1PageHeader title="3D Wellbore Viewer" subtitle={survey ? `${survey.well_name} · ${survey.stations?.length} stations · MD ${Math.round(maxMD)} ft` : "Upload a directional survey to render the well path."} />
      <div className="max-w-6xl mx-auto p-3 space-y-3">

        {canUpload && (
          <div className="bg-white border border-[#D4D4D4] rounded-lg p-3">
            <h3 className="text-sm font-bold mb-2 flex items-center gap-1"><Upload className="w-4 h-4" />Upload Survey (CSV)</h3>
            <p className="text-[10px] text-[#595959] mb-2">Columns: <code>md_ft, inc_deg, azi_deg</code> (TVD/N/E computed by minimum-curvature method).</p>
            <div className="flex gap-2 flex-wrap">
              <input data-testid="survey-name" placeholder="Well name" value={wellName} onChange={(e) => setWellName(e.target.value)} className="border rounded px-2 py-1 text-xs flex-1 min-w-[150px]" />
              <input data-testid="survey-file" type="file" accept=".csv,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs" />
              <button data-testid="survey-upload" onClick={upload} className="bg-[#0056B3] text-white px-2 py-1 text-xs font-bold rounded">Upload</button>
            </div>
          </div>
        )}

        {surveys.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {surveys.map((s) => (
              <button key={s.survey_id} data-testid={`select-survey-${s.survey_id}`}
                onClick={() => activate(s.survey_id)}
                className={`text-xs px-2 py-1 rounded font-bold ${s.survey_id === activeId ? "bg-[#FF6B1A] text-white" : "bg-white border border-[#D4D4D4]"}`}>
                {s.well_name} {s.survey_id === activeId && "·"} {s.stations?.length} stn
              </button>
            ))}
          </div>
        )}

        {survey && (
          <>
            <div className="bg-white border border-[#D4D4D4] rounded-lg p-2 flex items-center gap-3">
              <span className="text-xs font-bold text-[#595959]">Depth (ft)</span>
              <input data-testid="wellbore-depth" type="range" min={0} max={maxMD} value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="flex-1" />
              <span className="text-sm tabular-nums font-bold" data-testid="wellbore-depth-display">{Math.round(depth)}</span>
            </div>

            <div data-testid="wellbore-canvas" className="w-full h-[520px] bg-[#0D1A24] rounded-lg overflow-hidden">
              <Canvas camera={{ position: [40, 20, 40], fov: 50 }}>
                <ambientLight intensity={0.6} />
                <directionalLight position={[20, 30, 20]} intensity={0.8} />
                <Grid args={[40, 40]} position={[0, 0, 0]} cellColor="#334155" sectionColor="#64748b" />
                <Wellbore survey={survey} depth={depth} />
                <AutoRotate />
                <OrbitControls enablePan enableZoom enableRotate />
              </Canvas>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-[#595959] flex-wrap">
              <span className="font-bold uppercase">DLS legend</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dlsColor(1) }} /> &lt; 3°/100 ft</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dlsColor(5) }} /> 3–6°</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dlsColor(8) }} /> 6–10°</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: dlsColor(12) }} /> ≥ 10°</span>
            </div>
          </>
        )}

        {!survey && !canUpload && (
          <p className="text-sm text-[#595959] text-center py-8">No surveys yet. Ask a Supervisor to upload one.</p>
        )}
      </div>
    </div>
  );
}
