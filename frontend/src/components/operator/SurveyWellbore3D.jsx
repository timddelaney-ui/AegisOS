import React, { useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Grid } from "@react-three/drei";
import * as THREE from "three";
import { stationAt, dlsColor } from "../../lib/surveyInterp";

// Fit the survey into a ~24-unit box, surface at y=+10
function useProjector(stations) {
  return useMemo(() => {
    const xs = stations.map((s) => s.east_ft || 0), zs = stations.map((s) => s.north_ft || 0), ys = stations.map((s) => s.tvd_ft || 0);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), Math.max(...ys), 1);
    const k = 30 / span, cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
    const project = (s) => new THREE.Vector3(((s.east_ft || 0) - cx) * k, 10 - (s.tvd_ft || 0) * k, ((s.north_ft || 0) - cz) * k);
    project.centerY = 10 - Math.max(...ys) * k * 0.62;
    return project;
  }, [stations]);
}

// Screen-constant label drawn into a canvas texture (no DOM roots — StrictMode safe)
function Label({ text, color, position }) {
  const { tex, aspect } = useMemo(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    ctx.font = "bold 22px monospace";
    const w = Math.ceil(ctx.measureText(text).width) + 20;
    c.width = w; c.height = 36;
    ctx.fillStyle = "rgba(15,23,42,0.92)"; ctx.fillRect(0, 0, w, 36);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, 34);
    ctx.fillStyle = "#F8FAFC"; ctx.font = "bold 22px monospace"; ctx.textBaseline = "middle"; ctx.fillText(text, 10, 19);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { tex: t, aspect: w / 36 };
  }, [text, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  const h = 0.045;
  return (
    <sprite position={position} scale={[h * aspect, h, 1]} renderOrder={10}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

export default function SurveyWellbore3D({ survey, depthFt, colorMode, plugs, bitLabel }) {
  const stations = survey.stations;
  const project = useProjector(stations);
  const pts = useMemo(() => stations.map(project), [stations, project]);
  const tip = project(stationAt(stations, depthFt));

  return (
    <Canvas camera={{ position: [20, project.centerY + 6, 20], fov: 42 }} dpr={[1, 2]} data-testid="survey-3d-canvas">
      <ambientLight intensity={0.7} />
      <directionalLight position={[20, 30, 20]} intensity={0.8} />
      <Grid args={[40, 40]} position={[0, 10, 0]} cellColor="#1E293B" sectionColor="#334155" fadeDistance={60} />
      {pts.slice(1).map((b, i) => (
        <Line key={`seg-${i}`} points={[pts[i], b]} lineWidth={3.5}
          color={colorMode === "Plain" ? "#38BDF8" : dlsColor(stations[i + 1].dls_deg_per_100ft ?? 0)} />
      ))}
      {plugs.reduce((acc, p) => {
        const pos = project(stationAt(stations, p.start));
        const prev = acc[acc.length - 1];
        const level = prev && prev.pos.distanceTo(pos) < 2.5 ? prev.level + 1 : 0;
        return [...acc, { p, pos, level }];
      }, []).map(({ p, pos, level }) => {
        return (
          <group key={p.id} position={pos}>
            <mesh><boxGeometry args={[0.35, 0.35, 0.35]} /><meshStandardMaterial color="#A855F7" emissive="#A855F7" emissiveIntensity={0.6} /></mesh>
            <Label text={p.name} color="#A855F7" position={[0, 0.9 + level * 1.1, 0]} />
          </group>
        );
      })}
      <mesh position={tip}>
        <sphereGeometry args={[0.5, 20, 20]} />
        <meshStandardMaterial color="#F97316" emissive="#F97316" emissiveIntensity={1} />
      </mesh>
      <Label text={bitLabel} color="#F97316" position={[tip.x, tip.y + 1.6, tip.z]} />
      <OrbitControls enablePan enableZoom enableRotate target={[0, project.centerY, 0]} />
    </Canvas>
  );
}
