/**
 * Pure data-shape helpers for `StrikeVelocityTape`.
 *
 * Extracted from the React component so the per-minute alignment +
 * total-volume + format math can be pinned in a vitest spec without
 * needing to mount the component (the project has no
 * @testing-library/react setup). Same rationale as
 * `straddleMapHelpers.ts` for the chart option builder.
 */

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
 *  put sparklines share an x-grid even when one side has missing
 *  minutes (illiquid put-side strikes on a call-skewed Friday close
 *  routinely have only 1-3 print minutes vs the call side's 25+). */
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

/** Map a sparse minute array onto the dense per-axis grid, with
 *  `null` for minutes where this side has no print. The renderer
 *  draws a faint baseline tick for null entries (so the operator can
 *  tell "no print" from "off-axis"), so we must preserve length =
 *  axis.length rather than collapsing absent entries. */
export function densify(
  minutes: VelocityMinute[],
  axis: string[],
): Array<number | null> {
  const byTs = new Map<string, number>();
  for (const m of minutes) byTs.set(m.ts, m.volume);
  return axis.map((t) => byTs.get(t) ?? null);
}

/** Resolve the final strike-ordering for the rendered rows.
 *  `strikeOrder` from the parent (the chart's y-axis order) wins so
 *  rows line up with the chart; we filter it to strikes the tape
 *  actually carries. When the chart hasn't yet emitted an order
 *  (cold-start), fall back to the tape's own strikes sorted descending. */
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
