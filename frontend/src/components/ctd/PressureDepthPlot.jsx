import React, { useMemo } from "react";
import { LineChart } from "lucide-react";

/**
 * Pressure-vs-Depth operating window plot.
 *
 * Shows Pore pressure, Fracture pressure, and BHP (as a BHP@TVD trajectory
 * assuming the gradient scales linearly from surface). This gives field crews
 * a one-glance view of whether their mud/BHP curve stays inside the window.
 *
 * SVG is dependency-free, prints cleanly, scales to mobile.
 */

const W = 640;
const H = 380;
const PAD = { l: 56, r: 20, t: 16, b: 36 };
const chartW = W - PAD.l - PAD.r;
const chartH = H - PAD.t - PAD.b;

const PressureDepthPlot = ({
  tvd_ft,
  pore_grad_psi_ft,
  frac_grad_psi_ft,
  bhp_psi,
  surf_choke_psi = 0,
  unitSystem = "imp",
  isUBD = false,
}) => {
  const data = useMemo(() => {
    if (!tvd_ft || tvd_ft <= 0 || !pore_grad_psi_ft || !frac_grad_psi_ft) return null;

    // Build Pp(d), Pfrac(d) using straight gradients from surface
    const steps = 20;
    const depths = Array.from({ length: steps + 1 }, (_, i) => (tvd_ft * i) / steps);
    const pore = depths.map((d) => pore_grad_psi_ft * d);
    const frac = depths.map((d) => frac_grad_psi_ft * d);

    // BHP trajectory — straight line from surface_choke (or 0) at d=0 up to BHP at TVD
    const bhp_bottom = bhp_psi || null;
    const bhp = bhp_bottom != null
      ? depths.map((d) => surf_choke_psi + (bhp_bottom - surf_choke_psi) * (d / tvd_ft))
      : null;

    const maxP = Math.max(...frac, bhp ? Math.max(...bhp) : 0, 100) * 1.05;
    const maxD = tvd_ft;

    const xP = (p) => PAD.l + (p / maxP) * chartW;
    const yD = (d) => PAD.t + (d / maxD) * chartH;

    const toPath = (series) => series
      .map((p, i) => `${i === 0 ? "M" : "L"}${xP(p).toFixed(1)},${yD(depths[i]).toFixed(1)}`)
      .join(" ");

    return {
      depths, pore, frac, bhp,
      maxP, maxD,
      xP, yD,
      path_pore: toPath(pore),
      path_frac: toPath(frac),
      path_bhp: bhp ? toPath(bhp) : null,
      bhp_bottom,
    };
  }, [tvd_ft, pore_grad_psi_ft, frac_grad_psi_ft, bhp_psi, surf_choke_psi]);

  const fmtP = (psi) => unitSystem === "imp" ? `${psi.toFixed(0)}` : `${(psi / 145.038).toFixed(1)}`;
  const unitP = unitSystem === "imp" ? "psi" : "MPa";
  const fmtD = (ft) => unitSystem === "imp" ? `${ft.toFixed(0)}` : `${(ft / 3.28084).toFixed(0)}`;
  const unitD = unitSystem === "imp" ? "ft" : "m";

  if (!data) {
    return (
      <div className="bg-white border border-[#D4D4D4] rounded-xl p-4 shadow-sm" data-testid="ctd-depth-plot-empty">
        <div className="flex items-center gap-2 mb-2">
          <LineChart className="w-4 h-4 text-[#107C41]" />
          <h3 className="text-[13px] font-bold text-[#262626]">Operating window — Pressure vs TVD</h3>
        </div>
        <p className="text-[12px] text-[#595959]">Enter TVD and pore / frac gradients to see the operating-window plot.</p>
      </div>
    );
  }

  // Build area band (frac vs pore) as polygon
  const bandPath = [
    `M${data.xP(data.pore[0]).toFixed(1)},${data.yD(data.depths[0]).toFixed(1)}`,
    ...data.pore.slice(1).map((p, i) => `L${data.xP(p).toFixed(1)},${data.yD(data.depths[i + 1]).toFixed(1)}`),
    ...data.frac.slice().reverse().map((p, i) => `L${data.xP(p).toFixed(1)},${data.yD(data.depths[data.depths.length - 1 - i]).toFixed(1)}`),
    "Z",
  ].join(" ");

  // Axis ticks
  const pTicks = Array.from({ length: 6 }, (_, i) => (data.maxP * i) / 5);
  const dTicks = Array.from({ length: 6 }, (_, i) => (data.maxD * i) / 5);

  // BHP endpoint relative to window → verdict dot colour
  const bhpAtTVD = data.bhp_bottom;
  const poreAtTVD = data.pore[data.pore.length - 1];
  const fracAtTVD = data.frac[data.frac.length - 1];
  let dotColor = "#107C41"; // in window
  let dotLabel = "In window";
  if (bhpAtTVD != null) {
    if (bhpAtTVD > fracAtTVD) { dotColor = "#C00000"; dotLabel = "Above frac — loss risk"; }
    else if (bhpAtTVD < poreAtTVD) { dotColor = "#C36600"; dotLabel = "Below pore — flowing"; }
  }

  return (
    <div className="bg-white border border-[#D4D4D4] rounded-xl p-3.5 shadow-sm" data-testid="ctd-depth-plot">
      <div className="flex items-start justify-between mb-2 gap-2">
        <div>
          <h3 className="text-[13px] font-bold text-[#262626] flex items-center gap-1.5">
            <LineChart className="w-4 h-4 text-[#107C41]" />
            Operating window — Pressure vs TVD
          </h3>
          <p className="text-[11px] text-[#595959]">Green band = safe window (pore ≤ BHP ≤ frac). {isUBD ? "UBD: BHP should sit left of pore line." : "Balanced: BHP inside green band."}</p>
        </div>
        {bhpAtTVD != null && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-2 py-1 rounded-full" style={{ backgroundColor: dotColor, color: "white" }}>
            <span className="w-2 h-2 rounded-full bg-white" /> {dotLabel}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-w-full" style={{ minWidth: 480 }} data-testid="ctd-depth-plot-svg">
          {/* Grid */}
          {pTicks.map((p, i) => (
            <line key={`vg${i}`} x1={data.xP(p)} y1={PAD.t} x2={data.xP(p)} y2={PAD.t + chartH} stroke="#EEE" />
          ))}
          {dTicks.map((d, i) => (
            <line key={`hg${i}`} x1={PAD.l} y1={data.yD(d)} x2={PAD.l + chartW} y2={data.yD(d)} stroke="#EEE" />
          ))}

          {/* Safe window band (pore → frac) */}
          <path d={bandPath} fill="#107C41" fillOpacity="0.12" />

          {/* Pore line */}
          <path d={data.path_pore} fill="none" stroke="#C36600" strokeWidth="2.5" strokeDasharray="4,3" />
          {/* Frac line */}
          <path d={data.path_frac} fill="none" stroke="#C00000" strokeWidth="2.5" />
          {/* BHP line */}
          {data.path_bhp && (
            <path d={data.path_bhp} fill="none" stroke="#0056B3" strokeWidth="3" />
          )}
          {/* BHP endpoint dot */}
          {bhpAtTVD != null && (
            <circle cx={data.xP(bhpAtTVD)} cy={data.yD(data.maxD)} r="5" fill={dotColor} stroke="white" strokeWidth="2" />
          )}

          {/* Axes */}
          <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + chartH} stroke="#555" strokeWidth="1" />
          <line x1={PAD.l} y1={PAD.t + chartH} x2={PAD.l + chartW} y2={PAD.t + chartH} stroke="#555" strokeWidth="1" />

          {/* P axis labels (bottom) */}
          {pTicks.map((p, i) => (
            <g key={`pl${i}`}>
              <line x1={data.xP(p)} y1={PAD.t + chartH} x2={data.xP(p)} y2={PAD.t + chartH + 4} stroke="#555" />
              <text x={data.xP(p)} y={PAD.t + chartH + 16} fontSize="10" textAnchor="middle" fill="#595959">{fmtP(p)}</text>
            </g>
          ))}
          <text x={PAD.l + chartW / 2} y={H - 6} fontSize="11" textAnchor="middle" fill="#262626" fontWeight="600">
            Pressure ({unitP})
          </text>

          {/* D axis labels (left) */}
          {dTicks.map((d, i) => (
            <g key={`dl${i}`}>
              <line x1={PAD.l - 4} y1={data.yD(d)} x2={PAD.l} y2={data.yD(d)} stroke="#555" />
              <text x={PAD.l - 7} y={data.yD(d) + 3.5} fontSize="10" textAnchor="end" fill="#595959">{fmtD(d)}</text>
            </g>
          ))}
          <text
            x={-(PAD.t + chartH / 2)}
            y={14}
            fontSize="11"
            textAnchor="middle"
            fill="#262626"
            fontWeight="600"
            transform={`rotate(-90)`}
          >
            TVD ({unitD})
          </text>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
        <span className="inline-flex items-center gap-1 text-[11px] text-[#262626]">
          <span className="inline-block w-5 h-[2px] bg-[#C36600]" style={{ background: "repeating-linear-gradient(90deg,#C36600 0 4px,transparent 4px 7px)" }} />
          Pore pressure
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-[#262626]">
          <span className="inline-block w-5 h-[2px] bg-[#C00000]" />
          Fracture pressure
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-[#262626]">
          <span className="inline-block w-5 h-[3px] bg-[#0056B3]" />
          BHP trajectory
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-[#262626]">
          <span className="inline-block w-3 h-3 bg-[#107C41]/20 border border-[#107C41]/40 rounded-sm" />
          Safe window
        </span>
      </div>
    </div>
  );
};

export default PressureDepthPlot;
