/**
 * useDCSignalEvents — poll the /dc-api/v1/signal-events audit log.
 *
 * Defaults to today ET. Pass date="all" to disable the date filter. Polls
 * every 30s while mounted; strategy/date changes re-fetch immediately.
 *
 * All setState calls are guarded by a per-effect `cancelled` flag so filter
 * changes and unmount can't resurrect stale fetches.
 *
 * `error` does NOT imply an empty list — see `signalEventsDecision`. A
 * failed poll inside a scope that already loaded keeps its rows, so
 * callers must read `error && events.length > 0` as "stale, still true"
 * and `error && events.length === 0` as "we know nothing", and must not
 * render the second as a quiet session.
 */

import { useEffect, useState } from "react";

import { dcApi } from "../api/dcClient";
import type { DCSignalEvent } from "../api/dcTypes";

const POLL_INTERVAL_MS = 30_000;

interface Options {
  date?: string;          // YYYY-MM-DD, "all", or undefined for today
  strategy?: string;
  limit?: number;
}

/**
 * What to do with the rows we already hold when a poll comes back null.
 *
 * `dcGet` returns null for any non-ok response OR any network throw
 * (dcClient.ts), and this box is WiFi-only behind a Cloudflare tunnel, so
 * a dropped poll is routine. This log is an append-only audit record —
 * yesterday's rows do not decay — so blanking it on a blip is strictly
 * worse than showing it a beat stale. It used to blank, and the Events
 * tab now leads with three 22px verdict counts, which turned one dropped
 * poll into "0 IN · 0 SHOULD BE IN · 0 NO TRADE" rendered as fact.
 *
 *   - "replace" — payload arrived; swap it in.
 *   - "retain"  — poll failed but THIS filter scope already landed a
 *                 payload. Keep it; the caller flags the staleness.
 *   - "clear"   — poll failed and nothing has landed for this scope yet.
 *                 Whatever we hold answers a DIFFERENT question (the
 *                 previous date or strategy), so it must not be shown
 *                 under the new filter's label.
 *
 * Extracted pure so the retain-vs-clear contract is testable without a
 * DOM renderer — same shape as `brokerStateDecision` in useDCData.ts.
 */
export type SignalEventsDecision = "replace" | "retain" | "clear";

export function signalEventsDecision(
  fetched: DCSignalEvent[] | null,
  scopeHasLanded: boolean,
): SignalEventsDecision {
  if (fetched !== null) return "replace";
  return scopeHasLanded ? "retain" : "clear";
}

export function useDCSignalEvents({ date, strategy, limit = 500 }: Options = {}) {
  const [events, setEvents] = useState<DCSignalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Per-scope, NOT per-hook: reset on every filter change, which is what
    // makes the first failed poll after a date change "clear" rather than
    // "retain".
    let scopeHasLanded = false;
    setLoading(true);

    const run = async () => {
      const result = await dcApi.signalEvents({ date, strategy, limit });
      if (cancelled) return;
      switch (signalEventsDecision(result, scopeHasLanded)) {
        case "replace":
          scopeHasLanded = true;
          setError(false);
          setEvents(result ?? []);
          break;
        case "retain":
          setError(true);
          break;
        case "clear":
          setError(true);
          setEvents([]);
          break;
      }
      setLoading(false);
    };

    void run();
    const timer = window.setInterval(run, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [date, strategy, limit]);

  return { events, loading, error };
}
