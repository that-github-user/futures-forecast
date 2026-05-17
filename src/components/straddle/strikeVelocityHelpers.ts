/**
 * Pure data-shape helpers for `StrikeVelocityTape`.
 *
 * Extracted from the React component so the per-minute alignment +
 * total-volume + ECharts data-array math can be pinned in a vitest spec
 * without needing to mount the component (the project has no
 * @testing-library/react setup). Same rationale as
 * `straddleMapHelpers.ts` for the chart option builder.
 *
 * Heatmap redesign (#320): the previous SVG sparkline implementation
 * has been replaced with an ECharts heatmap. Spike minutes are now
 * encoded as a thick cell border instead of a separate glyph row, so
 * the spike-glyph helpers (`spikeGlyphsAt` etc.) have been retired in
 * favor of `buildHeatmapCells`. `densify` is no longer needed because
 * the heatmap consumes (col, row, value) tuples directly; null cells
 * simply aren't emitted.
 */

import { colors } from "../../styles/tokens";
import type {
  VelocityMinute,
  VelocityStrike,
  VelocityTape,
} from "../../api/terminalTypes";

/** Sum a minute array's `volume` field. Used for the per-row total
 *  volume scalar and for the header's "X contracts" total. */
export function sumVolume(minutes: VelocityMinute[]): number {
  let total = 0;
  for (const m of minutes) total += m.volume;
  return total;
}

/** Compact k-formatter for big-number readability ("5,583" → "5.6k").
 *  Values < 1000 stay raw, since the operator wants to see the exact
 *  per-row volume on illiquid strikes (where the call total may be
 *  a single-digit number). */
export function formatVolume(v: number): string {
  if (v === 0) return "0";
  if (v < 1000) return v.toString();
  return `${(v / 1000).toFixed(1)}k`;
}

/** Build a flat ordered list of minute timestamps covering the entire
 *  replay window — the union of every (strike, side) minute timestamp
 *  the tape carries. We need a stable per-minute axis so the call and
 *  put cells share an x-grid even when one side has missing minutes
 *  (illiquid put-side strikes on a call-skewed Friday close routinely
 *  have only 1-3 print minutes vs the call side's 25+). */
export function buildMinuteAxis(tape: VelocityTape): string[] {
  const seen = new Set<string>();
  for (const s of tape.strikes) {
    for (const m of s.call_minutes) seen.add(m.ts);
    for (const m of s.put_minutes) seen.add(m.ts);
  }
  // ISO8601 ET strings with a uniform offset sort lexicographically
  // in chronological order, so a plain string sort is correct.
  return Array.from(seen).sort();
}

/** Resolve the final strike-ordering for the rendered rows.
 *  `strikeOrder` from the parent (the chart's y-axis order) wins so
 *  the panel reads in the same direction as the chart; we filter it
 *  to strikes the tape actually carries (the tape is a focused ATM
 *  cluster subset, not the full chart axis). This is NOT a row-by-row
 *  lockstep alignment — the panel uses its own per-row pixel density,
 *  independent of how the chart packs its strikes. When the chart
 *  hasn't yet emitted an order (cold-start), fall back to the tape's
 *  own strikes sorted descending. */
export function resolveStrikeOrder(
  tape: VelocityTape,
  strikeOrder: number[] | undefined,
): number[] {
  const have = new Set(tape.strikes.map((s) => s.strike));
  if (strikeOrder && strikeOrder.length > 0) {
    return strikeOrder.filter((k) => have.has(k));
  }
  return [...tape.strikes.map((s) => s.strike)].sort((a, b) => b - a);
}

/** Per-row total volume = call volume sum + put volume sum across
 *  the replay window. Exposed as a helper so the test pins the math
 *  identically to the on-screen scalar. */
export function rowTotalVolume(strike: VelocityStrike): number {
  return sumVolume(strike.call_minutes) + sumVolume(strike.put_minutes);
}

// ── Heatmap helpers (#320 redesign) ─────────────────────────────────

/** One ECharts heatmap data point. The cell value is `[colIdx, rowIdx,
 *  totalVolume]` so the tooltip formatter can look back into the tape
 *  for the call/put split + spike flags via `params.value[0]` (col)
 *  and `params.value[1]` (row).
 *
 *  When a (strike, minute) cell coincides with either a call_spike or
 *  put_spike timestamp, we attach a per-point `itemStyle` with a thick
 *  red border so ECharts paints the spike border without us needing a
 *  separate series. ECharts merges this with the base series itemStyle. */
export interface HeatmapCell {
  value: [number, number, number];
  itemStyle?: { borderColor: string; borderWidth: number };
}

/** Spike-border styling. Exposed so tests can assert against the exact
 *  styling and so future tuning lives in one place. */
export const SPIKE_BORDER_COLOR = colors.accentRed;
export const SPIKE_BORDER_WIDTH = 2;

/** Build the ECharts heatmap data array.
 *
 *  Iterates each (strike, minute) pair and emits a cell with the
 *  combined call+put volume for that bucket. Cells with zero total
 *  volume are omitted entirely — ECharts renders nothing for missing
 *  data, so the heatmap reads "no print" as background, matching the
 *  visual contract of the warm gradient.
 *
 *  Spike cells get an `itemStyle` border applied per-point. Either side
 *  spiking flags the cell — the tooltip discloses which side via the
 *  formatter looking back at the raw call/put spike sets.
 *
 *  @param tape    The velocity tape (caller must ensure non-null)
 *  @param strikes Ordered strike list (row order, top→bottom). Strikes
 *                 the tape doesn't carry are skipped.
 *  @param axis    Ordered minute timestamp list (column order, L→R).
 *  @returns       ECharts heatmap data array
 */
export function buildHeatmapCells(
  tape: VelocityTape,
  strikes: number[],
  axis: string[],
): HeatmapCell[] {
  const strikeByKey = new Map<number, VelocityStrike>();
  for (const s of tape.strikes) strikeByKey.set(s.strike, s);

  const cells: HeatmapCell[] = [];
  for (let rowIdx = 0; rowIdx < strikes.length; rowIdx++) {
    const strike = strikeByKey.get(strikes[rowIdx]);
    if (!strike) continue;
    // Pre-index per-side per-minute volumes for O(1) lookup.
    const callByTs = new Map<string, number>();
    for (const m of strike.call_minutes) callByTs.set(m.ts, m.volume);
    const putByTs = new Map<string, number>();
    for (const m of strike.put_minutes) putByTs.set(m.ts, m.volume);
    const callSpikes = new Set(strike.call_spike_minutes);
    const putSpikes = new Set(strike.put_spike_minutes);

    for (let colIdx = 0; colIdx < axis.length; colIdx++) {
      const ts = axis[colIdx];
      const callVol = callByTs.get(ts) ?? 0;
      const putVol = putByTs.get(ts) ?? 0;
      const total = callVol + putVol;
      if (total <= 0) continue; // Skip empty cells — heatmap renders nothing.
      const isSpike = callSpikes.has(ts) || putSpikes.has(ts);
      const cell: HeatmapCell = { value: [colIdx, rowIdx, total] };
      if (isSpike) {
        cell.itemStyle = {
          borderColor: SPIKE_BORDER_COLOR,
          borderWidth: SPIKE_BORDER_WIDTH,
        };
      }
      cells.push(cell);
    }
  }
  return cells;
}

/** Build the SPX spot-path points for the small line chart above the
 *  heatmap. Returns `[timestamp, price]` tuples in chronological order
 *  for the ECharts `'time'` axis or a category axis (both accept the
 *  ISO string in position 0).
 *
 *  Returns `null` when the tape carries no spot_path, when the array is
 *  empty, or when fewer than 2 points exist (a single point can't form
 *  a line). The component renders the spot section conditionally on
 *  this returning a non-null value. */
export function buildSpotPathPoints(
  tape: VelocityTape,
): Array<[string, number]> | null {
  if (!tape.spot_path || tape.spot_path.length < 2) return null;
  return tape.spot_path.map((p) => [p.ts, p.price]);
}

/** Maximum cell volume across the heatmap, used as the `visualMap.max`
 *  upper bound. We scan the union of call+put volumes per (strike,
 *  minute) — the same combined-total the heatmap renders — so the
 *  color scale tops out at exactly the brightest cell on screen.
 *
 *  Returns 1 (not 0) on empty input so the ECharts visualMap doesn't
 *  collapse min===max, which would render every cell at the bottom of
 *  the gradient. The actual zero-data case is already handled by the
 *  component's empty-state placeholder upstream of this. */
export function computeMaxVolume(
  tape: VelocityTape,
  strikes: number[],
): number {
  const strikeByKey = new Map<number, VelocityStrike>();
  for (const s of tape.strikes) strikeByKey.set(s.strike, s);

  let max = 0;
  for (const k of strikes) {
    const strike = strikeByKey.get(k);
    if (!strike) continue;
    const callByTs = new Map<string, number>();
    for (const m of strike.call_minutes) callByTs.set(m.ts, m.volume);
    const putByTs = new Map<string, number>();
    for (const m of strike.put_minutes) putByTs.set(m.ts, m.volume);
    const allTs = new Set<string>();
    for (const m of strike.call_minutes) allTs.add(m.ts);
    for (const m of strike.put_minutes) allTs.add(m.ts);
    for (const ts of allTs) {
      const t = (callByTs.get(ts) ?? 0) + (putByTs.get(ts) ?? 0);
      if (t > max) max = t;
    }
  }
  return max > 0 ? max : 1;
}

/** Format an ISO8601 ET timestamp as a `HH:MM` ET label for the
 *  heatmap x-axis and tooltip ("15:42"). Mirrors the header-time format
 *  used by the component. Falls back to the raw string when Date parse
 *  fails (defensive — matches the panel's other formatters). */
export function formatMinuteLabel(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  });
}
