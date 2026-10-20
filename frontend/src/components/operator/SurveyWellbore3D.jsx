import React, { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Grid, Html } from "@react-three/drei";
import * as THREE from "three";
import { stationAt, dlsColor } from "../../lib/surveyInterp";

// Fit the survey into a ~24-unit box, surface at y=+10
function useProjector(stations) {
  return useMemo(() => {
    const xs = stations.map((s) => s.east_ft || 0), zs = stations.map((s) => s.north_ft || 0), ys = stations.map((s) => s.tvd_ft || 0);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), Math.max(...ys), 1);
    const k = 24 / span, cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
    return (s) => new THREE.Vector3(((s.east_ft || 0) - cx) * k, 10 - (s.tvd_ft || 0) * k, ((s.north_ft || 0) - cz) * k);
  }, [stations]);
}

const Tag = ({ children, color, testId }) => (
  <div data-testid={testId} className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap pointer-events-none"
    style={{ background: "rgba(15,23,42,0.92)", border: `1px solid ${color}`, color: "#F8FAFC" }}>{children}</div>
);

export default function SurveyWellbore3D({ survey, depthFt, colorMode, plugs, bitLabel }) {
  const stations = survey.stations;
  const project = useProjector(stations);
  const pts = useMemo(() => stations.map(project), [stations, project]);
  const tip = project(stationAt(stations, depthFt));

  return (
    <Canvas camera={{ position: [24, 6, 24], fov: 45 }} dpr={[1, 2]} data-testid="survey-3d-canvas">
      <ambientLight intensity={0.7} />
      <directionalLight position={[20, 30, 20]} intensity={0.8} />
      <Grid args={[40, 40]} position={[0, 10, 0]} cellColor="#1E293B" sectionColor="#334155" fadeDistance={60} />
      {pts.slice(1).map((b, i) => (
        <Line key={`seg-${i}`} points={[pts[i], b]} lineWidth={3.5}
          color={colorMode === "Plain" ? "#38BDF8" : dlsColor(stations[i + 1].dls_deg_per_100ft ?? 0)} />
      ))}
      {plugs.map((p) => {
        const pos = project(stationAt(stations, p.start));
        return (
          <group key={p.id} position={pos}>
            <mesh><boxGeometry args={[0.35, 0.35, 0.35]} /><meshStandardMaterial color="#A855F7" emissive="#A855F7" emissiveIntensity={0.6} /></mesh>
            <Html center distanceFactor={18} position={[0, 0.9, 0]}><Tag color="#A855F7" testId={`plug-pin-${p.id}`}>{p.id}</Tag></Html>
          </group>
        );
      })}
      <mesh position={tip}>
        <sphereGeometry args={[0.5, 20, 20]} />
        <meshStandardMaterial color="#F97316" emissive="#F97316" emissiveIntensity={1} />
      </mesh>
      <Html position={[tip.x, tip.y + 1.4, tip.z]} center distanceFactor={18}><Tag color="#F97316" testId="bit-3d-label">{bitLabel}</Tag></Html>
      <OrbitControls enablePan enableZoom enableRotate target={[0, 10 - 12, 0]} />
    </Canvas>
  );
}
