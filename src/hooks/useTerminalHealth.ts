/**
 * Polling hook for the terminal `/v1/health` endpoint (task #307).
 *
 * Returns the health response plus a derived `anyDegraded` flag so the
 * dashboard can show a single visible health-strip indicator when
 * EITHER live-stream subscriptions OR historical-fetch slots have
 * entered the backend's degraded state. The per-chart CACHED badge
 * (PR #191) covers the chart's `intraday_eth` slot specifically; this
 * hook drives the broader dashboard-chrome indicator that catches
 * stream failures + the daily / intraday_rth slots that the chart
 * badge doesn't surface.
 *
 * Endpoint is unauthenticated server-side, so the typed fetch wrapper
 * in `terminalClient.ts` skips the X-Terminal-Key header — works
 * before the operator's key has been validated.
 *
 * 30s cadence matches the bars-fetch polling. Health doesn't need to
 * be more responsive than the underlying data sources; faster polling
 * would just add request churn through the CFT tunnel without any
 * operator-visible benefit.
 */

import { useEffect, useState } from "react";
import { terminal } from "../api/terminalClient";
import type { TerminalHealth } from "../api/terminalTypes";

export interface TerminalHealthState {
  data: TerminalHealth | null;
  online: boolean;
  /** True iff `degraded_streams` OR `historical_degraded` is non-empty.
   *  The dashboard health-strip uses this as a single gate — it does
   *  NOT distinguish "stream degraded" from "historical-slot degraded"
   *  at the gate level. The actual cause is surfaced in the strip's
   *  body so an operator can triage. */
  anyDegraded: boolean;
}

export function useTerminalHealth(intervalMs = 30_000): TerminalHealthState {
  const [data, setData] = useState<TerminalHealth | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const h = await terminal.health();
      if (!cancelled) setData(h);
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  const streamsDegraded = (data?.degraded_streams?.length ?? 0) > 0;
  const historicalDegraded = (data?.historical_degraded?.length ?? 0) > 0;

  return {
    data,
    online: data !== null,
    anyDegraded: streamsDegraded || historicalDegraded,
  };
}
