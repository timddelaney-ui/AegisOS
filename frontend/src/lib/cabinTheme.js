// Cabin display modes. Applied as data-theme on <html>; styles live in index.css.
//   standard — default look
//   sunlight — high-contrast, heavier borders, larger text for direct glare
//   night    — dark, dimmed, low-glare for night cabin
export const THEMES = ["standard", "sunlight", "night"];
const KEY = "aegis_cabin_theme_v1";

export const getTheme = () => {
  try { const t = localStorage.getItem(KEY); return THEMES.includes(t) ? t : "standard"; } catch { return "standard"; }
};

export const applyTheme = (t) => {
  const theme = THEMES.includes(t) ? t : "standard";
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  return theme;
};

export const applyStoredTheme = () => applyTheme(getTheme());
export const nextTheme = (t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
