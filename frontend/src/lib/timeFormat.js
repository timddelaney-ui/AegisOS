// Shared time formatters — all 24-hour (military) format.
// Field operations standard across SPE, API, AER, OH&S.
//
// Use these everywhere instead of raw .toLocaleString() so a single toggle
// could later localise or switch 12/24h.

const LOCALE = "en-GB"; // yields 24-hour display with HH:MM:SS and DD/MM

const _opts24 = Object.freeze({
  dayMonthYear: { day: "2-digit", month: "short", year: "numeric" },
  dayMonth:     { day: "2-digit", month: "short" },
  hm:           { hour: "2-digit", minute: "2-digit", hour12: false },
  hms:          { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false },
  shortDT:      { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false },
  fullDT:       { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false },
});

const _safe = (iso) => {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch { return null; }
};

export const fmtTime = (iso) => {
  const d = _safe(iso);
  return d ? d.toLocaleTimeString(LOCALE, _opts24.hms) : (iso || "—");
};
export const fmtTimeShort = (iso) => {
  const d = _safe(iso);
  return d ? d.toLocaleTimeString(LOCALE, _opts24.hm) : (iso || "—");
};
export const fmtDate = (iso) => {
  const d = _safe(iso);
  return d ? d.toLocaleDateString(LOCALE, _opts24.dayMonthYear) : (iso || "—");
};
export const fmtDateTime = (iso) => {
  const d = _safe(iso);
  if (!d) return iso || "—";
  // Produce an unambiguous "DD-Mon-YYYY HH:MM" string.
  const date = d.toLocaleDateString(LOCALE, _opts24.dayMonthYear);
  const time = d.toLocaleTimeString(LOCALE, _opts24.hm);
  return `${date} ${time}`;
};
export const fmtDateTimeSec = (iso) => {
  const d = _safe(iso);
  if (!d) return iso || "—";
  const date = d.toLocaleDateString(LOCALE, _opts24.dayMonthYear);
  const time = d.toLocaleTimeString(LOCALE, _opts24.hms);
  return `${date} ${time}`;
};
export const fmtShort = (iso) => {
  const d = _safe(iso);
  if (!d) return iso || "—";
  const date = d.toLocaleDateString(LOCALE, _opts24.dayMonth);
  const time = d.toLocaleTimeString(LOCALE, _opts24.hm);
  return `${date} ${time}`;
};
