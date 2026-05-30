/**
 * Pure helpers for the MarkupPanel — SVG gradient-sparkline geometry +
 * alert formatting. No React, no DOM: everything here is unit-testable.
 *
 * The signature visual is the per-segment ASK gradient: each segment of
 * the ask line is colored by its local steepness (|Δask| per sample),
 * so a calm market draws a dim flat line and a market-maker markup (the
 * ask running away from the bid) draws a line that ramps from dim →
 * amber → hot-red exactly where the ask is accelerating. That is the
 * "gradient of intensity demonstrating the steep change" the signal is
 * about — see ~/.claude/plans/spread-tell-design.md.
 */

import type { MarkupAlert, MarkupBandStrike, MarkupState } from "../../api/terminalTypes";
import { colors } from "../../styles/tokens";

export interface SparkPoint {
  x: number;
  y: number;
}

export interface SparkSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Local ask steepness in [0,1] (|Δask| / SLOPE_REF, clamped). */
  intensity: number;
}

export interface SparkGeometry {
  bid: SparkPoint[];
  ask: SparkPoint[];
  /** SVG polygon path (ask top → bid bottom reversed) for the spread fill. */
  fillPath: string;
  /** Per-segment ask polyline with steepness intensity for coloring. */
  segments: SparkSegment[];
  /** y-pixel of the trailing-baseline spread reference (dashed line). */
  baselineY: number | null;
  yMin: number;
  yMax: number;
}

/** Ask jump per sample ($) that maps to full "hot" intensity. Samples
 *  are ~1s apart; a $0.50/sample lift is an unambiguous runaway. */
export const SLOPE_REF = 0.5;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Lerp two #rrggbb hex colors. `t` clamped to [0,1]. */
export function lerpHex(a: string, b: string, t: number): string {
  const tt = clamp01(t);
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mix = pa.map((c, i) => Math.round(c + (pb[i] - c) * tt));
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Steepness → color: dim slate → amber → hot red. */
export function intensityColor(intensity: number): string {
  const t = clamp01(intensity);
  return t < 0.5
    ? lerpHex(colors.textDim, colors.accentAmber, t / 0.5)
    : lerpHex(colors.accentAmber, colors.accentRed, (t - 0.5) / 0.5);
}

/** A shared wall-clock time window (epoch ms) so the three stacked panels
 *  map a given x to the SAME instant — the basis for the synced crosshair
 *  and for time-aligned alert markers. */
export interface TimeDomain {
  tMin: number;
  tMax: number;
}

/** Epoch-ms time → x-pixel for a shared domain. NOT clamped: a sample
 *  outside the window maps off-canvas (x < pad or > w-pad) and is clipped
 *  by the viewBox — consistent with the spot line, rather than piling
 *  out-of-window points onto the edge. (The mouse→time inverse `xToTime`
 *  IS clamped, since the cursor can't leave the panel.) */
export function timeToX(t: number, domain: TimeDomain, w: number, pad: number): number {
  const span = domain.tMax - domain.tMin || 1;
  return pad + ((t - domain.tMin) / span) * (w - 2 * pad);
}

/** Inverse of timeToX: x-pixel → epoch-ms (clamped to the domain). */
export function xToTime(x: number, domain: TimeDomain, w: number, pad: number): number {
  const span = domain.tMax - domain.tMin || 1;
  const frac = clamp01((x - pad) / (w - 2 * pad || 1));
  return domain.tMin + frac * span;
}

/**
 * Build sparkline geometry for one strike/side's rolling quote series.
 * `series` is [iso_ts, bid, ask][] (oldest→newest). Returns pixel-space
 * points scaled to [w,h] with `pad` inset. Empty/degenerate series →
 * null (caller renders the warmup placeholder).
 *
 * When `domain` is given, x is TIME-based against the shared window (so
 * this panel aligns with the others + the crosshair); otherwise x is
 * index-based (even spacing — the original single-panel behavior).
 */
export function sparkGeometry(
  series: [string, number, number][],
  w: number,
  h: number,
  pad = 2,
  baselineSpread: number | null = null,
  domain: TimeDomain | null = null,
): SparkGeometry | null {
  if (series.length < 2) return null;
  const n = series.length;
  const bids = series.map((s) => s[1]);
  const asks = series.map((s) => s[2]);
  const times = domain ? series.map((s) => new Date(s[0]).getTime()) : null;
  // The baseline reference (latest bid + the strike's "normal" spread)
  // must stay ON-canvas so the operator can see how far the ask has run
  // past it — include it in the y-domain rather than letting the line
  // clip off-screen (which read as a broken artifact). Anchored at the
  // latest bid so it sits at the ask level a calm market would show.
  const baselineLevel = baselineSpread != null ? bids[n - 1] + baselineSpread : null;
  const domainExtra = baselineLevel != null ? [baselineLevel] : [];
  const yMin = Math.min(...bids, ...domainExtra);
  const yMax = Math.max(...asks, ...domainExtra);
  const span = yMax - yMin || 1; // guard flat series
  const xAt =
    times && domain
      ? (i: number) => timeToX(times[i], domain, w, pad)
      : (i: number) => pad + (i / (n - 1)) * (w - 2 * pad);
  const yAt = (price: number) => h - pad - ((price - yMin) / span) * (h - 2 * pad);

  const bid: SparkPoint[] = series.map((s, i) => ({ x: xAt(i), y: yAt(s[1]) }));
  const ask: SparkPoint[] = series.map((s, i) => ({ x: xAt(i), y: yAt(s[2]) }));

  const segments: SparkSegment[] = [];
  for (let i = 1; i < n; i++) {
    segments.push({
      x1: ask[i - 1].x,
      y1: ask[i - 1].y,
      x2: ask[i].x,
      y2: ask[i].y,
      intensity: clamp01(Math.abs(asks[i] - asks[i - 1]) / SLOPE_REF),
    });
  }

  // Spread fill: ask line forward, bid line reversed → closed polygon.
  const fillPath =
    `M ${ask.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")} ` +
    `L ${[...bid].reverse().map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")} Z`;

  // Baseline reference y — always within [pad, h-pad] because
  // baselineLevel is folded into the y-domain above. Null when unknown.
  const baselineY = baselineLevel != null ? yAt(baselineLevel) : null;

  return { bid, ask, fillPath, segments, baselineY, yMin, yMax };
}

/**
 * Heat [0,1] of the current spread vs its baseline — drives the fill
 * tint (calm = dim, blown-out = hot). A spread `mult`× the baseline maps
 * to full heat; default 8× matches the validated $0.10→~$0.80+ blowout.
 */
export function spreadHeat(
  spread: number | null,
  baseline: number | null,
  mult = 8,
): number {
  if (spread == null || baseline == null || baseline <= 0) return 0;
  return clamp01((spread / baseline - 1) / (mult - 1));
}

export interface DirectionMeta {
  glyph: string;
  color: string;
  label: string;
}

/** call-side markup → spot UP (green ▲); put-side → DOWN (red ▼). */
export function directionMeta(direction: "up" | "down"): DirectionMeta {
  return direction === "up"
    ? { glyph: "▲", color: colors.accentGreen, label: "UP" }
    : { glyph: "▼", color: colors.accentRed, label: "DOWN" };
}

/** "spread $2.20 vs $0.15 · 27.6σ · ask +$2.50" */
export function formatAlertEvidence(a: MarkupAlert): string {
  return (
    `spread $${a.spread.toFixed(2)} vs $${a.baseline_spread.toFixed(2)} · ` +
    `${a.spread_z.toFixed(1)}σ · ask +$${a.ask_jump.toFixed(2)}`
  );
}

/** Compact "12s ago" / "3m ago" from an ISO ts relative to `now`. */
export function relativeAge(iso: string, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
}

/**
 * Pick the featured (call, put) entries for the strike nearest
 * `centerAtm` — the panel charts that one strike's two sides. Falls back
 * to the most-active strike (widest current spread) when centerAtm is
 * null. Returns nulls when the band lacks a side.
 */
export function pickFeatured(
  band: MarkupBandStrike[],
  centerAtm: number | null,
): { strike: number | null; call: MarkupBandStrike | null; put: MarkupBandStrike | null } {
  if (band.length === 0) return { strike: null, call: null, put: null };
  const strikes = [...new Set(band.map((b) => b.strike))];
  const target =
    centerAtm != null
      ? strikes.reduce((best, s) =>
          Math.abs(s - centerAtm) < Math.abs(best - centerAtm) ? s : best,
        )
      : strikes.reduce((best, s) => {
          const sw = Math.max(
            ...band.filter((b) => b.strike === s).map((b) => b.spread ?? 0),
          );
          const bw = Math.max(
            ...band.filter((b) => b.strike === best).map((b) => b.spread ?? 0),
          );
          return sw > bw ? s : best;
        });
  return {
    strike: target,
    call: band.find((b) => b.strike === target && b.side === "call") ?? null,
    put: band.find((b) => b.strike === target && b.side === "put") ?? null,
  };
}

/**
 * Geometry for the SPX spot overlay line. `series` is `[iso_ts, price][]`
 * (oldest→newest). Returns pixel points scaled to [w,h] plus the time
 * domain (epoch ms) so alert markers can be placed on the same x-axis.
 * Null for <2 points (panel shows a placeholder).
 */
export interface SpotGeometry {
  points: SparkPoint[];
  tMin: number;
  tMax: number;
  yMin: number;
  yMax: number;
}

export function spotLineGeometry(
  series: [string, number][],
  w: number,
  h: number,
  pad = 3,
  domain: TimeDomain | null = null,
): SpotGeometry | null {
  if (series.length < 2) return null;
  const ts = series.map((s) => new Date(s[0]).getTime());
  const prices = series.map((s) => s[1]);
  // Use the shared window when given (so the SPX line aligns with the
  // gradient panels + crosshair); else fall back to the series' own range.
  const tMin = domain ? domain.tMin : ts[0];
  const tMax = domain ? domain.tMax : ts[ts.length - 1];
  const tSpan = tMax - tMin || 1;
  const yMin = Math.min(...prices);
  const yMax = Math.max(...prices);
  const span = yMax - yMin || 1;
  const points = series.map((_, i) => ({
    x: pad + ((ts[i] - tMin) / tSpan) * (w - 2 * pad),
    y: h - pad - ((prices[i] - yMin) / span) * (h - 2 * pad),
  }));
  return { points, tMin, tMax, yMin, yMax };
}

/**
 * x-pixel for an alert's timestamp on the spot line's time axis, or null
 * when the alert falls outside the visible [tMin, tMax] window (so a
 * marker is only drawn where it can be read against the spot move).
 *
 * Note: an alert fired AFTER the last spot flush (`t > tMax`) is
 * intentionally omitted until the next ~5s sample extends the domain —
 * we never draw a marker past the end of the drawn spot line (it would
 * float in empty space). Alerts emit on tick, spot samples every ~5s, so
 * the worst-case lag is one flush (≤5s) and the marker self-heals.
 */
export function alertMarkerX(
  tsIso: string,
  tMin: number,
  tMax: number,
  w: number,
  pad = 3,
): number | null {
  const t = new Date(tsIso).getTime();
  if (Number.isNaN(t) || t < tMin || t > tMax) return null;
  const tSpan = tMax - tMin || 1;
  return pad + ((t - tMin) / tSpan) * (w - 2 * pad);
}

/**
 * The shared 120s window for the three stacked panels — `[tMax-120s, tMax]`
 * where tMax is the freshest timestamp across the band series, the spot
 * series, and `updated_at`. Mapping every panel to this one domain is
 * what makes "same x = same instant" hold for the synced crosshair and
 * the time-aligned alert markers.
 */
const SHARED_WINDOW_MS = 120_000;

function lastSampleTs(series: ReadonlyArray<readonly unknown[]>): number {
  return series.length ? new Date(series[series.length - 1][0] as string).getTime() : 0;
}

export function sharedTimeDomain(markup: MarkupState): TimeDomain {
  const candidates: number[] = [new Date(markup.updated_at).getTime()];
  for (const b of markup.band) {
    if (b.series.length) candidates.push(lastSampleTs(b.series));
  }
  if (markup.spot_series && markup.spot_series.length) {
    candidates.push(lastSampleTs(markup.spot_series));
  }
  // Guard against an unparseable ISO (NaN) poisoning the whole domain
  // (matches alertMarkerX's Number.isNaN precedent); fall back to now.
  const finite = candidates.filter(Number.isFinite);
  const tMax = finite.length ? Math.max(...finite) : Date.now();
  return { tMin: tMax - SHARED_WINDOW_MS, tMax };
}

export interface QuoteSample {
  bid: number;
  ask: number;
  spread: number;
}

/** Nearest (bid, ask, spread) in a quote series to time `t` (epoch ms),
 *  or null when empty — for the crosshair readout. */
export function quoteAtTime(
  series: [string, number, number][],
  t: number,
): QuoteSample | null {
  if (series.length === 0) return null;
  let best = series[0];
  let bestD = Infinity;
  for (const s of series) {
    const d = Math.abs(new Date(s[0]).getTime() - t);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { bid: best[1], ask: best[2], spread: +(best[2] - best[1]).toFixed(2) };
}

/** Nearest spot price in a spot series to time `t` (epoch ms), or null. */
export function spotAtTime(series: [string, number][], t: number): number | null {
  if (series.length === 0) return null;
  let best = series[0];
  let bestD = Infinity;
  for (const s of series) {
    const d = Math.abs(new Date(s[0]).getTime() - t);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best[1];
}
