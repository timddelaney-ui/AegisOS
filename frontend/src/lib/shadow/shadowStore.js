// Shadow Comparison Mode store. Settings + variance log persist through fieldStore
// (IndexedDB write-ahead + localStorage mirror) so entries survive reboots and
// low-battery shutdowns. Never throws into calculation code.
import { getStateSync, setState, walAppend } from "../fieldStore";
import { buildRecord } from "./variance";

const KEY_SETTINGS = "shadow_settings";
const KEY_LOG = "shadow_log";
export const LOG_MAX = 5000;
const EVT = "aegis:shadow-change";

const defaults = { enabled: false, jobId: "", operator: "", client: "", well: "" };

let settings = { ...defaults, ...(getStateSync(KEY_SETTINGS, {}) || {}) };
let log = (() => {
  const raw = getStateSync(KEY_LOG, []);
  return Array.isArray(raw) ? raw : [];
})();

const emit = () => {
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* non-browser */ }
};

const persistLog = () => setState(KEY_LOG, log.slice(-LOG_MAX));

export const getSettings = () => settings;
export const getLog = () => log;
export const isShadowEnabled = () => settings.enabled === true;

export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  setState(KEY_SETTINGS, settings);
  walAppend("shadow_settings", patch);
  emit();
  return settings;
}

/** Record one Aegis-vs-reference comparison. No-op (returns null) when shadow mode is off or inputs invalid. */
export function recordVariance(input, { force = false } = {}) {
  try {
    if (!force && !settings.enabled) return null;
    const rec = buildRecord({ jobId: settings.jobId, ...input });
    if (!rec) return null;
    log = [...log, rec].slice(-LOG_MAX);
    persistLog();
    walAppend("shadow_variance", rec);
    emit();
    return rec;
  } catch { return null; }
}

export function removeRecord(id) {
  log = log.filter((r) => r.id !== id);
  persistLog();
  emit();
}

export function clearLog() {
  log = [];
  persistLog();
  walAppend("shadow_log_cleared", {});
  emit();
}

export function subscribe(fn) {
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
}
