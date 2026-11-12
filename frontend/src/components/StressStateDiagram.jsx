import React, { useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { getStressArrowData } from "../lib/stressState";

function StressArrow({ axis, sign, magnitudeRatio, color }) {
  const arrows = useMemo(() => {
    const axisVector = new THREE.Vector3(...axis);
    const length = 0.55 + magnitudeRatio * 0.75;
    const headLength = 0.2;
    const shaftLength = length - headLength;
    return [-1, 1].map((side) => {
      const direction = axisVector.clone().multiplyScalar(side * sign).normalize();
      const surface = axisVector.clone().multiplyScalar(side * 0.76);
      const start = sign > 0
        ? surface
        : surface.clone().addScaledVector(direction, -length);
      const orientation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction,
      );
      return {
        start: start.toArray(),
        orientation: orientation.toArray(),
        shaftLength,
        headLength,
      };
    });
  }, [axis, sign, magnitudeRatio]);

  if (!sign) return null;
  return arrows.map((arrow, index) => (
    <group key={index} position={arrow.start} quaternion={arrow.orientation}>
      <mesh position={[0, arrow.shaftLength / 2, 0]}>
        <cylinderGeometry args={[0.035, 0.035, arrow.shaftLength, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, arrow.shaftLength + arrow.headLength / 2, 0]}>
        <coneGeometry args={[0.095, arrow.headLength, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
    </group>
  ));
}

function TubingSegment() {
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.7, -0.75, 0),
      new THREE.Vector3(-3.45, -0.25, 0),
      new THREE.Vector3(-3.1, 0.25, 0),
      new THREE.Vector3(-2.6, 0.62, 0),
      new THREE.Vector3(-2.1, 0.62, 0),
    ]);
    return new THREE.TubeGeometry(curve, 40, 0.14, 12, false);
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#22B8CF" metalness={0.35} roughness={0.35} />
      </mesh>
      <mesh position={[-3.1, 0.25, 0]}>
        <sphereGeometry args={[0.11, 16, 16]} />
        <meshStandardMaterial color="#34D399" emissive="#34D399" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

export function StressElement({ arrows }) {
  return (
    <group position={[1.0, 0, 0]}>
      <mesh>
        <boxGeometry args={[1.5, 1.5, 1.5]} />
        <meshStandardMaterial color="#334155" metalness={0.15} roughness={0.5} transparent opacity={0.72} />
      </mesh>
      {arrows.map((component) => (
        <StressArrow
          key={component.key}
          axis={component.axis}
          sign={component.sign}
          magnitudeRatio={component.magnitudeRatio}
          color={component.color}
        />
      ))}
      <mesh position={[-0.76, 0, 0]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#34D399" emissive="#34D399" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

export default function StressStateDiagram({ stress, formatStress }) {
  const arrows = useMemo(() => getStressArrowData(stress), [stress]);

  return (
    <section
      className="bg-white border border-[#D4D4D4] rounded-lg p-3 space-y-2"
      aria-labelledby="stress-state-title"
      data-testid="stress-state-diagram"
    >
      <div>
        <h2 id="stress-state-title" className="text-xs font-bold uppercase tracking-wide text-[#262626]">
          Multiaxial inner-wall stress state
        </h2>
        <p className="text-[10px] text-[#595959]">
          3D schematic driven by the pressure, axial-force, and active-reel inputs above. Drag to rotate.
        </p>
      </div>
      {stress ? (
        <>
          <div
            className="relative h-64 sm:h-72 overflow-hidden rounded bg-[#0B0D12]"
            role="img"
            aria-label="Interactive 3D schematic of calculated hoop, radial, and axial inner-wall stresses"
            data-testid="stress-state-3d"
          >
            <Canvas
              camera={{ position: [-0.5, 2.8, 8], fov: 40 }}
              dpr={[1, 1.5]}
              gl={{ antialias: true, alpha: false }}
            >
              <color attach="background" args={["#0B0D12"]} />
              <ambientLight intensity={1.4} />
              <directionalLight position={[4, 5, 6]} intensity={2} />
              <pointLight position={[-3, 1, 2]} color="#22D3EE" intensity={20} distance={8} />
              <TubingSegment />
              <Line points={[[-3.1, 0.25, 0], [0.24, 0, 0]]} color="#34D399" lineWidth={1.2} dashed dashSize={0.12} gapSize={0.08} />
              <StressElement arrows={arrows} />
              <OrbitControls makeDefault enablePan={false} enableZoom={false} enableDamping dampingFactor={0.12} />
            </Canvas>
            <div className="pointer-events-none absolute left-3 top-3 text-[10px] text-slate-300">
              CT segment · highlighted inner-wall element
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            {arrows.map((component) => (
              <div key={component.key} className="rounded border border-[#E5E5E5] px-2 py-1">
                <div className="flex items-center gap-1 text-[#595959]">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: component.color }} />
                  {component.label} stress
                </div>
                <div className="font-bold tabular-nums" data-testid={`stress-${component.key}`}>
                  {formatStress(component.value)}
                </div>
              </div>
            ))}
            <div className="rounded border border-[#E5E5E5] px-2 py-1">
              <div className="text-[#595959]">Von Mises</div>
              <div className="font-bold tabular-nums">{formatStress(stress.von_mises)}</div>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-[#856404]">Stress state unavailable for the selected pipe geometry.</p>
      )}
      <p className="text-[10px] leading-snug text-[#595959]">
        Arrow directions show tension or compression; arrow lengths are normalized to the largest displayed
        component and are not a physical displacement scale. The tubing shape is illustrative, not a
        finite-element result. The current calculation evaluates hoop and radial pressure stress at the
        inner wall and axial stress as entered force divided by pipe area; it does not include
        bending-radius or pressure-end-load contributions.
      </p>
    </section>
  );
}
