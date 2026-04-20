/**
 * useDCSignalEvents — poll the /dc-api/v1/signal-events audit log.
 *
 * Defaults to today ET. Pass date="all" to disable the date filter. Polls
 * every 30s while mounted; strategy/date changes re-fetch immediately.
 */

import { useCallback, useEffect, useState } from "react";

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

  const fetchOnce = useCallback(async () => {
    const result = await dcApi.signalEvents({ date, strategy, limit });
    if (result === null) {
      setError(true);
      setEvents([]);
    } else {
      setError(false);
      setEvents(result);
    }
    setLoading(false);
  }, [date, strategy, limit]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchOnce();

    const timer = window.setInterval(() => {
      if (!cancelled) void fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fetchOnce]);

  return { events, loading, error, refetch: fetchOnce };
}
