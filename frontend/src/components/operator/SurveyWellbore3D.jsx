import React, { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Grid } from "@react-three/drei";
import * as THREE from "three";
import { stationAt, dlsColor } from "../../lib/surveyInterp";

const FOV = 40;

// Fit survey into a ~30-unit box; surface at y=+10
function useGeometry(stations) {
  return useMemo(() => {
    const xs = stations.map((s) => s.east_ft || 0), zs = stations.map((s) => s.north_ft || 0), ys = stations.map((s) => s.tvd_ft || 0);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), Math.max(...ys), 1);
    const k = 30 / span, cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
    const project = (s) => new THREE.Vector3(((s.east_ft || 0) - cx) * k, 10 - (s.tvd_ft || 0) * k, ((s.north_ft || 0) - cz) * k);
    const pts = stations.map(project);
    const box = new THREE.Box3().setFromPoints(pts);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 4);
    const head = pts[0], toe = pts[pts.length - 1];
    const lateral = new THREE.Vector3(toe.x - head.x, 0, toe.z - head.z);
    if (lateral.lengthSq() < 1e-6) lateral.set(1, 0, 0);
    lateral.normalize();
    return { project, pts, center, radius, floorY: box.min.y - 1.2, side: new THREE.Vector3(-lateral.z, 0.04, lateral.x).normalize() };
  }, [stations]);
}

function Label({ text, color, position, size = 0.042, dim = false }) {
  const { tex, aspect } = useMemo(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    ctx.font = "600 22px 'JetBrains Mono', monospace";
    const w = Math.ceil(ctx.measureText(text).width) + 22;
    c.width = w; c.height = 36;
    if (!dim) {
      ctx.fillStyle = "rgba(8,14,26,0.92)"; ctx.fillRect(0, 0, w, 36);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, 34);
    }
    ctx.fillStyle = dim ? color : "#F8FAFC"; ctx.font = "600 22px 'JetBrains Mono', monospace"; ctx.textBaseline = "middle"; ctx.fillText(text, 11, 19);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { tex: t, aspect: w / 36 };
  }, [text, color, dim]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]} renderOrder={10}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

// Tubing with per-vertex DLS colour + faint additive halo
function WellTube({ pts, stations, td, colorMode }) {
  const { core, halo } = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const segs = Math.min(800, pts.length * 24), radial = 14;
    const core = new THREE.TubeGeometry(curve, segs, 0.16, radial, false);
    const colors = [];
    const col = new THREE.Color();
    for (let i = 0; i <= segs; i++) {
      const st = stationAt(stations, (i / segs) * td);
      col.set(colorMode === "Plain" ? "#22D3EE" : dlsColor(st?.dls_deg_per_100ft ?? 0));
      for (let j = 0; j <= radial; j++) colors.push(col.r, col.g, col.b);
    }
    core.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const halo = new THREE.TubeGeometry(curve, segs, 0.42, 10, false);
    return { core, halo };
  }, [pts, stations, td, colorMode]);
  useEffect(() => () => { core.dispose(); halo.dispose(); }, [core, halo]);
  return (
    <group>
      <mesh geometry={core}><meshStandardMaterial vertexColors metalness={0.55} roughness={0.28} emissive="#0B3B44" emissiveIntensity={0.35} /></mesh>
      <mesh geometry={halo}><meshBasicMaterial color="#22D3EE" transparent opacity={0.07} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </group>
  );
}

function PlugRing({ position, tangent, name, level }) {
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent), [tangent]);
  return (
    <group position={position}>
      <mesh quaternion={quat}>
        <torusGeometry args={[0.34, 0.07, 12, 32]} />
        <meshStandardMaterial color="#A855F7" emissive="#A855F7" emissiveIntensity={0.9} metalness={0.3} roughness={0.4} />
      </mesh>
      <Label text={name} color="#A855F7" position={[0, 1.0 + level * 1.0, 0]} size={0.036} />
    </group>
  );
}

function Bit({ position, label }) {
  const halo = useRef();
  useFrame(({ clock }) => {
    if (!halo.current) return;
    const s = 1 + 0.25 * Math.sin(clock.elapsedTime * 3);
    halo.current.scale.setScalar(s);
    halo.current.material.opacity = 0.35 - 0.15 * Math.sin(clock.elapsedTime * 3);
  });
  return (
    <group position={position}>
      <mesh><sphereGeometry args={[0.34, 24, 24]} /><meshStandardMaterial color="#F97316" emissive="#F97316" emissiveIntensity={1.4} /></mesh>
      <mesh ref={halo}><sphereGeometry args={[0.62, 24, 24]} /><meshBasicMaterial color="#F97316" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
      <pointLight color="#F97316" intensity={6} distance={6} />
      <Label text={label} color="#F97316" position={[0, -1.3, 0]} size={0.046} />
    </group>
  );
}

// Applies view commands (3D/Side/Plan/Fit/Zoom bit/±) with eased transitions
function CameraRig({ geo, tip, command, orbit }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls);
  const goal = useRef(null);
  const view = useRef("3d");

  useEffect(() => {
    if (!controls || !command) return;
    const dist = (r) => (r / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 0.62;
    const dirFor = (v) => (v === "plan" ? new THREE.Vector3(0.0001, 1, 0.0001) : v === "side" ? geo.side.clone() : new THREE.Vector3(1, 0.55, 1).normalize());
    const cur = camera.position.clone().sub(controls.target);
    let target = geo.center.clone(), pos;
    if (["3d", "side", "plan"].includes(command.type)) view.current = command.type;
    if (["3d", "side", "plan", "fit"].includes(command.type)) pos = target.clone().add(dirFor(view.current).multiplyScalar(dist(geo.radius)));
    else if (command.type === "bit") { target = tip.clone(); pos = target.clone().add(cur.normalize().multiplyScalar(dist(geo.radius) * 0.22)); }
    else if (command.type === "in" || command.type === "out") {
      target = controls.target.clone();
      pos = target.clone().add(cur.multiplyScalar(command.type === "in" ? 0.75 : 1.33));
    }
    if (pos) goal.current = { pos, target };
  }, [command]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (controls) { controls.autoRotate = orbit; controls.autoRotateSpeed = 0.8; } }, [controls, orbit]);

  useFrame(() => {
    if (!goal.current || !controls) return;
    camera.position.lerp(goal.current.pos, 0.14);
    controls.target.lerp(goal.current.target, 0.14);
    controls.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.02) goal.current = null;
  });
  return null;
}

export default function SurveyWellbore3D({ survey, depthFt, colorMode, plugs, bitLabel, fmtDepth, tickStepFt, command, orbit }) {
  const stations = survey.stations;
  const td = stations[stations.length - 1].md_ft;
  const geo = useGeometry(stations);
  const tip = geo.project(stationAt(stations, depthFt));

  const ticks = useMemo(() => {
    const out = [];
    for (let md = tickStepFt; md < td - tickStepFt * 0.3; md += tickStepFt) out.push({ md, pos: geo.project(stationAt(stations, md)) });
    return out;
  }, [stations, td, tickStepFt, geo]);

  const rings = useMemo(() => plugs.reduce((acc, p) => {
    const pos = geo.project(stationAt(stations, p.start));
    const ahead = geo.project(stationAt(stations, Math.min(p.start + 30, td)));
    const back = geo.project(stationAt(stations, Math.max(p.start - 30, 0)));
    const tangent = ahead.sub(back).normalize();
    const prev = acc[acc.length - 1];
    const level = prev && prev.pos.distanceTo(pos) < 2.2 ? prev.level + 1 : 0;
    return [...acc, { p, pos, tangent, level }];
  }, []), [plugs, stations, td, geo]);

  const shadow = useMemo(() => geo.pts.map((v) => new THREE.Vector3(v.x, geo.floorY + 0.01, v.z)), [geo]);
  const startPos = useMemo(() => geo.center.clone().add(new THREE.Vector3(1, 0.55, 1).normalize().multiplyScalar((geo.radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 0.62)), [geo]);

  return (
    <Canvas camera={{ position: startPos.toArray(), fov: FOV, near: 0.1, far: 400 }} dpr={[1, 2]} gl={{ antialias: true }} data-testid="survey-3d-canvas">
      <color attach="background" args={["#070C14"]} />
      <fog attach="fog" args={["#070C14", geo.radius * 2.2, geo.radius * 6]} />
      <hemisphereLight args={["#94A3B8", "#0B1120", 0.55]} />
      <directionalLight position={[20, 40, 25]} intensity={1.1} />
      <directionalLight position={[-25, 10, -20]} intensity={0.35} color="#38BDF8" />

      <Grid args={[120, 120]} position={[geo.center.x, geo.floorY, geo.center.z]} cellSize={1} cellThickness={0.5} cellColor="#16213A" sectionSize={5} sectionThickness={1} sectionColor="#24324F" fadeDistance={geo.radius * 4} fadeStrength={1.5} infiniteGrid />
      <Line points={shadow} color="#334155" lineWidth={1.5} transparent opacity={0.7} />

      <mesh position={[geo.pts[0].x, geo.pts[0].y + 0.35, geo.pts[0].z]}>
        <cylinderGeometry args={[0.45, 0.55, 0.7, 20]} />
        <meshStandardMaterial color="#64748B" metalness={0.8} roughness={0.3} />
      </mesh>

      <WellTube pts={geo.pts} stations={stations} td={td} colorMode={colorMode} />

      {ticks.map((t) => (
        <group key={t.md} position={t.pos}>
          <mesh><sphereGeometry args={[0.2, 12, 12]} /><meshBasicMaterial color="#CBD5E1" /></mesh>
          <Label text={fmtDepth(t.md)} color="#94A3B8" position={[1.5, 0.5, 0]} size={0.032} dim />
        </group>
      ))}

      {rings.map(({ p, pos, tangent, level }) => <PlugRing key={p.id} position={pos} tangent={tangent} name={p.name} level={level} />)}
      <Bit position={tip} label={bitLabel} />

      <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={geo.center.toArray()} minDistance={1.5} maxDistance={geo.radius * 8} />
      <CameraRig geo={geo} tip={tip} command={command} orbit={orbit} />
    </Canvas>
  );
}
