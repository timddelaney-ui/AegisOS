import { useRef } from "react";

/**
 * usePullToRefresh — DISABLED (iter 20).
 *
 * The previous implementation attached touchstart/touchmove/touchend listeners
 * on either `ref.current` or `window`, with `progress` and `refreshing` in the
 * effect deps. Every touch triggered setState → useEffect cleanup → re-attach.
 * On real phones that churn blocked native scroll and defeated tap events.
 *
 * Native browsers (iOS Safari ≥ 16, Chrome Android) already give users a
 * refresh gesture — we don't need a custom one. Keep the hook shape so callers
 * compile, but return a no-op ref and zero progress.
 */
export function usePullToRefresh(/* onRefresh, opts */) {
  const ref = useRef(null);
  return { ref, progress: 0, refreshing: false };
}

export function PullIndicator() {
  return null;
}
