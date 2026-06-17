/**
 * Data hook for the Markup Review pane (`/terminal/v1/markup/review`).
 *
 * Post-close-first: a finalized session never changes, so this fetches ONCE per
 * (date, tf) rather than polling. `refresh()` re-fetches on demand (e.g. when
 * reviewing today and more alerts have finalized). A null response means
 * offline/unauthorized — distinct from a successful EMPTY session (data present,
 * `alerts: []`), the legitimate "nothing captured for this date" state.
 *
 * `loading` is DERIVED (the last settled result's key vs the current key) rather
 * than set synchronously in the effect, so a date change shows the loading state
 * without a cascading-render setState-in-effect.
 */

import { useCallback, useEffect, useState } from "react";
import { mockMarkupReview } from "../api/mock";
import { terminal } from "../api/terminalClient";
import type { MarkupReviewResponse } from "../api/terminalTypes";

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

export interface MarkupReviewState {
  data: MarkupReviewResponse | null;
  loading: boolean;
  /** True only when the fetch returned null (offline / unauthorized). */
  offline: boolean;
  refresh: () => void;
}

interface Settled {
  key: string;
  data: MarkupReviewResponse | null;
  offline: boolean;
}

export function useMarkupReview(
  date: string,
  tf: "1m" | "5m" = "1m",
): MarkupReviewState {
  const [result, setResult] = useState<Settled | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const key = `${date}|${tf}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // `await Promise.resolve(...)` defers the setState to a microtask even in
      // the synchronous demo branch, so state is never set synchronously in the
      // effect body.
      const r = await Promise.resolve(
        IS_DEMO ? mockMarkupReview(date) : terminal.markupReview(date, tf),
      );
      if (cancelled) return;
      setResult({ key, data: r, offline: !IS_DEMO && r == null });
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [key, date, tf]);

  const settled = result?.key === key;
  return {
    data: settled ? (result as Settled).data : null,
    loading: !settled,
    offline: settled ? (result as Settled).offline : false,
    refresh,
  };
}
