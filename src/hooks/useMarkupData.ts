/**
 * Polling hook for the live markup endpoint (`/terminal/v1/markup`).
 *
 * 5s cadence — matches the backend sidecar's ~5s flush so the gradient
 * sparkline feels live without wasted bandwidth.
 *
 * KEY DIFFERENCE from `useStraddleData`: that hook auto-falls-back to a
 * demo fixture after N consecutive nulls (its endpoint never returns
 * null when online, so null == offline). The markup endpoint LEGITIMATELY
 * returns null when online — pre-RTH, weekends, holidays, cold start (no
 * sidecar yet). So a null here means "no live markup; HIDE the panel,"
 * NOT "we're offline, show demo." We therefore never auto-demo: demo is
 * opt-in via `VITE_DEMO_MODE` only. A network error also collapses to
 * null (graceful) → panel hides, which is the right outcome off-hours
 * and the acceptable outcome on a transient API blip.
 */

import { useEffect, useRef, useState } from "react";
import { mockMarkupState } from "../api/mock";
import { terminal } from "../api/terminalClient";
import type { MarkupState } from "../api/terminalTypes";

const POLL_INTERVAL = 5_000;
const DEMO_REFRESH_INTERVAL = 30_000;
// After this many consecutive nulls (off-hours / API down) the panel is
// hidden and nobody's watching — back the poll off to SLOW_INTERVAL to
// stop hammering the API with guaranteed-null fetches. Resets to the
// live cadence on the first non-null tick.
const SLOW_AFTER_NULLS = 3;
const SLOW_INTERVAL = 30_000;
const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

export interface MarkupDataState {
  /** Live markup state, or null when there's nothing to show (off-hours,
   *  cold start, or API offline) — the page hides the panel on null. */
  markup: MarkupState | null;
  /** True only under VITE_DEMO_MODE (markup never auto-demos on null). */
  demoMode: boolean;
}

export function useMarkupData(intervalMs = POLL_INTERVAL): MarkupDataState {
  const [markup, setMarkup] = useState<MarkupState | null>(() =>
    IS_DEMO ? mockMarkupState() : null,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (IS_DEMO) {
      // Refresh the fixture periodically so the demo sparkline animates.
      const id = setInterval(() => {
        if (mountedRef.current) setMarkup(mockMarkupState());
      }, DEMO_REFRESH_INTERVAL);
      return () => {
        mountedRef.current = false;
        clearInterval(id);
      };
    }

    // Self-scheduling poll with adaptive cadence: live (intervalMs) while
    // data flows, slow (SLOW_INTERVAL) after a run of nulls. setTimeout
    // (not setInterval) so the delay can change per tick.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nullStreak = 0;
    const tick = async () => {
      const m = await terminal.markup();
      if (!mountedRef.current) return;
      // null → off-hours/cold-start/offline → hide the panel (NOT demo).
      setMarkup(m);
      nullStreak = m == null ? nullStreak + 1 : 0;
      const delay = nullStreak >= SLOW_AFTER_NULLS ? SLOW_INTERVAL : intervalMs;
      timer = setTimeout(tick, delay);
    };
    tick();
    return () => {
      mountedRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  return { markup, demoMode: IS_DEMO };
}
