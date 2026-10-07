import { useEffect, useRef, useState } from "react";

/**
 * usePullToRefresh — lightweight mobile pull-to-refresh.
 * Attach the returned ref to a scrollable container. When the user pulls
 * down past `threshold` while already at scrollTop=0, `onRefresh` is called.
 * Returns {ref, pulling, progress} so you can render a spinner.
 */
export function usePullToRefresh(onRefresh, { threshold = 70, enabled = true } = {}) {
  const ref = useRef(null);
  const startY = useRef(0);
  const pulling = useRef(false);
  const [progress, setProgress] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current || document.scrollingElement;
    if (!el) return;

    const atTop = () => {
      if (el === document.scrollingElement) return window.scrollY <= 0;
      return el.scrollTop <= 0;
    };

    const onTouchStart = (e) => {
      if (!atTop() || refreshing) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    };
    const onTouchMove = (e) => {
      if (!pulling.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { setProgress(0); return; }
      // Only intercept if finger is pulling clearly down
      const p = Math.min(1, dy / threshold);
      setProgress(p);
    };
    const onTouchEnd = async () => {
      if (!pulling.current) return;
      pulling.current = false;
      if (progress >= 1) {
        setRefreshing(true);
        try { await onRefresh?.(); } finally {
          setRefreshing(false);
          setProgress(0);
        }
      } else {
        setProgress(0);
      }
    };

    const target = ref.current || window;
    target.addEventListener("touchstart", onTouchStart, { passive: true });
    target.addEventListener("touchmove",  onTouchMove,  { passive: true });
    target.addEventListener("touchend",   onTouchEnd);
    return () => {
      target.removeEventListener("touchstart", onTouchStart);
      target.removeEventListener("touchmove",  onTouchMove);
      target.removeEventListener("touchend",   onTouchEnd);
    };
  }, [enabled, onRefresh, threshold, progress, refreshing]);

  return { ref, progress, refreshing };
}

/** Simple spinner banner to render above the content when progress > 0. */
export function PullIndicator({ progress, refreshing }) {
  if (progress <= 0 && !refreshing) return null;
  const h = Math.max(24, Math.min(64, progress * 64));
  return (
    <div
      className="flex items-center justify-center bg-[#F0F9F3] text-[#0D6535] text-[11px] font-bold overflow-hidden transition-all"
      style={{ height: refreshing ? 44 : h }}
      aria-hidden
    >
      {refreshing ? (
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 border-2 border-[#0D6535] border-t-transparent rounded-full animate-spin" /> Refreshing…</span>
      ) : progress >= 1 ? (
        <span>Release to refresh</span>
      ) : (
        <span>Pull down to refresh</span>
      )}
    </div>
  );
}
