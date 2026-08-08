/**
 * Pure reducers for the live markup SSE hook — kept separate from React so the
 * merge logic (spot-window bounding + spot-series merge + candle bucketing +
 * alert dedup + hide-when-empty) is unit-testable without a DOM.
 */

import type {
  MarkupAlert,
  MarkupReviewAlert,
  MarkupState,
} from "../api/terminalTypes";
import {
  TF_SECONDS,
  floorEpochSec,
  type LiveCandle,
  type Timeframe,
} from "../lib/tfBuckets";

/** The span of spot samples the live hook keeps, matching the backend's
 *  `SPOT_WINDOW_S` overlay window. It lives beside the bucketer rather than in
 *  the hook because the bucketer's forming-candle allowance is only sound while
 *  a bucket fits inside it — two files agreeing on the number by coincidence is
 *  how that allowance would quietly start fabricating opens. */
export const SPOT_WINDOW_MS = 120_000;

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

/** Merge the server's coarse 5s `spot_series` into the locally-accumulated
 *  fine-grained SSE samples, deduped by instant, then re-bound to the window.
 *
 *  The server re-sends its whole 120s spot window on EVERY `state` event (~5s),
 *  so a gap in the fine-grained `spot` stream — a throttled background tab, a
 *  drop-oldest SSE queue eviction, a short network stall — is re-covered by the
 *  next state. Seeding the accumulator only while it was EMPTY threw that
 *  coverage away and left the gap permanent, which is how a whole 1-minute
 *  candle went missing from the live chart.
 *
 *  On a collision the EXISTING local sample wins: it is the higher-fidelity
 *  sub-second SSE sample, while the server series is a coarse 5s resample of the
 *  same instant. The server series only ever FILLS gaps.
 *
 *  Collisions are keyed on the parsed INSTANT, not the raw timestamp string. The
 *  two producers need not spell an instant identically (a sub-second local tick
 *  vs a whole-second server resample, an ET offset vs a Z suffix), and a string
 *  key would then keep BOTH — the coarse sample would land in the same minute
 *  bucket and widen that candle's high/low, which is exactly the fidelity loss
 *  the precedence rule exists to prevent.
 *
 *  Samples whose timestamp won't parse are dropped rather than sorted to some
 *  arbitrary end. They can be neither bucketed into a candle nor time-bounded,
 *  a NaN in the comparator would make the whole sort order
 *  implementation-defined, and sorting them oldest-first would halt
 *  boundSpotWindow's truncation scan at the first NaN and let the series grow
 *  unbounded. */
export function mergeSpotSeries(
  existing: [string, number][],
  incoming: [string, number][],
  windowMs: number,
): [string, number][] {
  const byMs = new Map<number, [string, number]>();
  for (const sample of incoming) {
    const ms = Date.parse(sample[0]);
    if (!Number.isNaN(ms)) byMs.set(ms, sample);
  }
  for (const sample of existing) {
    const ms = Date.parse(sample[0]);
    if (!Number.isNaN(ms)) byMs.set(ms, sample);
  }
  const merged = [...byMs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, sample]) => sample);
  return boundSpotWindow(merged, windowMs);
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

/** Build an OHLC candle for every drawable bucket of the display grid in the
 *  live spot window, ascending by time — open = first sample of the bucket,
 *  high/low = extremes, close = last, `lastSec` = the newest sample folded in.
 *
 *  Emitting only the newest sample's bucket (the old single-candle builder) made
 *  candle loss permanent: a bucket that was never "newest" at any recompute —
 *  because the spot stream gapped across it and only healed after the clock had
 *  rolled — could never be drawn, and the chart's monotonic guard seals it out
 *  the instant a later bucket is drawn. Emitting the whole window lets the
 *  chart apply the older bucket FIRST and heal the hole in the same pass.
 *
 *  `openTrusted` marks a bucket whose OPEN is a real open. `boundSpotWindow`
 *  truncates the series at an arbitrary instant, so the OLDEST bucket is
 *  normally PARTIAL and its first surviving sample is not that bucket's open —
 *  drawing it standalone would put a fabricated open and body on screen. A
 *  bucket earns the flag only if either:
 *    - a sample survives AT OR BEFORE the bucket's start (a sample landing
 *      exactly ON the boundary IS that bucket's open), which bounds the
 *      window's coverage back past the bucket, so its first sample is its open;
 *      or
 *    - it is the NEWEST bucket — the forming candle, partial by nature — AND the
 *      grid step fits inside the spot window at all.
 *
 *  That second condition is the whole reason this is parameterized rather than
 *  hard-coded: the forming-candle allowance is a claim that a partial bucket's
 *  first surviving sample is close enough to its start to BE its open, and a
 *  window shorter than the bucket makes that claim false by construction — a
 *  120s window covers the start of a 300s bucket for two minutes out of every
 *  five and fabricates it for the other three.
 *
 *  An untrusted bucket is still EMITTED when it is the newest one, and dropped
 *  otherwise. Withholding it entirely suppresses the chart's boundary merge with
 *  it — that merge takes the open from the fetched partial bar and only the
 *  close from here — which leaves three minutes out of every five at 5m with no
 *  live close at all, the exact stretch the merge exists for. Widening the trust
 *  rule instead would put a made-up open on screen; accumulating spot across
 *  renders would cover the bucket but could freeze a bad open for five minutes
 *  with no repair path, forfeiting the healing property above. An older
 *  untrusted bucket has nothing to add either way: it is past, so nothing will
 *  ever supply its open.
 *
 *  What the coverage test proves is the window's EXTENT, not the absence of an
 *  INTERIOR gap: if the stream itself gapped inside the bucket the open is
 *  approximate rather than an artifact of truncation, and the next merged state
 *  — or the authoritative re-poll — corrects it. An interior gap isn't
 *  observable from the samples, so no test on them can exclude it.
 *
 *  (A live approximation of SPX OHLC — true IBKR bars replace it on the next
 *  review fetch.) */
export function buildWindowCandles(
  spots: [string, number][],
  tf: Timeframe = "1m",
): LiveCandle[] {
  // Sorted defensively: both the per-minute open/close and the ascending output
  // depend on order, and the merge interleaves the server's 5s series with the
  // locally-accumulated sub-second samples.
  const samples: { ms: number; price: number }[] = [];
  for (const [ts, price] of spots) {
    const ms = Date.parse(ts);
    if (!Number.isNaN(ms)) samples.push({ ms, price });
  }
  if (samples.length === 0) return [];
  samples.sort((a, b) => a.ms - b.ms);

  const buckets = new Map<number, LiveCandle>();
  for (const { ms, price } of samples) {
    // Bucketed through the shared grid, never a local modulo — the live overlay
    // has to land on the same instants the fetched candles and the markers do.
    const startSec = floorEpochSec(Math.floor(ms / 1000), tf);
    const c = buckets.get(startSec);
    if (!c) {
      buckets.set(startSec, {
        time: startSec,
        open: price,
        high: price,
        low: price,
        close: price,
        lastSec: Math.floor(ms / 1000),
        // Decided in the emit pass below, which needs the whole window; the
        // placeholder is never read.
        openTrusted: false,
      });
      continue;
    }
    if (price > c.high) c.high = price;
    if (price < c.low) c.low = price;
    c.close = price;
    c.lastSec = Math.floor(ms / 1000);
  }

  // Insertion order is ascending because the samples are.
  const ordered = [...buckets.values()];
  const firstMs = samples[0].ms;
  const newestTime = ordered[ordered.length - 1].time;
  const formingAllowed = TF_SECONDS[tf] * 1000 <= SPOT_WINDOW_MS;
  const out: LiveCandle[] = [];
  for (const c of ordered) {
    const newest = c.time === newestTime;
    c.openTrusted = firstMs <= c.time * 1000 || (formingAllowed && newest);
    if (c.openTrusted || newest) out.push(c);
  }
  return out;
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

/** The live window's candles to overlay on the session chart — but ONLY the
 *  buckets inside the SPX cash session (09:30–16:00 ET). After 16:00 the IBKR
 *  bars freeze while the spot keeps ticking (ES-derived), so a live candle
 *  would float past the real session; before 09:30 there's no session yet. The
 *  gate is also what keeps the ES-derived spot out of the chart's boundary
 *  merge, where it would widen an SPX bar's range with another instrument's
 *  prints.
 *
 *  The filter is PER CANDLE, not all-or-nothing on the newest: a window
 *  straddling the open or the close must still contribute its in-session
 *  buckets, and dropping one candle must leave the rest ascending (the chart
 *  applies them in order, so a break in that order would cost a bar).
 *
 *  Gating on each MINUTE's own ET wall-clock — NOT on a gap from the last
 *  historical bar — is deliberate. The historical bars are fetched ONCE per
 *  session for a past date and only every 60s for today (useMarkupReview), so
 *  they go stale as the wall clock advances between fetches — which is how the
 *  old gap-from-seed check silently suppressed the LIVE candle ~5 min after page
 *  load (the freeze bug). A minute's own clock can't go stale.
 *
 *  Holiday / half-day SESSION gating is handled upstream: when the backend
 *  `live_window` flag is false the whole live overlay (candle + Tell) hides, so
 *  this only ever runs inside a real session window. (On a half-day the cash
 *  close is 13:00, which this 16:00 bound doesn't tighten — but `live_window`
 *  drops the overlay shortly after, capping any float to the curb window.)
 *
 *  Deliberately NOT clamped to the last historical bar: if IBKR's historical
 *  tail is stale/truncated mid-session the live candles may draw detached to
 *  their right (cosmetic; the pane shows a `bars stale` badge). That's preferred
 *  over clamping — a clamp against the last drawn bar would suppress the FIRST
 *  live bar after a truncated seed and, since the reference only advances when a
 *  bar is drawn, never recover: a freeze in the degraded case. Showing live
 *  price beats hiding it. */
export function liveSessionCandles(
  spots: [string, number][],
  tf: Timeframe = "1m",
): LiveCandle[] {
  return buildWindowCandles(spots, tf).filter((c) => isCashRthMinute(c.time));
}

/** Map a live MarkupAlert (the SSE/recent-alerts shape) to the review-alert
 *  shape the chart's marker builder consumes, as a PENDING alert (no forward
 *  outcome yet). dist-from-ATM is derived from the live center when known.
 *
 *  `bar_time` is floored to ONE MINUTE whatever the display timeframe, because
 *  the display grid is not this field's job: marker grouping and placement both
 *  derive from `alert_ts`, so a live strike and the fetched copy of the same
 *  event cluster together by construction. A tf-dependent floor here would only
 *  reintroduce the two-keys-for-one-event split that draws a phantom marker and
 *  halves the breadth badge. */
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
