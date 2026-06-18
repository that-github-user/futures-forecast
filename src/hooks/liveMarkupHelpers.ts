/**
 * Pure reducers for the live markup SSE hook — kept separate from React so
 * the merge logic (spot-window bounding + alert dedup + hide-when-empty) is
 * unit-testable without a DOM.
 */

import type { MarkupAlert, MarkupState } from "../api/terminalTypes";

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
