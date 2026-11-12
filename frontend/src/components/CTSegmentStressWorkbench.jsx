import React, { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { StressElement } from "./StressStateDiagram";
import { getStressArrowData } from "../lib/stressState";
import { segmentStress } from "../lib/ctSegmentStress";

const SLIDERS = [
  { key: "pressure_mpa", label: "Internal Pump Pressure", unit: "MPa", min: 0, max: 140, step: 1 },
  { key: "tension_kn", label: "Axial Tension (Well Weight)", unit: "kN", min: 0, max: 200, step: 0.5 },
  { key: "bend_radius_m", label: "Bending Radius (Guide Arch)", unit: "m", min: 1, max: 100, step: 0.5 },
];

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");

function SegmentModel({ tension, bendRadius }) {
  // Arch radius grows with the slider for illustration only.
  const r = 30 + Math.min(Math.max(bendRadius, 0), 60) * 0.9;
  const cx = 150, cy = 150;
  const a0 = Math.PI * 1.15, a1 = Math.PI * 1.85;
  const pt = (a, rad) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  const [x0, y0] = pt(a0, r + 8);
  const [x1, y1] = pt(a1, r + 8);
  const am = (a0 + a1) / 2;
  const [sx, sy] = pt(am, r + 8);
  return (
    <svg viewBox="0 0 300 200" className="w-full h-auto" role="img" aria-label="Coiled tubing segment bending over a guide arch">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#64748B" strokeWidth="3" strokeDasharray="4 3" />
      <path d={`M ${x0} ${y0} A ${r + 8} ${r + 8} 0 0 1 ${x1} ${y1}`} fill="none" stroke="#0891B2" strokeWidth="10" strokeLinecap="round" />
      <circle cx={sx} cy={sy} r="6" fill="#F59E0B" stroke="#111" strokeWidth="1.5" />
      <text x={sx} y={sy - 12} textAnchor="middle" fontSize="9" fill="#111" fontWeight="700">Surface Stress Element</text>
      <line x1={x1} y1={y1} x2={x1 + 40} y2={y1 + 40} stroke="#DC2626" strokeWidth="3" />
      <polygon points={`${x1 + 40},${y1 + 40} ${x1 + 30},${y1 + 38} ${x1 + 38},${y1 + 30}`} fill="#DC2626" />
      <text x={x1 + 4} y={y1 + 56} fontSize="10" fill="#B91C1C" fontWeight="700">Tension {f1(tension)} kN</text>
      <text x="8" y="192" fontSize="9" fill="#444">Schematic — not to scale</text>
    </svg>
  );
}

export default function CTSegmentStressWorkbench({ smysMpa }) {
  const [inputs, setInputs] = useState({ pressure_mpa: 80, tension_kn: 4, bend_radius_m: 24 });
  const s = useMemo(
    () => segmentStress({ ...inputs, ...(smysMpa > 0 ? { smys_mpa: smysMpa } : {}) }),
    [inputs, smysMpa],
  );
  const arrows = useMemo(
    () => (s ? getStressArrowData({ sigma_h: s.hoop, sigma_r: -inputs.pressure_mpa, sigma_a: s.max_axial }) : []),
    [s, inputs.pressure_mpa],
  );

  return (
    <section className="bg-white border border-[#D4D4D4] rounded-lg p-3 space-y-3" data-testid="ct-segment-workbench" aria-label="CT segment multiaxial stress workbench">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#262626]">Coiled Tubing Segment Model</h2>
          <SegmentModel tension={inputs.tension_kn} bendRadius={inputs.bend_radius_m} />
        </div>
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#262626]">Multiaxial Stress State (3D Projection)</h2>
          <div className="relative h-48 rounded bg-[#0B0D12] overflow-hidden" data-testid="ct-segment-3d">
            {s && (
              <Canvas camera={{ position: [0, 2.5, 6], fov: 40 }} dpr={[1, 1.5]} frameloop="demand">
                <color attach="background" args={["#0B0D12"]} />
                <ambientLight intensity={1.4} />
                <directionalLight position={[4, 5, 6]} intensity={2} />
                <group position={[-1, 0, 0]}><StressElement arrows={arrows} /></group>
                <OrbitControls makeDefault enablePan={false} enableZoom={false} />
              </Canvas>
            )}
            <div className="pointer-events-none absolute left-2 top-2 text-[10px] text-slate-200">
              <span className="text-[#F87171]">σ_axial</span> · <span className="text-[#60A5FA]">Internal Pressure (hoop)</span>
            </div>
          </div>
          {s && (
            <dl className="mt-2 text-[11px] tabular-nums grid grid-cols-[1fr_auto] gap-x-2" data-testid="ct-segment-breakdown">
              <dt>Bending Contribution</dt><dd className="font-bold">± {f1(s.bending)} MPa</dd>
              <dt>Pressure-induced Axial</dt><dd className="font-bold">+ {f1(s.pressure_axial)} MPa</dd>
              <dt>Tension-induced Axial</dt><dd className="font-bold">+ {f1(s.tension_axial)} MPa</dd>
            </dl>
          )}
        </div>
      </div>

      {s ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]" data-testid="ct-segment-kpis">
          {[
            ["Hoop Stress", `${f1(s.hoop)} MPa`],
            ["Max Axial", `${f1(s.max_axial)} MPa`],
            ["Von Mises", `${f1(s.von_mises)} MPa`],
            ["Yield Limit", `${f1(s.yield_pct)} %`],
          ].map(([k, v]) => (
            <div key={k} className="rounded border border-[#E5E5E5] px-2 py-1">
              <div className="text-[#595959]">{k}</div>
              <div className={`font-bold tabular-nums ${k === "Yield Limit" && s.yield_pct >= 80 ? "text-[#B91C1C]" : ""}`}>{v}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#856404]">Segment geometry invalid.</p>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        {SLIDERS.map((sl) => (
          <label key={sl.key} className="text-[11px] text-[#262626] block">
            <span className="flex justify-between"><span>{sl.label}</span><b className="tabular-nums">{inputs[sl.key]} {sl.unit}</b></span>
            <input
              type="range" min={sl.min} max={sl.max} step={sl.step} value={inputs[sl.key]}
              onChange={(e) => setInputs((p) => ({ ...p, [sl.key]: Number(e.target.value) }))}
              className="w-full" aria-label={`${sl.label} (${sl.unit})`} data-testid={`slider-${sl.key}`}
            />
          </label>
        ))}
      </div>
      <p className="text-[10px] leading-snug text-[#595959]">
        Engineering decision-support only. Assumes 2.0&quot; × 0.157&quot; CT, E = 200 GPa, plane-stress surface element; bending is elastic
        (±E·r<sub>o</sub>/R). Not FEA, not certified engineering sign-off, and does not replace unit PLC safety systems.
      </p>
    </section>
  );
}
