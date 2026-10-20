// Linear interpolation of survey station properties at a measured depth (ft)
export function stationAt(stations, md) {
  if (!stations?.length) return null;
  const n = stations.length;
  if (md <= stations[0].md_ft) return { ...stations[0], i: 0, t: 0 };
  if (md >= stations[n - 1].md_ft) return { ...stations[n - 1], i: n - 2, t: 1 };
  let i = 0;
  while (i < n - 2 && stations[i + 1].md_ft < md) i++;
  const a = stations[i], b = stations[i + 1];
  const t = (md - a.md_ft) / Math.max(1e-6, b.md_ft - a.md_ft);
  const lerp = (k) => (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * t;
  return {
    i, t, md_ft: md,
    tvd_ft: lerp("tvd_ft"), north_ft: lerp("north_ft"), east_ft: lerp("east_ft"),
    inc_deg: lerp("inc_deg"), azi_deg: lerp("azi_deg"),
    dls_deg_per_100ft: b.dls_deg_per_100ft ?? 0,
  };
}

export const surveyTD = (survey) => survey?.stations?.length ? survey.stations[survey.stations.length - 1].md_ft : 0;

// DLS bands in °/100ft (matches MiniWellbore / API RP 7G convention used app-wide)
export const DLS_WARN = 3;
export const DLS_CRIT = 6;
export const dlsColor = (dls) => (dls < DLS_WARN ? "#10B981" : dls < DLS_CRIT ? "#F59E0B" : "#EF4444");
