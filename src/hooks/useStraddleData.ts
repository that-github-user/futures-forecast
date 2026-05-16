/**
 * Polling hook for the 0DTE straddle-chain endpoint.
 *
 * Mirrors the pattern of `useTerminalSnapshot` (single combined poll
 * with online flag) and `usePrediction` (auto-fallback to demo mode
 * after N consecutive failures or when `VITE_DEMO_MODE === "true"`).
 *
 * - 30s poll cadence (matches snapshotter EOD cadence headroom; the
 *   backend regenerates the snapshot every 60s so polling faster is
 *   wasted bandwidth).
 * - Auto-demo: when `VITE_DEMO_MODE === "true"` the hook never hits the
 *   network and serves a synthetic snapshot from `mockStraddleSnapshot`.
 *   Without the env var the hook still falls back to demo data after 3
 *   consecutive fetch failures so the page renders something useful
 *   when the terminal API is unreachable.
 * - `online` distinguishes "we got a payload" from "we're rendering
 *   demo data" so the page can apply a watermark in the latter case.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { mockStraddleSnapshot } from "../api/mock";
import { terminal } from "../api/terminalClient";
import type { StraddleChainResponse } from "../api/terminalTypes";

const POLL_INTERVAL = 30_000;
const DEMO_REFRESH_INTERVAL = 300_000;
const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";
const FAILURE_THRESHOLD = 3;

export interface StraddleDataState {
  data: StraddleChainResponse | null;
  loading: boolean;
  error: boolean;
  online: boolean;
  /** True when the rendered payload was sourced from `mockStraddleSnapshot`
   *  (either because `VITE_DEMO_MODE=true` or because we auto-fell-back
   *  after consecutive failures). The page uses this to render a
   *  watermark identical in spirit to the ES dashboard's demo banner. */
  demoMode: boolean;
}

export function useStraddleData(intervalMs = POLL_INTERVAL): StraddleDataState {
  // Seed demo data via the state initializer so the first render
  // already has the fixture — avoids an effect-time setState in the
  // demo branch.
  const [data, setData] = useState<StraddleChainResponse | null>(() =>
    IS_DEMO ? mockStraddleSnapshot() : null,
  );
  // In demo mode we already have data, so loading is false from the
  // first render. Live mode starts in the loading state until the
  // first poll resolves.
  const [loading, setLoading] = useState(!IS_DEMO);
  const [online, setOnline] = useState(false);
  const [demoMode, setDemoMode] = useState(IS_DEMO);
  const failCountRef = useRef(0);

  const fetchLatest = useCallback(async () => {
    const snap = await terminal.straddle0dte();
    if (snap !== null) {
      failCountRef.current = 0;
      setData(snap);
      setOnline(true);
      setLoading(false);
      return;
    }
    failCountRef.current += 1;
    setOnline(false);
    if (failCountRef.current >= FAILURE_THRESHOLD) {
      // After N consecutive failures, surface a synthetic snapshot so
      // the page doesn't render an empty shell forever. The watermark
      // makes it obvious to the operator this isn't live data.
      setDemoMode(true);
      setData(mockStraddleSnapshot());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (demoMode) {
      // In demo mode never hit the network. Refresh the fixture every
      // 5 minutes so the page doesn't feel completely static. The
      // initial demo seed is set in useState() above — no setState
      // here means React's StrictMode-double-mount doesn't fight us.
      const id = setInterval(
        () => setData(mockStraddleSnapshot()),
        DEMO_REFRESH_INTERVAL,
      );
      return () => clearInterval(id);
    }

    let cancelled = false;
    const tick = async () => {
      await fetchLatest();
      if (cancelled) {
        // Cancellation safety net: the awaited promise resolved after
        // the effect was torn down. Don't mutate state on a dead hook.
        return;
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [demoMode, intervalMs, fetchLatest]);

  return {
    data,
    loading,
    error: !loading && !online && !demoMode,
    online,
    demoMode,
  };
}
