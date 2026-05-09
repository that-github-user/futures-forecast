/**
 * Mobile-viewport hook. True iff the current viewport matches
 * `(max-width: 768px)` — the same breakpoint used throughout
 * `TerminalDashboard.css` for mobile-specific layouts.
 *
 * Subscribes to `matchMedia` change events so the value updates
 * when the user rotates the device or resizes the window across
 * the 768px boundary. SSR-safe (returns `false` during render
 * before the effect mounts; flipping to the correct value on
 * first effect tick).
 */

import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 768px)";

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
