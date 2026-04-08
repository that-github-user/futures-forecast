/**
 * useStrategySpecs — fetch the static DC strategy catalog once per page load.
 *
 * The catalog is the same for every viewer and rarely changes, so we cache
 * the response in module scope and avoid re-fetching across re-mounts.
 * Subscriptions, signals, and lifecycle states are all derived from this
 * spec list combined with the live signal data from /signals.
 *
 * Specs are intentionally NOT persisted to localStorage — they are
 * proprietary strategy data that should only live in browser memory while
 * the user has an active authenticated session.
 */

import { useEffect, useState } from "react";
import { dcApi } from "../api/dcClient";
import type { DCStrategySpec } from "../api/dcTypes";

let cachedSpecs: DCStrategySpec[] | null = null;
let inflight: Promise<DCStrategySpec[] | null> | null = null;

interface State {
  specs: DCStrategySpec[] | null;
  loading: boolean;
  error: boolean;
}

export function useStrategySpecs(): State {
  const [state, setState] = useState<State>(() => ({
    specs: cachedSpecs,
    loading: cachedSpecs === null,
    error: false,
  }));

  useEffect(() => {
    if (cachedSpecs !== null) return;

    let cancelled = false;
    if (inflight === null) {
      inflight = dcApi.strategySpecs();
    }
    inflight
      .then((specs) => {
        if (cancelled) return;
        if (specs !== null) {
          cachedSpecs = specs;
          setState({ specs, loading: false, error: false });
        } else {
          setState({ specs: null, loading: false, error: true });
        }
      })
      .finally(() => {
        inflight = null;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
