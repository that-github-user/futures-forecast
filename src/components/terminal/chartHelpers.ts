/**
 * Shared chart helpers consumed by both the desktop (ECharts) and
 * mobile (Lightweight Charts) chart implementations. Extracted from
 * the original `TerminalChartCanvas.tsx` to allow PR 2 of the
 * mobile-chart series to reuse the AVWAP cumulant + ETH/RTH
 * detection logic without duplicating the desktop's tested code.
 *
 * Pure functions only — no React, no chart-library dependencies.
 * The helpers operate on `TerminalIntradayBar[]` arrays and return
 * indices / values / arrays. Each chart implementation translates
 * those into its own series-data shape.
 */

import type { TerminalIntradayBar } from "../../api/terminalClient";
import type { VwapAnchorKey } from "./chartTypes";

// ── Bar aggregation ───────────────────────────────────────────────

/**
 * Bin 1-min bars into N-minute aggregated bars using UTC-clock-aligned
 * bucket boundaries (e.g. 5m → 09:30, 09:35, 09:40 …). Across-session
 * gaps don't span buckets because the session-open timestamp lands in
 * its own bucket. Each bar's bucket is the floor of `time / N` × N.
 *
 * `time` of the aggregated bar is the bucket-start ISO; OHLC follows
 * the standard convention (open = first bar's open, high/low =
 * extrema, close = last bar's close, volume = sum).
 *
 * Caveat for 4h: UTC-aligned 4h buckets (00/04/08/12/16/20 UTC) don't
 * line up with ET RTH-open at 13:30 UTC — RTH open lands mid-bucket
 * inside the 12:00-15:59 UTC bar. Acceptable for "structure read"
 * use of 4h; if RTH-open precision matters we'd need ET-anchored
 * bucketing for 4h only.
 */
export function aggregateBars(
  bars: TerminalIntradayBar[],
  minutes: number,
): TerminalIntradayBar[] {
  if (minutes <= 1 || bars.length === 0) return bars;
  const intervalMs = minutes * 60_000;
  const buckets = new Map<number, TerminalIntradayBar[]>();
  for (const b of bars) {
    const t = Date.parse(b.time);
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / intervalMs) * intervalMs;
    let group = buckets.get(key);
    if (!group) {
      group = [];
      buckets.set(key, group);
    }
    group.push(b);
  }
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
  const out: TerminalIntradayBar[] = [];
  for (const key of sortedKeys) {
    const group = buckets.get(key)!;
    if (group.length === 0) continue;
    const time = new Date(key).toISOString().replace(/\.\d{3}Z$/, "Z");
    let high = group[0].high;
    let low = group[0].low;
    let volume = 0;
    for (const b of group) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume;
    }
    out.push({
      time,
      open: group[0].open,
      high,
      low,
      close: group[group.length - 1].close,
      volume,
    });
  }
  return out;
}

// ── ET clock helpers ──────────────────────────────────────────────

export const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

export function etPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

// Globex is closed Fri 17:00 ET → Sun 18:00 ET. Without filtering, the
// daily anchor's "most recent 18:00 ET" can land on Sat or Fri evening
// (closed-market times). Restricting to Sun-Thu (the days that actually
// start a Globex daily session) keeps the anchor honest.
export const GLOBEX_DAILY_OPEN_DAYS: ReadonlySet<string> = new Set([
  "Sun", "Mon", "Tue", "Wed", "Thu",
]);
export const RTH_DAYS: ReadonlySet<string> = new Set([
  "Mon", "Tue", "Wed", "Thu", "Fri",
]);

/**
 * Walk back minute-by-minute from `latestMs` until ET clock matches
 * the target hh:mm (and optionally a weekday filter). Caps at 14 days
 * lookback (≥1 trading week of safety, holiday-tolerant) — returns
 * null if no match.
 */
export function findRecentEtMomentMs(
  latestMs: number,
  targetHour: number,
  targetMin: number,
  allowedWeekdays: ReadonlySet<string> | null,
): number | null {
  const MAX_MIN = 14 * 24 * 60;
  for (let offset = 0; offset < MAX_MIN; offset++) {
    const ms = latestMs - offset * 60_000;
    const parts = ET_FMT.formatToParts(new Date(ms));
    const hh = parseInt(etPart(parts, "hour"), 10);
    const mm = parseInt(etPart(parts, "minute"), 10);
    if (hh !== targetHour || mm !== targetMin) continue;
    if (allowedWeekdays) {
      const wk = etPart(parts, "weekday");
      if (!allowedWeekdays.has(wk)) continue;
    }
    return ms;
  }
  return null;
}

/**
 * Map an anchor-moment (UTC ms) to the largest aggregated-bar index
 * whose timestamp is ≤ anchorMs. The bucket spanning the anchor
 * moment is the correct starting point for cumulating from that
 * moment onward.
 */
export function indexForAnchorMs(
  bars: TerminalIntradayBar[],
  anchorMs: number,
): number {
  let idx = -1;
  for (let i = 0; i < bars.length; i++) {
    const t = Date.parse(bars[i].time);
    if (Number.isFinite(t) && t <= anchorMs) idx = i;
    else break;
  }
  return idx;
}

// ── RTH / ETH bar classification ───────────────────────────────────

/**
 * Whether a bar's bucket [bar.time, bar.time + timeframeMin) overlaps
 * the RTH cash-session window (09:30 ≤ ET clock < 16:00 on Mon-Fri).
 * Sub-hour timeframes nest cleanly inside or outside RTH.
 */
export function isRthBar(
  bar: TerminalIntradayBar,
  timeframeMin: number,
): boolean {
  const startMs = Date.parse(bar.time);
  if (!Number.isFinite(startMs)) return false;
  const lastMs = startMs + timeframeMin * 60_000 - 1;

  const inRth = (ms: number): boolean => {
    const parts = ET_FMT.formatToParts(new Date(ms));
    if (!RTH_DAYS.has(etPart(parts, "weekday"))) return false;
    const hh = parseInt(etPart(parts, "hour"), 10);
    const mm = parseInt(etPart(parts, "minute"), 10);
    const minutes = hh * 60 + mm;
    return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  };

  return inRth(startMs) || inRth(lastMs);
}

/**
 * Walk the bar buffer and collect [startIdx, endIdx] pairs for each
 * contiguous run of EXTENDED-hours (ETH) bars.
 */
export function buildEthShadeRanges(
  bars: TerminalIntradayBar[],
  timeframeMin: number,
): [number, number][] {
  const ranges: [number, number][] = [];
  let runStart = -1;
  for (let i = 0; i < bars.length; i++) {
    const inEth = !isRthBar(bars[i], timeframeMin);
    if (inEth && runStart === -1) runStart = i;
    else if (!inEth && runStart !== -1) {
      ranges.push([runStart, i - 1]);
      runStart = -1;
    }
  }
  if (runStart !== -1) ranges.push([runStart, bars.length - 1]);
  return ranges;
}

/**
 * Find the most-recent contiguous run of RTH bars in the buffer.
 * Used to bound the Opening Range — OR levels are only valid for
 * today's session, not overnight ETH.
 */
export function buildLatestRthRange(
  bars: TerminalIntradayBar[],
  timeframeMin: number,
): [number, number] | null {
  let last: [number, number] | null = null;
  let runStart = -1;
  for (let i = 0; i < bars.length; i++) {
    const inRth = isRthBar(bars[i], timeframeMin);
    if (inRth && runStart === -1) runStart = i;
    else if (!inRth && runStart !== -1) {
      last = [runStart, i - 1];
      runStart = -1;
    }
  }
  if (runStart !== -1) last = [runStart, bars.length - 1];
  return last;
}

// ── AVWAP anchor detection ─────────────────────────────────────────

/**
 * Week anchor: most-recent ≥36h gap between consecutive bars (= the
 * weekend halt). Falls back to the first bar in the buffer if no
 * such gap exists yet.
 */
export function findWeekAnchorIdx(bars: TerminalIntradayBar[]): number {
  if (bars.length === 0) return -1;
  const ANCHOR_GAP_MS = 36 * 60 * 60 * 1000;
  for (let i = bars.length - 1; i > 0; i--) {
    const t = Date.parse(bars[i].time);
    const tPrev = Date.parse(bars[i - 1].time);
    if (
      Number.isFinite(t)
      && Number.isFinite(tPrev)
      && t - tPrev >= ANCHOR_GAP_MS
    ) {
      return i;
    }
  }
  return 0;
}

export function findDailyGlobexAnchorIdx(
  bars: TerminalIntradayBar[],
): number {
  if (bars.length === 0) return -1;
  const latestMs = Date.parse(bars[bars.length - 1].time);
  if (!Number.isFinite(latestMs)) return -1;
  const ms = findRecentEtMomentMs(latestMs, 18, 0, GLOBEX_DAILY_OPEN_DAYS);
  if (ms == null) return -1;
  return indexForAnchorMs(bars, ms);
}

export function findRthAnchorIdx(bars: TerminalIntradayBar[]): number {
  if (bars.length === 0) return -1;
  const latestMs = Date.parse(bars[bars.length - 1].time);
  if (!Number.isFinite(latestMs)) return -1;
  const ms = findRecentEtMomentMs(latestMs, 9, 30, RTH_DAYS);
  if (ms == null) return -1;
  return indexForAnchorMs(bars, ms);
}

export function findAnchorIdx(
  key: VwapAnchorKey,
  bars: TerminalIntradayBar[],
): number {
  switch (key) {
    case "week":
      return findWeekAnchorIdx(bars);
    case "daily":
      return findDailyGlobexAnchorIdx(bars);
    case "rth":
      return findRthAnchorIdx(bars);
  }
}

// ── AVWAP cumulant computation ────────────────────────────────────

/**
 * Compute cumulative VWAP and stddev bands from `anchorIdx` onward.
 * Ports the volume-weighted variant of TradingView's anchored-VWAP +
 * VWSD bands:
 *   typical = (high + low + close) / 3
 *   VWAP[i]   = cumsum(typ × vol) / cumsum(vol)
 *   stddev[i] = sqrt(max(0, cumsum(typ² × vol)/cumsum(vol) − VWAP²))
 *
 * `inScope` (optional) gates which post-anchor bars contribute to the
 * cumulants AND emit a value. RTH passes a "Mon-Fri 09:30-16:00 ET"
 * predicate so the line only renders during cash-session bars.
 *
 * Returns an array aligned 1:1 with `bars`. Pre-anchor and
 * out-of-scope entries are `null`.
 */
export function vwapWithBandsSeries(
  bars: TerminalIntradayBar[],
  anchorIdx: number,
  inScope?: (bar: TerminalIntradayBar) => boolean,
): ({ vwap: number; stddev: number } | null)[] {
  const out: ({ vwap: number; stddev: number } | null)[] = new Array(bars.length).fill(null);
  if (anchorIdx < 0 || anchorIdx >= bars.length) return out;
  let cumTpVol = 0;
  let cumVol = 0;
  let cumTpSqVol = 0;
  for (let i = anchorIdx; i < bars.length; i++) {
    const b = bars[i];
    if (inScope && !inScope(b)) continue;
    const typ = (b.high + b.low + b.close) / 3;
    const vol = b.volume > 0 ? b.volume : 1;
    cumTpVol += typ * vol;
    cumVol += vol;
    cumTpSqVol += typ * typ * vol;
    if (cumVol > 0) {
      const vwap = cumTpVol / cumVol;
      const variance = Math.max(0, cumTpSqVol / cumVol - vwap * vwap);
      out[i] = { vwap, stddev: Math.sqrt(variance) };
    }
  }
  return out;
}

// ── LUMEN palette resolution ──────────────────────────────────────

export function resolveLumenPalette() {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const cs = root ? getComputedStyle(root) : null;
  const tok = (name: string, fallback: string): string => {
    const v = cs?.getPropertyValue(name).trim();
    return v && v.length > 0 ? v : fallback;
  };
  return {
    posCream: tok("--pos-cream", "#10b981"),
    negPersimmon: tok("--neg-persimmon", "#ef4444"),
    paperDeep: tok("--paper-deep", "#0f172a"),
    ink100: tok("--ink-100", "#f8fafc"),
    ink80: tok("--ink-80", "#e2e8f0"),
    ink60: tok("--ink-60", "#94a3b8"),
    ink40: tok("--ink-40", "#475569"),
    ink20: tok("--ink-20", "#1e293b"),
  };
}

export type LumenPalette = ReturnType<typeof resolveLumenPalette>;

// Per-anchor visual treatment shared between desktop + mobile.
// Desktop uses the lineWidth/bandWidth/dashBand fields directly;
// mobile maps them onto Lightweight Charts' line options.
export const VWAP_STYLES: Record<
  VwapAnchorKey,
  {
    label: string;
    color: keyof LumenPalette;
    lineWidth: number;
    bandWidth: number;
    dashBand: boolean;
  }
> = {
  week: { label: "Week", color: "ink100", lineWidth: 1.5, bandWidth: 1, dashBand: false },
  daily: { label: "Daily", color: "ink80", lineWidth: 1.25, bandWidth: 1, dashBand: true },
  rth: { label: "RTH", color: "ink60", lineWidth: 1.25, bandWidth: 0.75, dashBand: true },
};

/** Convert "#rrggbb" or "#rgb" → "rgba(r,g,b,a)" for tinted overlays. */
export function hexToRgba(hex: string, alpha: number): string {
  let s = hex.replace("#", "");
  if (s.length === 3) {
    s = s.split("").map((c) => c + c).join("");
  }
  const m = s.match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


// ── Bars-poll tick resolution ─────────────────────────────────────

import type { TerminalIntradayBarsResponse } from "../../api/terminalTypes";

/**
 * Decide what a bars-poll tick does with the client response, keeping
 * FAILURE (fetch returned null: API unreachable / unauthorized /
 * network throw swallowed by the client wrapper) distinct from a
 * LEGITIMATE empty payload (the server authoritatively says "no bars"
 * — cold IBKR start, day rollover).
 *
 *  - "apply": server payload is authoritative — replace bars and take
 *    its stale/data_age fields verbatim (a legit empty payload blanks
 *    the chart honestly: "No bars available").
 *  - "offline-warm": fetch failed over a warm chart — KEEP the candles
 *    but force the CACHED badge on. Frozen candles must never look
 *    live, and on this path there is no payload to drive the badge
 *    (the failure collapse would otherwise CLEAR it — reviewer MAJOR).
 *    stale-age is left untouched (last known value; the true age is
 *    unknown while the API is unreachable).
 *  - "offline-cold": fetch failed with nothing to show — surface the
 *    honest "No bars available" empty state (never wedge on
 *    "Loading…").
 */
export type BarsTickAction =
  | {
      kind: "apply";
      bars: TerminalIntradayBar[];
      stale: boolean;
      dataAgeSeconds: number | null;
    }
  | { kind: "offline-warm" }
  | { kind: "offline-cold" };

export function resolveBarsTick(
  prev: TerminalIntradayBar[] | null,
  data: TerminalIntradayBarsResponse | null,
): BarsTickAction {
  if (data === null) {
    return prev && prev.length > 0
      ? { kind: "offline-warm" }
      : { kind: "offline-cold" };
  }
  return {
    kind: "apply",
    bars: data.bars,
    stale: data.stale === true,
    dataAgeSeconds: data.data_age_seconds ?? null,
  };
}
