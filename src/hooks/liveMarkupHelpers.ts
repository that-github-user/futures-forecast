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
  // Outside the markup live window (RTH + 15-min SPXW curb) the panel hides —
  // the detector is idle and only the ES-derived spot would still move.
  if (base.live_window === false) return null;
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

const ET_HM_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const RTH_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const RTH_CLOSE_MIN = 16 * 60; // 16:00 ET

/** ET minutes-since-midnight for an epoch-SECONDS timestamp, DST-correct via
 *  Intl (the offset flips EDT/EST with the date, so a fixed UTC offset would be
 *  wrong half the year). Returns null if the parts can't be read. */
export function etMinutesOfDay(sec: number): number | null {
  const parts = ET_HM_FMT.formatToParts(new Date(sec * 1000));
  let hh: number | null = null;
  let mm: number | null = null;
  for (const p of parts) {
    if (p.type === "hour") hh = Number(p.value);
    else if (p.type === "minute") mm = Number(p.value);
  }
  if (hh == null || mm == null || Number.isNaN(hh) || Number.isNaN(mm)) {
    return null;
  }
  // en-US + hour12:false renders midnight as "24" in some engines — normalize.
  if (hh === 24) hh = 0;
  return hh * 60 + mm;
}

/** Is the given minute (epoch seconds) inside the SPX cash RTH session
 *  [09:30, 16:00) ET? */
export function isCashRthMinute(sec: number): boolean {
  const m = etMinutesOfDay(sec);
  if (m == null) return false;
  return m >= RTH_OPEN_MIN && m < RTH_CLOSE_MIN;
}

/** The forming candle to overlay on the session chart — but ONLY while the SPX
 *  cash session (09:30–16:00 ET) is open. After 16:00 the IBKR 1-min bars
 *  freeze while the spot keeps ticking (ES-derived), so a forming candle would
 *  float past the real session; before 09:30 there's no session yet.
 *
 *  Gating on the forming MINUTE's own ET wall-clock — NOT on a gap from the
 *  last historical bar — is deliberate. The historical bars are fetched ONCE
 *  per session (useMarkupReview) and go stale as the wall clock advances, so
 *  the old gap-from-seed check silently suppressed the LIVE candle ~5 min after
 *  page load (the freeze bug). A minute's own clock can't go stale.
 *
 *  Holiday / half-day SESSION gating is handled upstream: when the backend
 *  `live_window` flag is false the whole live overlay (candle + Tell) hides, so
 *  this only ever runs inside a real session window. (On a half-day the cash
 *  close is 13:00, which this 16:00 bound doesn't tighten — but `live_window`
 *  drops the overlay shortly after, capping any float to the curb window.)
 *
 *  Deliberately NOT clamped to the last historical bar: if IBKR's historical
 *  tail is stale/truncated mid-session the live candle may draw detached to its
 *  right (cosmetic; the pane shows a `bars stale` badge). That's preferred over
 *  clamping — a clamp against the last drawn bar would suppress the FIRST live
 *  bar after a truncated seed and, since the reference only advances when a bar
 *  is drawn, never recover: a freeze in the degraded case. Showing live price
 *  beats hiding it. */
export function liveSessionCandle(
  spots: [string, number][],
): LiveCandle | null {
  const candle = buildFormingCandle(spots);
  if (!candle) return null;
  return isCashRthMinute(candle.time) ? candle : null;
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
