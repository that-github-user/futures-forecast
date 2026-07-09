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
 * - `refetch` exposes a one-shot fetch for the manual refresh button.
 *   `refreshing` flips while it's in-flight so the UI can disable the
 *   trigger.
 *
 * Setstate-after-unmount safety:
 * The hook polls via `await`; if the component unmounts while a fetch
 * is in flight, naively setting state after the await would warn (and
 * leak). We gate every setState behind `mountedRef.current` (set to
 * false by the effect cleanup). The pure helper `applyFetchResult`
 * below makes this testable without a DOM: it returns the set of
 * setState ops that should fire given a (snap, isMounted) input. The
 * hook applies them only when mountedRef is true.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { mockStraddleSnapshot } from "../api/mock";
import { terminal } from "../api/terminalClient";
import type { StraddleChainResponse } from "../api/terminalTypes";

const POLL_INTERVAL = 30_000;
const DEMO_REFRESH_INTERVAL = 300_000;
const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";
export const FAILURE_THRESHOLD = 3;

/** Outcome of one fetch tick, expressed as the setState calls that
 *  should fire. The hook applies these only when mountedRef is true;
 *  the test harness can assert directly on the shape without spinning
 *  up React. */
export interface FetchResultOps {
  setData?: StraddleChainResponse | null;
  setOnline?: boolean;
  setLoading?: boolean;
  setDemoMode?: boolean;
  /** Updated consecutive-failure count to write back into the ref. */
  failCount: number;
}

/** Pure: compute the setState ops a fetch result implies. Carved out
 *  of the hook so the unmount-race test below can assert that calling
 *  this with `isMounted=false` returns an empty op-set (no state
 *  mutations would fire on a dead component).
 *
 *  This isn't dead-code: the hook wires the returned ops through the
 *  mountedRef gate. Keeping the decision/application split makes the
 *  race-condition behavior unit-testable without a renderer. */
export function applyFetchResult(
  snap: StraddleChainResponse | null,
  prevFailCount: number,
  isMounted: boolean,
): FetchResultOps {
  // If the component is gone, NO setState should fire. This is the
  // guarantee the R1 review asks us to lock down.
  if (!isMounted) return { failCount: prevFailCount };
  if (snap !== null) {
    return {
      setData: snap,
      setOnline: true,
      setLoading: false,
      failCount: 0,
    };
  }
  const next = prevFailCount + 1;
  const triggerDemoFallback = next >= FAILURE_THRESHOLD;
  return {
    setOnline: false,
    setLoading: false,
    failCount: next,
    ...(triggerDemoFallback
      ? { setDemoMode: true, setData: mockStraddleSnapshot() }
      : {}),
  };
}

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
  /** Manual refresh trigger. Resolves once the fetch settles. Returns
   *  early without firing a network call when demoMode is active. */
  refetch: () => Promise<void>;
  /** True while a manual refresh is in flight — lets the refresh-button
   *  UI disable itself to prevent double-clicks. Tracks only manual
   *  invocations, not the background poll. */
  refreshing: boolean;
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
  const [refreshing, setRefreshing] = useState(false);
  const failCountRef = useRef(0);
  // Gate every post-await setState behind this. The effect cleanup
  // flips it to false; the only places that mutate state inside an
  // async path consult it first. React's StrictMode does mount→
  // unmount→remount on dev, so we also reset back to true on every
  // effect run.
  const mountedRef = useRef(true);

  const fetchLatest = useCallback(async () => {
    const snap = await terminal.straddle0dte();
    const ops = applyFetchResult(
      snap,
      failCountRef.current,
      mountedRef.current,
    );
    failCountRef.current = ops.failCount;
    // applyFetchResult returns empty ops when isMounted=false, so the
    // guarded check is a belt-and-suspenders: if mountedRef flipped
    // between the await and here, we skip the apply step entirely.
    if (!mountedRef.current) return;
    if (ops.setData !== undefined) setData(ops.setData);
    if (ops.setOnline !== undefined) setOnline(ops.setOnline);
    if (ops.setLoading !== undefined) setLoading(ops.setLoading);
    if (ops.setDemoMode !== undefined) setDemoMode(ops.setDemoMode);
  }, []);

  const refetch = useCallback(async () => {
    // Manual refresh is a no-op in demo mode — there's no backend to
    // hit and the demo fixture is already deterministic.
    if (demoMode) return;
    if (!mountedRef.current) return;
    setRefreshing(true);
    try {
      await fetchLatest();
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [demoMode, fetchLatest]);

  useEffect(() => {
    // Restore mounted=true on every effect run so StrictMode's
    // mount→unmount→remount cycle leaves us live for the remount.
    mountedRef.current = true;

    if (demoMode) {
      // In demo mode never hit the network. Refresh the fixture every
      // 5 minutes so the page doesn't feel completely static. The
      // initial demo seed is set in useState() above — no setState
      // here means React's StrictMode-double-mount doesn't fight us.
      const id = setInterval(() => {
        if (mountedRef.current) setData(mockStraddleSnapshot());
      }, DEMO_REFRESH_INTERVAL);
      return () => {
        mountedRef.current = false;
        clearInterval(id);
      };
    }

    const tick = async () => {
      await fetchLatest();
    };
    tick();
    const id = setInterval(tick, intervalMs);

    // Immediate refetch on tab-visible / focus / reconnect — background
    // tabs throttle the interval, and the straddle pane should repaint
    // within one round-trip of the viewer returning. Same idiom as
    // useTerminalSnapshot.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    window.addEventListener("online", tick);

    return () => {
      // Flip the gate BEFORE clearInterval so any in-flight await
      // resolving after this point bails out of its setState calls.
      mountedRef.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", tick);
    };
  }, [demoMode, intervalMs, fetchLatest]);

  return {
    data,
    loading,
    error: !loading && !online && !demoMode,
    online,
    demoMode,
    refetch,
    refreshing,
  };
}
