/**
 * The Markup Review DISPLAY GRID — the one place that decides which epoch second
 * a bar, a marker or a live spot bucket is drawn at, the fold from the 1-minute
 * bars the API always serves onto that grid, and the rule that decides what the
 * live spot window is allowed to contribute at the boundary between the two
 * sources.
 *
 * `/terminal/v1/markup/review` fetches `barSizeSetting="1 min"` for every `tf`
 * and only uses `tf` to floor each alert's `bar_time`, so the candles are the
 * client's to aggregate. Doing it here — rather than asking IBKR for 5-minute
 * bars — keeps one immutable historical-cache slot per past session and adds no
 * second fetch against a fetcher that already runs a circuit breaker.
 *
 * Lives in lib/ rather than components/markup/ because hooks/liveMarkupHelpers
 * buckets the live spot window onto the SAME grid, and hooks/ must not reach
 * into components/. A second copy of the flooring is exactly the divergence this
 * module exists to make impossible.
 */

import type { TerminalIntradayBar } from "../api/terminalTypes";

/** Display timeframe — the `tf` query param of the review endpoint. */
export type Timeframe = "1m" | "5m";

/** Grid step, seconds. */
export const TF_SECONDS: Record<Timeframe, number> = { "1m": 60, "5m": 300 };

/** The bar size the review endpoint serves at EVERY `tf`. Named because the
 *  coverage arithmetic below turns the newest bar's START into the instant the
 *  payload runs THROUGH, and that is only sound while the bars are 1-minute. */
const FETCHED_BAR_SECONDS = 60;

/**
 * Floor an epoch second onto the display grid.
 *
 * `Math.floor(sec / step) * step` is bit-for-bit the server's `epoch - epoch %
 * tf_s`, so a client-placed marker and a server-floored `bar_time` land on the
 * same instant BY CONSTRUCTION rather than by two implementations agreeing.
 *
 * The grid is UTC-modulo, while every conviction reading is anchored to the
 * 09:30 ET open. The two coincide only because ET's UTC offset is a whole number
 * of hours in both DST regimes and 86400 % 300 === 0: that puts 09:30 ET
 * (570 min = 114 × 5) and every time-of-day edge (0/30/120/240/360 min after the
 * open) on the grid, so flooring can only move an instant back inside its own
 * bucket and can never re-score it. A venue on a half-hour UTC offset, or a
 * time-of-day edge moved to a non-5-aligned minute, silently breaks that. Both
 * are pinned by test so the assumption fails loudly instead.
 */
export function floorEpochSec(sec: number, tf: Timeframe): number {
  const step = TF_SECONDS[tf];
  return Math.floor(sec / step) * step;
}

/**
 * Fold 1-minute OHLCV bars onto the display grid: first open, max high, min low,
 * last close, summed volume.
 *
 * A LOSSLESS PARTITION. Every input bar lands in exactly one output bucket and
 * no bucket is invented: a halt, a feed gap or a pre-open stretch must read as
 * an ABSENT candle, never a flat synthesized one, because a flat candle is
 * indistinguishable from a real unchanged bar and the pane's whole job is
 * reading excursions against bar range. The trailing bucket is emitted partial —
 * the newest bucket of a live session is always still forming.
 *
 * `tf === "1m"` returns the input BY IDENTITY, so nothing here can touch the
 * default path.
 *
 * open/close come from the bucket's earliest/latest bar BY TIMESTAMP, not by
 * array position, so the fold is a function of the bar set alone and a payload
 * that ever arrives out of order cannot invert a candle's body.
 *
 * NOT named `aggregateBars`: `components/terminal/chartHelpers` already exports
 * that name for the terminal chart's own N-minute binning, which stamps the
 * bucket start with a different ISO spelling and takes minutes rather than a
 * `Timeframe`. Two same-named exports doing nearly-the-same job is how an
 * autocompleted import silently changes which grid a chart draws on.
 */
export function foldToGrid(
  bars: TerminalIntradayBar[],
  tf: Timeframe,
): TerminalIntradayBar[] {
  if (tf === "1m") return bars;
  interface Fold {
    bucket: number;
    firstSec: number;
    lastSec: number;
    bar: TerminalIntradayBar;
  }
  const folds = new Map<number, Fold>();
  for (const b of bars) {
    const sec = Math.floor(Date.parse(b.time) / 1000);
    // A bar whose timestamp won't parse can be neither bucketed nor ordered, and
    // a NaN key would fabricate one candle at an unplottable time holding every
    // such bar. Drop it rather than corrupt a real bucket.
    if (!Number.isFinite(sec)) continue;
    const bucket = floorEpochSec(sec, tf);
    const f = folds.get(bucket);
    if (!f) {
      folds.set(bucket, {
        bucket,
        firstSec: sec,
        lastSec: sec,
        // Restamped to the BUCKET start: the grid is what the markers are placed
        // on, so a candle keyed at its first constituent minute would sit off it.
        bar: { ...b, time: new Date(bucket * 1000).toISOString() },
      });
      continue;
    }
    if (b.high > f.bar.high) f.bar.high = b.high;
    if (b.low < f.bar.low) f.bar.low = b.low;
    f.bar.volume += b.volume;
    if (sec < f.firstSec) {
      f.firstSec = sec;
      f.bar.open = b.open;
    }
    if (sec > f.lastSec) {
      f.lastSec = sec;
      f.bar.close = b.close;
    }
  }
  return [...folds.values()].sort((a, b) => a.bucket - b.bucket).map((f) => f.bar);
}

/**
 * The epoch second the fetched payload runs THROUGH — the newest 1-minute bar's
 * start plus its own length. `-Infinity` for an empty/unparseable payload, which
 * reads as "IBKR covers nothing" and lets the live overlay stand alone.
 *
 * Taken as the MAXIMUM over the payload rather than its last element: the fold
 * above is already order-independent, and a coverage bound derived from array
 * position would be the one place a mis-ordered payload could hand the live
 * approximation authority over a minute IBKR had already delivered.
 */
export function barsCoverageEndSec(bars: TerminalIntradayBar[]): number {
  let newest = -Infinity;
  for (const b of bars) {
    const sec = Math.floor(Date.parse(b.time) / 1000);
    if (Number.isFinite(sec) && sec > newest) newest = sec;
  }
  return newest === -Infinity ? -Infinity : newest + FETCHED_BAR_SECONDS;
}

/** The OHLC the fetched bars and the live spot candles have in common. */
export interface BucketOhlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** One display-grid OHLC bucket built from the SPX spot stream, time in epoch
 *  SECONDS (lightweight-charts UTCTimestamp) at the bucket's START.
 *
 *  `lastSec` and `openTrusted` are what let the chart place the bucket without
 *  re-deriving anything about the spot window:
 *   - `lastSec` — the newest sample folded into it. The live overlay may only
 *     contribute where it knows something the IBKR bars do not, and this is the
 *     only field that can establish that.
 *   - `openTrusted` — the bucket's open is a real open rather than the first
 *     sample that happened to survive window truncation. False buckets are
 *     merge-only; they can never be drawn standalone. */
export interface LiveCandle extends BucketOhlc {
  time: number;
  lastSec: number;
  openTrusted: boolean;
}

/**
 * Merge the live spot bucket into a bucket that shares its start and carries an
 * authoritative OPEN — the fetched partial bar, or (when IBKR has not reached
 * the bucket at all) the live candle already drawn for it.
 *
 * The two sides cover disjoint stretches of one forming bucket, so neither alone
 * is the bucket: the authoritative side runs to the last minute the 60s poll
 * captured, the spot window covers the seconds since. Which field comes from
 * where is therefore fixed, not a preference:
 *   - OPEN from the authoritative side. It is the bucket's real first print. The
 *     live bucket's open is only its first client-visible spot sample, and the
 *     120s spot window cannot reach the start of a 300s bucket at all — that
 *     open is fabricated for three minutes out of every five, which is exactly
 *     the stretch this merge exists to cover.
 *   - HIGH/LOW widened. Each source sees excursions the other never sampled, and
 *     an excursion is exactly what this pane reads MFE/MAE against.
 *   - CLOSE from the live bucket. Sound only because `liveBucketDraw` has
 *     already established that the live samples run PAST what the fetched bars
 *     cover; a spot feed that wedges mid-bucket keeps re-offering a frozen close
 *     that would otherwise outrank a strictly fresher IBKR one after every poll,
 *     flickering the tail candle backwards once a minute.
 *
 * Both sides are SPX cash here — the live overlay is gated to cash RTH upstream,
 * so the ES-derived post-close spot never reaches this merge and cannot widen an
 * SPX bar's range with a different instrument's prints.
 */
export function mergeBoundaryBucket(
  authoritative: BucketOhlc,
  liveBucket: BucketOhlc,
): BucketOhlc {
  return {
    open: authoritative.open,
    high: Math.max(authoritative.high, liveBucket.high),
    low: Math.min(authoritative.low, liveBucket.low),
    close: liveBucket.close,
  };
}

/** What the chart holds about the newest FETCHED candle — the reference every
 *  live bucket is placed against. Null when the payload carried no bars. */
export interface FetchedTail {
  /** Display-grid start of the newest fetched candle. */
  time: number;
  ohlc: BucketOhlc;
  /** Epoch second the 1-minute payload runs through (`barsCoverageEndSec`). */
  coverageEndSec: number;
}

/**
 * What one live spot bucket draws as, or null to leave the series alone.
 *
 * Pure so the whole dispatch is pinned by test rather than only the merge inside
 * it — this is where a wrong branch silently replaces an authoritative bar with
 * an approximation, and the chart component itself has no test harness.
 *
 * In order:
 *   - BELOW the fetched tail — an IBKR bar already covers the bucket. Never
 *     overwrite truth with the spot approximation: the live bucket is built from
 *     client-visible samples only, so its high/low miss every excursion between
 *     them. (This is NOT the clamp `liveSessionCandles` rejects. That one
 *     referenced the last DRAWN bar, which only advances when a bar is drawn and
 *     so could freeze the overlay permanently; this reference advances from the
 *     API alone, and a hole is by definition past it, so healing is unaffected.)
 *   - ADDS NOTHING PAST THE PAYLOAD — the live samples all predate the instant
 *     the fetched bars run through, so IBKR already knows everything this bucket
 *     does and knows it better. This is the guard that keeps the default 1m path
 *     byte-identical: there the fetched tail is a COMPLETED minute, so the live
 *     copy of that minute adds nothing and must not restate its close. It is
 *     also what stops a wedged spot feed re-asserting a frozen close over a
 *     fresher bar after every poll.
 *   - AT the fetched tail — both sides describe the SAME bucket, partially.
 *     Dropping the live side here is what left the 5m overlay dead: at 5m the
 *     trailing fetched bucket always shares the live bucket's start, so the tail
 *     would have rendered only while the IBKR bars were STALE — exactly
 *     backwards.
 *   - ABOVE it with a trustworthy open — IBKR has not reached the bucket; the
 *     live candle stands alone.
 *   - ABOVE it WITHOUT one — the open would be fabricated, so the bucket may
 *     only extend what is already drawn for it. Without that, a 5m bucket under
 *     stale IBKR bars would freeze at the two minutes the spot window covered
 *     and read as a complete five-minute candle. Nothing drawn yet and nothing
 *     authoritative to merge into means the honest answer is no candle.
 */
export function liveBucketDraw(
  lb: LiveCandle,
  tail: FetchedTail | null,
  drawn: BucketOhlc | undefined,
): BucketOhlc | null {
  if (tail) {
    if (lb.time < tail.time) return null;
    if (lb.lastSec < tail.coverageEndSec) return null;
    if (lb.time === tail.time) {
      // Fold what is already drawn in before merging, for the same reason the
      // no-tail branch below does: the 120s spot window slides, so an excursion
      // it sampled earlier in the bucket is gone from `lb` by the next render,
      // and a bucket's high must never RETRACT while it forms. Bounded by the
      // bars effect retiring the tail's drawn entry on every poll, so a fresh
      // IBKR bar still supersedes rather than accumulating forever.
      const live = drawn ? mergeBoundaryBucket(drawn, lb) : lb;
      return mergeBoundaryBucket(tail.ohlc, live);
    }
  }
  if (lb.openTrusted) {
    return { open: lb.open, high: lb.high, low: lb.low, close: lb.close };
  }
  return drawn ? mergeBoundaryBucket(drawn, lb) : null;
}
