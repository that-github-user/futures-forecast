/**
 * Live markup hook — Server-Sent Events, the push replacement for the old 5s
 * polling. Opens `/terminal/v1/markup/stream` and keeps a
 * continuously-updated MarkupState for the live panel:
 *   - `alert` events prepend instantly (sub-second) — the operator sees a
 *     markup fire the moment it happens, no refresh.
 *   - `spot` events accumulate a fine-grained, window-bounded SPX series
 *     (smooth live line) that overrides the coarse 5s series.
 *   - `state` events (~5s) refresh the per-strike bands and reconcile the
 *     authoritative alert ring.
 *
 * Returns null markup when there's no active band (off-hours / cold start /
 * offline → hide the panel), same contract as the polling hook. The browser
 * EventSource auto-reconnects on a dropped connection. Demo mode uses the
 * static fixture (no SSE).
 */

import { useEffect, useRef, useState } from "react";
import { mockMarkupState } from "../api/mock";
import { subscribeMarkup } from "../api/terminalClient";
import type { MarkupAlert, MarkupState } from "../api/terminalTypes";
import { boundSpotWindow, deriveLiveMarkup } from "./liveMarkupHelpers";

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";
const SPOT_WINDOW_MS = 120_000; // matches the backend SPOT_WINDOW_S overlay window
const DEMO_REFRESH_MS = 30_000;

export interface LiveMarkupState {
  /** Live markup state, or null when there's nothing to show (off-hours,
   *  cold start, or stream offline) — the page hides the panel on null. */
  markup: MarkupState | null;
  /** True while the SSE connection is open. */
  connected: boolean;
  demoMode: boolean;
}

export function useLiveMarkup(): LiveMarkupState {
  const [markup, setMarkup] = useState<MarkupState | null>(() =>
    IS_DEMO ? mockMarkupState() : null,
  );
  const [connected, setConnected] = useState(false);

  // Accumulators live in refs so SSE callbacks mutate without re-subscribing.
  const stateRef = useRef<MarkupState | null>(null);
  const spotsRef = useRef<[string, number][]>([]);
  const liveAlertsRef = useRef<MarkupAlert[]>([]);

  useEffect(() => {
    if (IS_DEMO) {
      const id = setInterval(() => setMarkup(mockMarkupState()), DEMO_REFRESH_MS);
      return () => clearInterval(id);
    }

    let cancelled = false;
    stateRef.current = null;
    spotsRef.current = [];
    liveAlertsRef.current = [];

    const recompute = () => {
      if (cancelled) return;
      setMarkup(
        deriveLiveMarkup(stateRef.current, spotsRef.current, liveAlertsRef.current),
      );
    };

    const unsub = subscribeMarkup({
      onOpen: () => {
        if (!cancelled) setConnected(true);
      },
      onError: () => {
        if (!cancelled) setConnected(false);
      },
      onState: (s) => {
        stateRef.current = s;
        // Seed the spot accumulation from the first state's series so the
        // line isn't empty before the first `spot` arrives.
        if (spotsRef.current.length === 0 && s.spot_series?.length) {
          spotsRef.current = [...s.spot_series];
        }
        // The fresh state's recent_alerts already include anything we showed
        // live → drop the live overlay to avoid double-counting.
        liveAlertsRef.current = [];
        recompute();
      },
      onSpot: (ts, price) => {
        spotsRef.current = boundSpotWindow(
          [...spotsRef.current, [ts, price]],
          SPOT_WINDOW_MS,
        );
        recompute();
      },
      onAlert: (a) => {
        liveAlertsRef.current = [a, ...liveAlertsRef.current];
        recompute();
      },
    });

    return () => {
      cancelled = true;
      unsub();
      setConnected(false);
    };
  }, []);

  return { markup, connected, demoMode: IS_DEMO };
}
