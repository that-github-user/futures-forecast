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
 * Endpoint is unauthenticated server-side; the typed fetch wrapper in
 * `terminalClient.ts` passes requireAuth=false for it, so a 401 here
 * never triggers a session re-lock. Works before the operator logs in.
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
      try {
        const h = await terminal.health();
        if (!cancelled) setData(h);
      } catch {
        // `terminal.health()` already returns null on HTTP errors (the
        // wrapper in terminalClient.ts swallows them). This catch is
        // belt-and-suspenders for any future throw — e.g. a network
        // error during the in-flight promise. Treat as "offline" so
        // `online === false` and the strip stays hidden rather than
        // showing a stuck-degraded state from an earlier tick.
        if (!cancelled) setData(null);
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);

    // Immediate refetch on tab-visible / focus / reconnect so the
    // health strip reflects reality within one round-trip of the
    // operator returning, instead of waiting out a background-
    // throttled interval. Same idiom as useTerminalSnapshot.
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

  const streamsDegraded = (data?.degraded_streams?.length ?? 0) > 0;
  const historicalDegraded = (data?.historical_degraded?.length ?? 0) > 0;

  return {
    data,
    online: data !== null,
    anyDegraded: streamsDegraded || historicalDegraded,
  };
}
