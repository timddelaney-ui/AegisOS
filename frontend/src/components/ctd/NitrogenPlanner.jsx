import React, { useMemo, useState } from "react";
import { Snowflake, Plus, Trash2, Package } from "lucide-react";

/**
 * Per-stage nitrogen & liquid volume planner.
 *
 * Takes the current N₂ injection rate + liquid rate from the parent
 * calculator state (always normalized to Imperial internally: SCFM & BPM),
 * lets the user define multiple stages (name + duration in hours), and
 * totals N₂ (SCF / Sm³) and liquid (bbl / m³) for the whole drill-out.
 *
 * This is what field crews actually need to spec tanker count and pre-order.
 */

// A typical liquid-N₂ transport trailer in the field: ~2,900 gal LN₂ (≈ 262,000 SCF
// of gaseous nitrogen after vaporization). We use this to recommend tanker count.
const SCF_PER_TANKER = 262000;
const BBL_PER_STORAGE_TANK = 500; // 500 bbl frac tank, typical rig-up on CTD jobs

const PRESETS = [
  { name: "Rig-up / purge", hours: 0.5 },
  { name: "Drill-out stage", hours: 4 },
  { name: "Circulate / clean", hours: 1 },
  { name: "Pull out of hole", hours: 1.5 },
];

const NitrogenPlanner = ({ q_N2_scfm_imp, q_liq_bpm_imp, unitSystem, isUBD }) => {
  const [stages, setStages] = useState([
    { id: 1, name: "Drill-out", hours: "4" },
  ]);

  const addStage = (name = "", hours = "1") =>
    setStages((prev) => [...prev, { id: Date.now() + Math.random(), name, hours: String(hours) }]);
  const updateStage = (id, field, val) =>
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: val } : s)));
  const removeStage = (id) => setStages((prev) => prev.filter((s) => s.id !== id));

  const totals = useMemo(() => {
    const Q_N2 = q_N2_scfm_imp || 0;     // SCFM
    const Q_L = q_liq_bpm_imp || 0;      // BPM
    const rows = stages.map((s) => {
      const hr = parseFloat(s.hours) || 0;
      const mins = hr * 60;
      return {
        ...s,
        n2_scf: Q_N2 * mins,
        liq_bbl: Q_L * mins,
      };
    });
    const total_n2_scf = rows.reduce((a, r) => a + r.n2_scf, 0);
    const total_liq_bbl = rows.reduce((a, r) => a + r.liq_bbl, 0);
    const total_hrs = rows.reduce((a, r) => a + (parseFloat(r.hours) || 0), 0);
    const tankers = total_n2_scf > 0 ? total_n2_scf / SCF_PER_TANKER : 0;
    const liquid_tanks = total_liq_bbl > 0 ? total_liq_bbl / BBL_PER_STORAGE_TANK : 0;
    return { rows, total_n2_scf, total_liq_bbl, total_hrs, tankers, liquid_tanks };
  }, [stages, q_N2_scfm_imp, q_liq_bpm_imp]);

  const fmtN2 = (scf) => {
    if (unitSystem === "imp") return `${Math.round(scf).toLocaleString()} SCF`;
    const sm3 = scf * 0.0283168;
    return `${sm3.toFixed(0).toLocaleString()} Sm³`;
  };
  const fmtLiq = (bbl) => {
    if (unitSystem === "imp") return `${bbl.toFixed(1).toLocaleString()} bbl`;
    const m3 = bbl / 6.28981;
    return `${m3.toFixed(1).toLocaleString()} m³`;
  };

  return (
    <div className="bg-white border border-[#D4D4D4] rounded-xl p-3.5 shadow-sm" data-testid="ctd-nitrogen-planner">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#DBEAFE] text-[#0056B3]">
          <Snowflake className="w-3.5 h-3.5" strokeWidth={2.5} />
        </div>
        <div className="flex-1">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#262626]">Nitrogen & liquid volume planner</h3>
          <p className="text-[11px] text-[#595959]">
            {isUBD
              ? "Spec tanker demand for a full UBD drill-out — stage × rate × time."
              : "Rate × time per stage → spec fluid & N₂ pre-order for the shift."}
          </p>
        </div>
      </div>

      {!isUBD && (
        <div className="bg-[#FFF4D6] border border-[#FFE69C] rounded px-2 py-1.5 mb-2">
          <p className="text-[11px] text-[#7A5900]">
            You're in <strong>Balanced</strong> mode — N₂ rate is zero so only liquid volumes will total. Switch to <strong>Underbalanced</strong> to include N₂.
          </p>
        </div>
      )}

      {/* Preset quick-add */}
      <div className="flex items-center gap-1 flex-wrap mb-2">
        <span className="text-[10px] text-[#595959] uppercase font-semibold">Quick-add:</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            data-testid={`ctd-np-preset-${p.name.replace(/\s+/g, "-").toLowerCase()}`}
            onClick={() => addStage(p.name, p.hours)}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[#D4D4D4] bg-[#FAFAFA] hover:border-[#107C41] hover:bg-[#F0F9F3]"
          >
            + {p.name} ({p.hours}h)
          </button>
        ))}
      </div>

      {/* Stage rows */}
      <div className="space-y-1.5 mb-2.5">
        {stages.map((s, idx) => {
          const row = totals.rows[idx];
          return (
            <div key={s.id} className="grid grid-cols-[1fr_80px_90px_80px_24px] gap-1.5 items-center" data-testid={`ctd-np-row-${idx}`}>
              <input
                value={s.name}
                onChange={(e) => updateStage(s.id, "name", e.target.value)}
                placeholder="Stage name"
                className="px-2 py-1 border border-[#CCC] rounded text-[12px]"
                data-testid={`ctd-np-row-name-${idx}`}
              />
              <input
                value={s.hours}
                onChange={(e) => updateStage(s.id, "hours", e.target.value)}
                type="number"
                step="any"
                inputMode="decimal"
                placeholder="hours"
                className="px-2 py-1 border border-[#CCC] rounded text-[12px] tabular-nums"
                data-testid={`ctd-np-row-hours-${idx}`}
              />
              <span className="text-[11px] tabular-nums text-right text-[#262626] font-semibold truncate">{fmtN2(row?.n2_scf || 0)}</span>
              <span className="text-[11px] tabular-nums text-right text-[#262626] font-semibold truncate">{fmtLiq(row?.liq_bbl || 0)}</span>
              <button
                onClick={() => removeStage(s.id)}
                className="text-[#C4C4C4] hover:text-[#C00000]"
                data-testid={`ctd-np-row-delete-${idx}`}
                disabled={stages.length === 1}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => addStage()}
        data-testid="ctd-np-add-btn"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#107C41] hover:text-[#0D6535] mb-3"
      >
        <Plus className="w-3 h-3" /> Add custom stage
      </button>

      {/* Totals block */}
      <div className="border-t border-[#E4E4E4] pt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="ctd-np-totals">
        <div className="bg-[#F0F9F3] border border-[#C7E8D4] rounded p-2">
          <p className="text-[10px] font-semibold text-[#595959] uppercase">Total time</p>
          <p className="text-sm font-bold text-[#262626] tabular-nums">{totals.total_hrs.toFixed(1)} h</p>
        </div>
        <div className="bg-[#DBEAFE] border border-[#BFDBFE] rounded p-2">
          <p className="text-[10px] font-semibold text-[#0C4A6E] uppercase">Total N₂</p>
          <p className="text-sm font-bold text-[#0C4A6E] tabular-nums leading-tight">{fmtN2(totals.total_n2_scf)}</p>
          <p className="text-[10px] text-[#0C4A6E] mt-0.5">
            <Package className="inline w-2.5 h-2.5" /> {totals.tankers.toFixed(1)} tanker{Math.abs(totals.tankers - 1) < 0.01 ? "" : "s"}
          </p>
        </div>
        <div className="bg-[#E6F4EA] border border-[#C7E8D4] rounded p-2">
          <p className="text-[10px] font-semibold text-[#0D6535] uppercase">Total liquid</p>
          <p className="text-sm font-bold text-[#0D6535] tabular-nums leading-tight">{fmtLiq(totals.total_liq_bbl)}</p>
          <p className="text-[10px] text-[#0D6535] mt-0.5">
            <Package className="inline w-2.5 h-2.5" /> {totals.liquid_tanks.toFixed(1)} × 500-bbl tank
          </p>
        </div>
        <div className="bg-[#FFF4D6] border border-[#FFE69C] rounded p-2">
          <p className="text-[10px] font-semibold text-[#7A5900] uppercase">Suggested pre-order</p>
          <p className="text-[11px] font-bold text-[#7A5900] leading-tight">
            {Math.ceil(totals.tankers + 0.5)} N₂ tanker{Math.ceil(totals.tankers + 0.5) === 1 ? "" : "s"}
            <br />
            {Math.ceil(totals.liquid_tanks + 0.5)} × 500-bbl frac tank
          </p>
          <p className="text-[9px] text-[#7A5900] mt-0.5 italic">+50% safety margin</p>
        </div>
      </div>

      <p className="text-[10px] text-[#777] mt-2 italic">
        Assumes current rates ({q_N2_scfm_imp ? q_N2_scfm_imp.toFixed(0) : 0} SCFM N₂ · {q_liq_bpm_imp ? q_liq_bpm_imp.toFixed(2) : 0} BPM liquid) hold through every stage.
        Tanker reference: ~262,000 SCF per LN₂ trailer vaporized.
      </p>
    </div>
  );
};

export default NitrogenPlanner;
