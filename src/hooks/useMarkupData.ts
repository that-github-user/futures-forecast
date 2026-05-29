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

    const tick = async () => {
      const m = await terminal.markup();
      // null → off-hours/cold-start/offline → hide the panel (NOT demo).
      if (mountedRef.current) setMarkup(m);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { markup, demoMode: IS_DEMO };
}
