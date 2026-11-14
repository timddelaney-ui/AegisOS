import React, { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Grid } from "@react-three/drei";
import * as THREE from "three";
import { stationAt, dlsColor } from "../../lib/surveyInterp";
import { buildWellboreGeometry, fitWellboreCamera, wellboreTicks } from "../../lib/wellboreGeometry";
import ErrorBoundary from "../ErrorBoundary";

const FOV = 40;

function useGeometry(stations) {
  return useMemo(() => {
    const model = buildWellboreGeometry(stations);
    return {
      ...model,
      project: (station) => new THREE.Vector3(...model.project(station)),
      pts: model.points.map((point) => new THREE.Vector3(...point)),
      center: new THREE.Vector3(),
      side: new THREE.Vector3(...model.side),
    };
  }, [stations]);
}

class SurveyCurve extends THREE.Curve {
  constructor(stations, geo) {
    super();
    this.stations = stations;
    this.geo = geo;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const md = this.geo.firstMD + t * (this.geo.lastMD - this.geo.firstMD);
    return target.copy(this.geo.project(stationAt(this.stations, md)));
  }
}

function Label({ text, color, position, size = 0.042, dim = false, anchor = [0.5, 0.5] }) {
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
    <sprite position={position} center={anchor} scale={[size * aspect, size, 1]} renderOrder={10}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

// Tubing with per-vertex DLS colour + faint additive halo
function WellTube({ geo, stations, colorMode }) {
  const { core, halo } = useMemo(() => {
    const curve = new SurveyCurve(stations, geo);
    const segs = Math.min(1200, Math.max(320, stations.length * 8)), radial = 12;
    const core = new THREE.TubeGeometry(curve, segs, 0.16, radial, false);
    const colors = [];
    const col = new THREE.Color();
    const contactRaw = (station) => {
      const kappa = ((station?.dls_deg_per_100ft || 0) * Math.PI / 180) / 100;
      return kappa * kappa + Math.sin((station?.inc_deg || 0) * Math.PI / 180) ** 2;
    };
    const maxContact = Math.max(1e-9, ...stations.map(contactRaw));
    for (let i = 0; i <= segs; i++) {
      const st = stationAt(stations, geo.firstMD + (i / segs) * (geo.lastMD - geo.firstMD));
      const contact = contactRaw(st) / maxContact;
      const severity = colorMode === "combined" ? Math.max(contact, (st?.dls_deg_per_100ft || 0) / 12) : contact;
      col.set(colorMode === "Plain" ? "#22D3EE"
        : colorMode === "drag" || colorMode === "combined"
          ? severity < 0.25 ? "#10B981" : severity < 0.5 ? "#F59E0B" : severity < 0.75 ? "#FB7185" : "#EF4444"
          : dlsColor(st?.dls_deg_per_100ft ?? 0));
      for (let j = 0; j <= radial; j++) colors.push(col.r, col.g, col.b);
    }
    core.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const halo = new THREE.TubeGeometry(curve, segs, 0.26, 8, false);
    return { core, halo };
  }, [geo, stations, colorMode]);
  useEffect(() => () => { core.dispose(); halo.dispose(); }, [core, halo]);
  return (
    <group>
      <mesh geometry={core}><meshStandardMaterial vertexColors metalness={0.55} roughness={0.28} emissive="#0B3B44" emissiveIntensity={0.35} /></mesh>
      <mesh geometry={halo}><meshBasicMaterial color="#22D3EE" transparent opacity={0.07} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </group>
  );
}

function PlugRing({ position, tangent, name, level, selected, onSelect }) {
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent), [tangent]);
  return (
    <group position={position} onClick={(event) => { event.stopPropagation(); onSelect?.(); }}>
      <mesh quaternion={quat}>
        <torusGeometry args={[selected ? 0.46 : 0.34, 0.09, 12, 24]} />
        <meshStandardMaterial color={selected ? "#E9D5FF" : "#A855F7"} emissive="#A855F7" emissiveIntensity={0.9} metalness={0.3} roughness={0.4} />
      </mesh>
      <Label text={name} color="#A855F7" position={[0, 0, 0]} anchor={[0.5, -0.6 - level * 1.15]} size={0.04} />
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
      <Label text={label} color="#F97316" position={[0, 0, 0]} anchor={[1.1, -0.8]} size={0.046} />
    </group>
  );
}

// Applies view commands (3D/Side/Plan/Fit/Zoom bit/±) with eased transitions
function CameraRig({ geo, tip, command, orbit }) {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls);
  const goal = useRef(null);
  const view = useRef("3d");
  const lastCommand = useRef(null);

  useEffect(() => {
    if (!controls) return;
    const type = command && command !== lastCommand.current ? command.type : "fit";
    lastCommand.current = command;
    if (["3d", "side", "plan"].includes(type)) view.current = type;
    const direction = view.current === "plan" ? [0, 1, 0] : view.current === "side" ? geo.side.toArray() : [1, 0.55, 1];
    const fitted = fitWellboreCamera(geo.points, direction, size.width / Math.max(size.height, 1), FOV);
    camera.up.set(...fitted.up);
    camera.far = Math.max(400, fitted.distance * 4);
    camera.updateProjectionMatrix();
    controls.enableRotate = view.current === "3d";
    controls.autoRotate = orbit && view.current === "3d";
    const cur = camera.position.clone().sub(controls.target);
    let target = geo.center.clone(), pos;
    if (["3d", "side", "plan", "fit"].includes(type)) pos = new THREE.Vector3(...fitted.position);
    else if (type === "bit") { target = tip.clone(); pos = target.clone().add(cur.normalize().multiplyScalar(Math.max(5, geo.radius * 0.7))); }
    else if (type === "in" || type === "out") {
      target = controls.target.clone();
      pos = target.clone().add(cur.normalize().multiplyScalar(THREE.MathUtils.clamp(
        camera.position.distanceTo(target) * (type === "in" ? 0.75 : 1.33), 1.5, fitted.distance * 3)));
    }
    controls.maxDistance = fitted.distance * 3;
    if (pos) goal.current = { pos, target };
  }, [command, geo, controls, camera, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!controls) return;
    controls.autoRotate = orbit && view.current === "3d";
    controls.autoRotateSpeed = 0.8;
    const cancel = () => { goal.current = null; };
    controls.addEventListener("start", cancel);
    return () => controls.removeEventListener("start", cancel);
  }, [controls, orbit]);

  useFrame((_, delta) => {
    if (!controls) return;
    controls.autoRotate = orbit && view.current === "3d" && !goal.current;
    if (!goal.current) return;
    const easing = 1 - Math.exp(-10 * delta);
    camera.position.lerp(goal.current.pos, easing);
    controls.target.lerp(goal.current.target, easing);
    controls.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.02) goal.current = null;
  });
  return null;
}

function SurveyScene({ survey, depthFt, colorMode, plugs, bitLabel, fmtDepth, tickStepFt, command, orbit, selectedPlugId, onSelectPlug }) {
  const stations = survey.stations;
  const td = stations[stations.length - 1].md_ft;
  const geo = useGeometry(stations);
  const tip = geo.project(stationAt(stations, depthFt));

  const ticks = useMemo(() => {
    return wellboreTicks(geo.firstMD, td, tickStepFt).map((md) => ({ md, pos: geo.project(stationAt(stations, md)) }));
  }, [stations, td, tickStepFt, geo]);

  const rings = useMemo(() => [...plugs].filter((p) => Number.isFinite(p.start) && p.start >= geo.firstMD && p.start <= td)
    .sort((a, b) => a.start - b.start).reduce((acc, p) => {
    const pos = geo.project(stationAt(stations, p.start));
    const ahead = geo.project(stationAt(stations, Math.min(p.start + 30, td)));
    const back = geo.project(stationAt(stations, Math.max(p.start - 30, 0)));
    const tangent = ahead.sub(back).normalize();
    const prev = acc[acc.length - 1];
    const level = prev && prev.pos.distanceTo(pos) < 2.2 ? (prev.level + 1) % 3 : 0;
    acc.push({ p, pos, tangent, level });
    return acc;
  }, []), [plugs, stations, td, geo]);

  const shadow = useMemo(() => geo.pts.map((v) => new THREE.Vector3(v.x, geo.floorY + 0.01, v.z)), [geo]);
  const startPos = useMemo(() => geo.center.clone().add(new THREE.Vector3(1, 0.55, 1).normalize().multiplyScalar((geo.radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 0.85)), [geo]);

  return (
    <Canvas camera={{ position: startPos.toArray(), fov: FOV, near: 0.1, far: 1000 }} dpr={[1, 1.5]} gl={{ antialias: true }} style={{ touchAction: "none" }} data-testid="survey-3d-canvas">
      <color attach="background" args={["#070C14"]} />
      <hemisphereLight args={["#94A3B8", "#0B1120", 0.55]} />
      <directionalLight position={[20, 40, 25]} intensity={1.1} />
      <directionalLight position={[-25, 10, -20]} intensity={0.35} color="#38BDF8" />

      <Grid args={[120, 120]} position={[geo.center.x, geo.floorY, geo.center.z]} cellSize={1} cellThickness={0.5} cellColor="#16213A" sectionSize={5} sectionThickness={1} sectionColor="#24324F" fadeDistance={geo.radius * 4} fadeStrength={1.5} infiniteGrid />
      <Line points={shadow} color="#334155" lineWidth={1.5} transparent opacity={0.7} />

      <mesh position={[geo.pts[0].x, geo.pts[0].y + 0.35, geo.pts[0].z]}>
        <cylinderGeometry args={[0.45, 0.55, 0.7, 20]} />
        <meshStandardMaterial color="#64748B" metalness={0.8} roughness={0.3} />
      </mesh>

      <WellTube geo={geo} stations={stations} colorMode={colorMode} />

      {ticks.map((t) => (
        <group key={t.md} position={t.pos}>
          <mesh><sphereGeometry args={[0.2, 12, 12]} /><meshBasicMaterial color="#CBD5E1" /></mesh>
          <Label text={fmtDepth(t.md)} color="#94A3B8" position={[0, 0, 0]} anchor={[-0.18, -0.25]} size={0.032} dim />
        </group>
      ))}

      {rings.map(({ p, pos, tangent, level }) => <PlugRing key={p.id} position={pos} tangent={tangent} name={p.name} level={level}
        selected={p.id === selectedPlugId} onSelect={() => onSelectPlug?.(p)} />)}
      <Bit position={tip} label={bitLabel} />

      <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={geo.center.toArray()} minDistance={1.5} maxDistance={geo.radius * 8} />
      <CameraRig geo={geo} tip={tip} command={command} orbit={orbit} />
    </Canvas>
  );
}

export default function SurveyWellbore3D(props) {
  return (
    <ErrorBoundary name="wellbore-3d" resetKey={props.survey.survey_id} fallback={(_, retry) => (
      <div role="alert" className="p-6 text-sm text-slate-300">
        <p>The 3D viewer could not initialize. Try reloading or enable WebGL in your browser.</p>
        <button onClick={retry} className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-white">Retry viewer</button>
      </div>
    )}>
      <SurveyScene {...props} />
    </ErrorBoundary>
  );
}
