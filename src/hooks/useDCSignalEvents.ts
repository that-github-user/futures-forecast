/**
 * useDCSignalEvents — poll the /dc-api/v1/signal-events audit log.
 *
 * Defaults to today ET. Pass date="all" to disable the date filter. Polls
 * every 30s while mounted; strategy/date changes re-fetch immediately.
 *
 * All setState calls are guarded by a per-effect `cancelled` flag so filter
 * changes and unmount can't resurrect stale fetches.
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

export function useDCSignalEvents({ date, strategy, limit = 500 }: Options = {}) {
  const [events, setEvents] = useState<DCSignalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      const result = await dcApi.signalEvents({ date, strategy, limit });
      if (cancelled) return;
      if (result === null) {
        setError(true);
        setEvents([]);
      } else {
        setError(false);
        setEvents(result);
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
