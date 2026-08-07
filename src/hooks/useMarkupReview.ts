/**
 * Data hook for the Markup Review pane (`/terminal/v1/markup/review`).
 *
 * A finalized session never changes, so a past date is fetched ONCE per
 * (date, tf). TODAY is different: the live overlay is built from the SSE spot
 * window alone, so a candle the spot stream missed for longer than that window
 * is only repairable from the authoritative IBKR bars — hence the `live`
 * re-poll, the backstop behind the live overlay's own healing. `refresh()`
 * still re-fetches on demand.
 *
 * A null response means offline/unauthorized — distinct from a successful EMPTY
 * session (data present, `alerts: []`), the legitimate "nothing captured for
 * this date" state.
 *
 * `loading` is DERIVED (the last settled result's key vs the current key) rather
 * than set synchronously in the effect, so a date change shows the loading state
 * without a cascading-render setState-in-effect. It keys on the VIEW (date|tf)
 * ALONE, never on the refresh nonce: a re-fetch of the SAME view must leave the
 * rendered session on screen, or a background poll would blank the pane once a
 * minute. The nonce only re-runs the fetch effect. `settleReview` holds the
 * matching rule for the FAILURE case — see there.
 */

import { useCallback, useEffect, useState } from "react";
import { mockMarkupReview } from "../api/mock";
import { terminal } from "../api/terminalClient";
import type { MarkupReviewResponse } from "../api/terminalTypes";
import { etMinutesOfDay } from "./liveMarkupHelpers";

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";
const LIVE_POLL_MS = 60_000;

// ET wall-clock bounds the background poll runs inside. Deliberately generous
// around the 09:30–16:00 cash session: the poll repairs the live chart and
// finalizes the alerts still accruing after the close, and a wide window costs
// only a handful of spare requests — while an idle tab left open overnight would
// otherwise fetch a session that finalized hours ago, once a minute until the ET
// date rolls. Gating on the DATA instead (bar freshness / pending_count) would
// be wrong: those are also the signature of a mid-session IBKR stall, i.e.
// exactly when the authoritative repair must keep polling.
const POLL_OPEN_MIN = 9 * 60; // 09:00 ET
const POLL_CLOSE_MIN = 17 * 60; // 17:00 ET

export interface MarkupReviewState {
  data: MarkupReviewResponse | null;
  loading: boolean;
  /** True only when the fetch returned null (offline / unauthorized) AND there
   *  is no session to show for this view. */
  offline: boolean;
  /** The last re-fetch of the rendered session failed — what's on screen is the
   *  last good payload, not a current one. */
  stale: boolean;
  refresh: () => void;
}

export interface Settled {
  /** The VIEW (`date|tf`) this result belongs to — what `loading` compares. */
  viewKey: string;
  data: MarkupReviewResponse | null;
  offline: boolean;
  stale: boolean;
}

/** Pure settle decision: what a fetch result writes into state given what is
 *  already there. Carved out of the hook (the `applyFetchResult` /
 *  `brokerStateDecision` pattern) so the eviction rule is pinned without a
 *  renderer.
 *
 *  `terminal.markupReview` collapses every network error and non-2xx to null,
 *  and the background poll makes that reachable once a minute with no user
 *  action. Evicting the rendered session on one transient failure would swap the
 *  chart for the offline message, and the chart UNMOUNTS — taking the operator's
 *  pan/zoom, the drawn live tail and the fitted time scale with it — for up to a
 *  full poll interval. That is the same "blank the pane once a minute" outcome
 *  the loading/nonce split exists to prevent, arriving through the offline door
 *  instead of the loading one. So a failed re-fetch of a view that already HAS a
 *  session keeps it and only raises `stale`; eviction is reserved for a view we
 *  never had (first load), where the offline message is the only thing to show. */
export function settleReview(
  prev: Settled | null,
  viewKey: string,
  r: MarkupReviewResponse | null,
  isDemo: boolean,
): Settled {
  if (r == null && prev?.viewKey === viewKey && prev.data != null) {
    return { ...prev, stale: true };
  }
  return { viewKey, data: r, offline: !isDemo && r == null, stale: false };
}

export function useMarkupReview(
  date: string,
  tf: "1m" | "5m" = "1m",
  live = false,
): MarkupReviewState {
  const [result, setResult] = useState<Settled | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const viewKey = `${date}|${tf}`;

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
      setResult((prev) => settleReview(prev, viewKey, r, IS_DEMO));
    };
    run();
    return () => {
      cancelled = true;
    };
    // `nonce` is a dep but not a body reference on purpose: it is the ONLY
    // thing that re-runs a fetch for an unchanged view, and it must stay out of
    // the stamped key so a re-fetch can't read as unsettled (see the header).
  }, [viewKey, nonce, date, tf]);

  // Background re-poll while viewing today. Demo mode is a static fixture and a
  // past session is final, so both stay single-fetch. Non-flashing by
  // construction: `loading` ignores the nonce, so the pane keeps rendering the
  // session it already has until the newer one lands.
  useEffect(() => {
    if (IS_DEMO || !live) return;
    const id = setInterval(() => {
      const m = etMinutesOfDay(Date.now() / 1000);
      // Unreadable clock parts → poll anyway; the repair matters more than the
      // spare request.
      if (m != null && (m < POLL_OPEN_MIN || m >= POLL_CLOSE_MIN)) return;
      refresh();
    }, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  const settled = result?.viewKey === viewKey;
  return {
    data: settled ? (result as Settled).data : null,
    loading: !settled,
    offline: settled ? (result as Settled).offline : false,
    stale: settled ? (result as Settled).stale : false,
    refresh,
  };
}
