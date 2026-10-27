import { useCallback, useSyncExternalStore } from "react";
import { getLog, getSettings, subscribe, updateSettings, recordVariance } from "./shadowStore";

// Snapshots are replaced (not mutated) on change, so reference equality is safe.
export function useShadow() {
  const settings = useSyncExternalStore(subscribe, getSettings, getSettings);
  const log = useSyncExternalStore(subscribe, getLog, getLog);
  const setEnabled = useCallback((enabled) => updateSettings({ enabled: !!enabled }), []);
  return { settings, log, enabled: settings.enabled, setEnabled, updateSettings, record: recordVariance };
}
