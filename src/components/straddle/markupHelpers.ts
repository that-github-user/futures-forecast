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

import type { MarkupAlert, MarkupBandStrike } from "../../api/terminalTypes";
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

/**
 * Build sparkline geometry for one strike/side's rolling quote series.
 * `series` is [iso_ts, bid, ask][] (oldest→newest). Returns pixel-space
 * points scaled to [w,h] with `pad` inset. Empty/degenerate series →
 * null (caller renders the warmup placeholder).
 */
export function sparkGeometry(
  series: [string, number, number][],
  w: number,
  h: number,
  pad = 2,
  baselineSpread: number | null = null,
): SparkGeometry | null {
  if (series.length < 2) return null;
  const n = series.length;
  const bids = series.map((s) => s[1]);
  const asks = series.map((s) => s[2]);
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
  const xAt = (i: number) => pad + (i / (n - 1)) * (w - 2 * pad);
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
