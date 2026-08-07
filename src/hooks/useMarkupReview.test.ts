/**
 * Tests for the Markup Review settle decision.
 *
 * The hook itself is effect-heavy and this project runs no renderer, so the
 * load-bearing rule is extracted as the pure `settleReview` (same pattern as
 * `applyFetchResult` / `brokerStateDecision`).
 *
 * The rule that matters: viewing TODAY re-polls every 60s, and the client
 * collapses every network error and non-2xx to null. A transient failure must
 * NOT evict the session already on screen — the pane would swap the chart for
 * the offline message, unmounting it and taking the operator's pan/zoom, the
 * drawn live tail and the fitted time scale with it, once a minute on a flaky
 * link. Eviction is only correct for a view we never had.
 */

import { describe, expect, it } from "vitest";
import type { MarkupReviewResponse } from "../api/terminalTypes";
import { settleReview, type Settled } from "./useMarkupReview";

const response = (
  over: Partial<MarkupReviewResponse> = {},
): MarkupReviewResponse => ({
  session_date: "20260730",
  timeframe: "1m",
  bars: [],
  alerts: [],
  pending_count: 0,
  bars_stale: false,
  bars_age_seconds: null,
  asof: "2026-07-30T10:47:00-04:00",
  ...over,
});

const settled = (over: Partial<Settled> = {}): Settled => ({
  viewKey: "20260730|1m",
  data: response(),
  offline: false,
  stale: false,
  ...over,
});

describe("settleReview", () => {
  it("a successful fetch settles the view", () => {
    const r = response({ pending_count: 3 });
    expect(settleReview(null, "20260730|1m", r, false)).toEqual({
      viewKey: "20260730|1m",
      data: r,
      offline: false,
      stale: false,
    });
  });

  it("keeps the rendered session when a background poll fails", () => {
    const prev = settled();
    const out = settleReview(prev, "20260730|1m", null, false);
    expect(out.data).toBe(prev.data); // same payload, still on screen
    expect(out.offline).toBe(false); // the pane must NOT swap in the offline msg
    expect(out.stale).toBe(true); // surfaced as a badge instead
  });

  it("goes offline when the FIRST fetch of a view fails", () => {
    expect(settleReview(null, "20260730|1m", null, false)).toEqual({
      viewKey: "20260730|1m",
      data: null,
      offline: true,
      stale: false,
    });
  });

  it("goes offline when a failure follows a settled-but-empty view", () => {
    // `data: null` for this view means we never had a session to protect.
    const prev = settled({ data: null, offline: true });
    expect(settleReview(prev, "20260730|1m", null, false).offline).toBe(true);
  });

  it("does not carry another view's session across a date change", () => {
    const prev = settled(); // 20260730
    const out = settleReview(prev, "20260729|1m", null, false);
    expect(out.data).toBeNull();
    expect(out.offline).toBe(true);
  });

  it("a recovered poll clears the stale flag", () => {
    const prev = settled({ stale: true });
    const r = response({ pending_count: 1 });
    expect(settleReview(prev, "20260730|1m", r, false).stale).toBe(false);
  });

  it("demo mode never reads as offline", () => {
    expect(settleReview(null, "20260730|1m", null, true).offline).toBe(false);
  });
});
