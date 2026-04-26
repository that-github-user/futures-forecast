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

    const tick = async () => {
      const snap = await terminal.snapshot();
      if (cancelled) return;
      setData(snap);
      setLoading(false);
      setOnline(snap !== null);
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { data, loading, error: !loading && !online, online };
}
