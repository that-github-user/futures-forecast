/**
 * Pure reducers for the live markup SSE hook — kept separate from React so
 * the merge logic (spot-window bounding + alert dedup + hide-when-empty) is
 * unit-testable without a DOM.
 */

import type {
  MarkupAlert,
  MarkupReviewAlert,
  MarkupState,
} from "../api/terminalTypes";

/** Drop spot points older than `windowMs` before the newest sample
 *  (timestamps are ~monotonic ET ISO strings). Falls back to a 300-point
 *  cap if a timestamp won't parse, so the series can never grow unbounded. */
export function boundSpotWindow(
  spots: [string, number][],
  windowMs: number,
): [string, number][] {
  if (spots.length === 0) return spots;
  const newest = Date.parse(spots[spots.length - 1][0]);
  if (Number.isNaN(newest)) return spots.length > 300 ? spots.slice(-300) : spots;
  const cutoff = newest - windowMs;
  let i = 0;
  while (i < spots.length && Date.parse(spots[i][0]) < cutoff) i++;
  return i > 0 ? spots.slice(i) : spots;
}

/** Compose the MarkupState the panel renders from the last `state` snapshot
 *  plus the live overlays: the locally-accumulated fine-grained spot series
 *  (smooth, sub-second) replaces the coarse one in `state`, and live alerts
 *  (since the last state) are prepended, deduped by `ts` against the
 *  authoritative `recent_alerts`.
 *
 *  Returns null when there's no active band (off-hours / cold start /
 *  offline) so the page HIDES the panel — matching the polling hook's
 *  null-means-hide contract. */
export function deriveLiveMarkup(
  base: MarkupState | null,
  spots: [string, number][],
  liveAlerts: MarkupAlert[],
): MarkupState | null {
  if (!base || base.band.length === 0) return null;
  const seen = new Set(base.recent_alerts.map((a) => a.ts));
  const recent_alerts: MarkupAlert[] = [
    ...liveAlerts.filter((a) => !seen.has(a.ts)),
    ...base.recent_alerts,
  ];
  return {
    ...base,
    spot_series: spots.length ? spots : base.spot_series,
    recent_alerts,
  };
}

/** A 1-minute OHLC candle, time in epoch SECONDS (lightweight-charts
 *  UTCTimestamp). Built client-side from the SPX spot stream. */
export interface LiveCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Build the CURRENT (forming) 1-minute candle from the live spot series —
 *  open = first sample of the minute, high/low = extremes, close = latest.
 *  Returns null when there are no parseable samples. The chart series.update()s
 *  this each tick; as the minute rolls, the new candle's later time appends a
 *  fresh bar (the previous one persists), so the live chart accretes candles
 *  without an unbounded accumulator here. (A live approximation of SPX OHLC —
 *  true IBKR 1m bars replace it on the next post-close fetch.) */
export function buildFormingCandle(
  spots: [string, number][],
): LiveCandle | null {
  if (spots.length === 0) return null;
  const lastMs = Date.parse(spots[spots.length - 1][0]);
  if (Number.isNaN(lastMs)) return null;
  const minuteStartMs = Math.floor(lastMs / 60_000) * 60_000;
  let open: number | null = null;
  let high = -Infinity;
  let low = Infinity;
  let close = 0;
  for (const [ts, price] of spots) {
    const t = Date.parse(ts);
    if (Number.isNaN(t) || t < minuteStartMs) continue;
    if (open === null) open = price;
    if (price > high) high = price;
    if (price < low) low = price;
    close = price;
  }
  if (open === null) return null;
  return { time: minuteStartMs / 1000, open, high, low, close };
}

/** The forming candle to overlay on the session chart — but ONLY when it
 *  actually extends the session. Returns null when the candle would float
 *  more than `maxGapS` past the last historical bar, which happens once SPX
 *  RTH has closed (the 1-min bars freeze at 16:00 ET while the spot keeps
 *  updating ES-derived) — otherwise a lone candle is drawn across a huge
 *  time gap. `lastBarTimeSec` is the last historical bar's time in epoch
 *  seconds (null when there are no bars yet → no gap to check). */
export function liveSessionCandle(
  spots: [string, number][],
  lastBarTimeSec: number | null,
  maxGapS: number,
): LiveCandle | null {
  const candle = buildFormingCandle(spots);
  if (!candle) return null;
  if (lastBarTimeSec != null && candle.time - lastBarTimeSec > maxGapS) {
    return null;
  }
  return candle;
}

/** Map a live MarkupAlert (the SSE/recent-alerts shape) to the review-alert
 *  shape the chart's marker builder consumes, as a PENDING alert (no forward
 *  outcome yet). `bar_time` is the alert floored to the minute (UTC ISO) for
 *  marker placement; dist-from-ATM is derived from the live center when known. */
export function liveAlertToReview(
  a: MarkupAlert,
  centerAtm: number | null,
): MarkupReviewAlert {
  const barMs = Math.floor(Date.parse(a.ts) / 60_000) * 60_000;
  return {
    alert_ts: a.ts,
    bar_time: new Date(barMs).toISOString(),
    side: a.side,
    direction: a.direction,
    status: "pending",
    strike: a.strike ?? null,
    dist_from_atm:
      a.strike != null && centerAtm != null ? a.strike - centerAtm : null,
    spread_z: a.spread_z,
    ask_jump: a.ask_jump,
    spot_at_alert: null,
    realized_move: null,
    mfe: null,
    t_mfe_s: null,
    mae: null,
    t_mae_s: null,
  };
}
