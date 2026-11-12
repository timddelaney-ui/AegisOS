import React, { useMemo, useState } from "react";
import { computeFluidTotals } from "../../lib/aegisTelemetry";

const STORAGE_KEY = "aegis_fluid_channel_map_v1";
const DEFAULT_CHANNELS = [
  { key: "acid", name: "Acid", rateKey: "acid_rate", volumeKey: "acid_volume", rateUnit: "gal/min", volumeUnit: "gal" },
  { key: "frSlug", name: "FR Slug", rateKey: "fr_slug_rate", volumeKey: "fr_slug_volume", rateUnit: "gal/min", volumeUnit: "gal" },
  { key: "mmfrSlugs", name: "MMFR Slugs", rateKey: "mmfr_slugs_rate", volumeKey: "mmfr_slugs_volume", rateUnit: "gal/min", volumeUnit: "gal" },
  { key: "gelPills", name: "Gel Pills", rateKey: "gel_pills_rate", volumeKey: "gel_pills_volume", rateUnit: "gal/min", volumeUnit: "gal" },
  { key: "waterFlush", name: "Water / Flush", rateKey: "water_flush_rate", volumeKey: "water_flush_volume", rateUnit: "gal/min", volumeUnit: "gal" },
];

function loadChannels() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length === DEFAULT_CHANNELS.length) {
      return DEFAULT_CHANNELS.map((defaults) => ({
        ...defaults,
        ...(saved.find((item) => item.key === defaults.key) || {}),
      }));
    }
  } catch { /* use the shipped defaults */ }
  return DEFAULT_CHANNELS;
}

const isReading = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
const displayValue = (value) => isReading(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";

export function FluidTotalizersPanel({ telemetry = {} }) {
  const [channels, setChannels] = useState(loadChannels);
  const values = useMemo(() => Object.fromEntries(channels.map((channel) => [
    channel.key,
    { rate: telemetry[channel.rateKey], volume: telemetry[channel.volumeKey] },
  ])), [channels, telemetry]);
  const totals = useMemo(() => {
    try { return computeFluidTotals(values); } catch { return null; }
  }, [values]);
  const complete = totals !== null && channels.every((channel) =>
    channel.rateKey && channel.volumeKey &&
    isReading(telemetry[channel.rateKey]) &&
    isReading(telemetry[channel.volumeKey])) &&
    new Set(channels.map((channel) => channel.rateUnit.trim())).size === 1 &&
    new Set(channels.map((channel) => channel.volumeUnit.trim())).size === 1 &&
    channels[0].rateUnit.trim() && channels[0].volumeUnit.trim();

  const update = (index, field, value) => {
    const next = channels.map((channel, i) => i === index ? { ...channel, [field]: value } : channel);
    setChannels(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (error) {
      console.error("Could not save fluid channel mapping", error);
    }
  };

  return (
    <section className="bg-[#0D1526] border border-slate-800 rounded-2xl p-4 space-y-3" aria-label="Fluid totalizers" data-testid="fluid-totalizers">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold tracking-wide text-slate-100">FLUID TOTALIZERS</h2>
        <div className="flex gap-4 text-xs font-mono" aria-live="polite">
          <span className="text-cyan-200">Q total <b>{complete ? displayValue(totals?.qTotal) : "—"}</b> {complete && channels[0].rateUnit}</span>
          <span className="text-cyan-200">V total <b>{complete ? displayValue(totals?.vTotal) : "—"}</b> {complete && channels[0].volumeUnit}</span>
        </div>
      </div>
      {!complete && <p className="text-xs text-amber-300">Map each channel to valid, non-negative DAQ rate and cumulative-volume fields with matching units; totals stay unavailable until all channels are compatible.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {channels.map((channel, index) => (
          <div key={channel.key} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
            <label className="block text-[10px] uppercase tracking-wide text-slate-400">
              Channel
              <input value={channel.name} onChange={(e) => update(index, "name", e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" data-testid={`fluid-${channel.key}-name`} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[10px] text-slate-400">Rate field
                <input value={channel.rateKey} onChange={(e) => update(index, "rateKey", e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" data-testid={`fluid-${channel.key}-rate-field`} />
              </label>
              <label className="block text-[10px] text-slate-400">Volume field
                <input value={channel.volumeKey} onChange={(e) => update(index, "volumeKey", e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" data-testid={`fluid-${channel.key}-volume-field`} />
              </label>
              <label className="block text-[10px] text-slate-400">Rate unit
                <input value={channel.rateUnit} onChange={(e) => update(index, "rateUnit", e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" data-testid={`fluid-${channel.key}-rate-unit`} />
              </label>
              <label className="block text-[10px] text-slate-400">Volume unit
                <input value={channel.volumeUnit} onChange={(e) => update(index, "volumeUnit", e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" data-testid={`fluid-${channel.key}-volume-unit`} />
              </label>
            </div>
            <div className="flex justify-between gap-2 text-xs font-mono text-slate-200">
              <span>{displayValue(telemetry[channel.rateKey])} {channel.rateUnit}</span>
              <span>{displayValue(telemetry[channel.volumeKey])} {channel.volumeUnit}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
