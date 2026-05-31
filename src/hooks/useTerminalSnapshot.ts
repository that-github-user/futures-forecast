/**
 * Polling hook for the terminal snapshot endpoint.
 *
 * PR β: single combined snapshot poll at 10s. Subsequent PRs split into
 * per-system hooks at natural cadences (regime 1min, breadth 30s, etc.)
 * once real data lands and we want to avoid pulling unchanged systems.
 */

import { useEffect, useState } from "react";
import { terminal } from "../api/terminalClient";
import type { TerminalSnapshot } from "../api/terminalTypes";

export interface SnapshotState {
  data: TerminalSnapshot | null;
  loading: boolean;
  error: boolean;
  online: boolean;
}

export function useTerminalSnapshot(intervalMs = 10_000): SnapshotState {
  const [data, setData] = useState<TerminalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      // Coalesce overlapping triggers — the interval and the
      // visibility/focus/online listeners below can fire near-
      // simultaneously; keep one request in flight at a time.
      if (inFlight) return;
      inFlight = true;
      try {
        const snap = await terminal.snapshot();
        if (cancelled) return;
        setData(snap);
        setLoading(false);
        setOnline(snap !== null);
      } finally {
        inFlight = false;
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);

    // Background tabs throttle setInterval to ~1/min (or suspend it),
    // so a trader returning to a still-open page would otherwise wait
    // up to a full throttled interval for fresh feed events. Force an
    // immediate refetch the moment the tab becomes visible / regains
    // focus / reconnects — collapsing return-to-tab latency to one
    // round-trip. (The real cure for a CLOSED tab / a continuously-
    // advancing feed is the server-side feed advancer; this only fixes
    // the still-open-but-backgrounded case.)
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    window.addEventListener("online", tick);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", tick);
    };
  }, [intervalMs]);

  return { data, loading, error: !loading && !online, online };
}
