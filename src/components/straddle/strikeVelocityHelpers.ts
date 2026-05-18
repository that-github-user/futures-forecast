/**
 * Pure data-shape helpers for `StrikeVelocityTape` (v4 lane redesign).
 *
 * Extracted from the React component so the per-minute volume math,
 * dominance color, price-to-y interpolation, and strike selection
 * can be pinned in a vitest spec without mounting the component (the
 * project has no @testing-library/react setup). Same convention as
 * `straddleMapHelpers.ts`.
 *
 * v4 lane redesign (#325, replaces #320 heatmap): per-strike rows
 * render as colored block lanes; spot + EM markers sit inside the
 * strike column as triangles at interpolated y-pixels. All ECharts
 * dependencies for this panel are gone — rendering is HTML/SVG.
 */

import type {
  VelocityMinute,
  VelocityStrike,
  VelocityTape,
} from "../../api/terminalTypes";

// ── Volume aggregates ──────────────────────────────────────────────

/** Sum a minute array's `volume` field. */
export function sumVolume(minutes: VelocityMinute[]): number {
  let total = 0;
  for (const m of minutes) total += m.volume;
  return total;
}

/** Compact k-formatter ("5,583" → "5.6k"; <1000 stays raw so the
 *  operator can still read exact volumes on illiquid strikes). */
export function formatVolume(v: number): string {
  if (v === 0) return "0";
  if (v < 1000) return v.toString();
  return `${(v / 1000).toFixed(1)}k`;
}

/** Total call+put volume across the entire window for one strike. */
export function rowTotalVolume(strike: VelocityStrike): number {
  return sumVolume(strike.call_minutes) + sumVolume(strike.put_minutes);
}

/** Per-strike session call/put split — used by the right-column split
 *  bar so the operator sees "this strike skewed N% calls today". */
export interface RowSplit {
  call: number;
  put: number;
  total: number;
}
export function rowSplit(strike: VelocityStrike): RowSplit {
  const call = sumVolume(strike.call_minutes);
  const put = sumVolume(strike.put_minutes);
  return { call, put, total: call + put };
}

/** Per-strike per-minute maximum of (call+put) total. Used as the
 *  upper bound for the lane's bar-height scale when `scaleMode ===
 *  "row"` — preserves contour on quiet strikes (every row's tallest
 *  bar always reaches the cell top). */
export function rowMaxVol(strike: VelocityStrike): number {
  // Bucket call and put volumes by timestamp so we can compute the
  // per-minute total (call+put at the same minute, not all calls or
  // all puts independently).
  const totals = new Map<string, number>();
  for (const m of strike.call_minutes) {
    totals.set(m.ts, (totals.get(m.ts) ?? 0) + m.volume);
  }
  for (const m of strike.put_minutes) {
    totals.set(m.ts, (totals.get(m.ts) ?? 0) + m.volume);
  }
  let max = 0;
  for (const v of totals.values()) if (v > max) max = v;
  // Return at least 1 so callers dividing by this never see 0/0.
  return Math.max(max, 1);
}

/** Panel-wide maximum of (call+put) per minute across every visible
 *  strike. Used when `scaleMode === "panel"` so a single tall bar on
 *  the day's standout strike dominates the panel; quieter strikes
 *  flatten correspondingly. */
export function panelMaxVol(
  tape: VelocityTape,
  visibleStrikes: number[],
): number {
  let max = 0;
  const visible = new Set(visibleStrikes);
  for (const s of tape.strikes) {
    if (!visible.has(s.strike)) continue;
    const m = rowMaxVol(s);
    if (m > max) max = m;
  }
  return Math.max(max, 1);
}

// ── Minute axis ────────────────────────────────────────────────────

/** Union of every (strike, side) minute timestamp the tape carries,
 *  sorted chronologically. ISO8601 ET strings with a uniform offset
 *  sort lexicographically in chronological order. */
export function buildMinuteAxis(tape: VelocityTape): string[] {
  const seen = new Set<string>();
  for (const s of tape.strikes) {
    for (const m of s.call_minutes) seen.add(m.ts);
    for (const m of s.put_minutes) seen.add(m.ts);
  }
  return Array.from(seen).sort();
}

/** Format an ISO8601-with-offset timestamp as a "HH:MM" wall-clock
 *  label (in the timestamp's own timezone — we trust the snapshotter
 *  to emit ET). Returns the raw string on parse failure so an
 *  upstream format drift doesn't render the axis silent.
 *
 *  Extracted directly from the ISO string rather than via Date —
 *  Date would re-apply the LOCAL browser timezone, but we want the
 *  wall-clock minute the snapshotter emitted (ET, regardless of
 *  where the browser is). */
export function formatMinuteLabel(ts: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(ts);
  if (!m) return ts;
  return `${m[1]}:${m[2]}`;
}

/** Per-tick "show this label?" mask for the time axis. Shows labels at
 *  wall-clock 5-min strides (`:00`/`:05`/.../`:55`) AND always shows
 *  the rightmost (live) label so the operator can read the current
 *  minute regardless of stride alignment. Parse failure → true
 *  (better to show garbage than have the axis go silent).
 *
 *  Collision avoidance (#322): when the live-minute label is NOT on a
 *  5-min stride AND the penultimate index IS on a stride, the two
 *  labels would sit one minute apart (e.g., `15:55` + `15:56 NOW`)
 *  and overlap visually at typical axis widths. In that case we
 *  suppress the penultimate stride label so the live-minute label
 *  reads cleanly. The dropped stride is at most one minute off the
 *  next surviving stride below (`15:50`), so the operator loses
 *  almost no temporal anchoring. Real-world frequency: ~1 minute out
 *  of every 5 = ~20% of replay windows that don't end exactly on a
 *  stride. */
export function buildXLabelMask(axis: string[]): boolean[] {
  const lastIdx = axis.length - 1;
  if (lastIdx < 0) return [];
  // Determine the last minute's stride status — drives collision check.
  const lastLabel = formatMinuteLabel(axis[lastIdx]);
  const lastMatch = /:(\d{2})$/.exec(lastLabel);
  // Parse-failure on the last index → treat as non-stride. Worst-case
  // collision: if we can't tell whether the live label is on a stride,
  // conservatively suppress an adjacent stride penultimate to avoid
  // potential overlap. The live label itself still renders via the
  // `i === lastIdx` early-return below.
  const lastIsStride = lastMatch ? Number(lastMatch[1]) % 5 === 0 : false;
  return axis.map((ts, i) => {
    if (i === lastIdx) return true;
    const label = formatMinuteLabel(ts);
    const m = /:(\d{2})$/.exec(label);
    if (!m) return true;
    const isStride = Number(m[1]) % 5 === 0;
    // Suppress the penultimate stride label when the live-minute label
    // is a non-stride one minute away — without this guard the two
    // labels overlap at typical 10px mono font widths.
    if (i === lastIdx - 1 && isStride && !lastIsStride) return false;
    return isStride;
  });
}

// ── Strike selection ──────────────────────────────────────────────

/** Pick which strikes from the tape to render, capped at `maxRows`,
 *  centered on `atmStrike` and ordered descending (highest at top).
 *
 *  v4 MVP: just take the closest-to-ATM strikes from whatever the
 *  snapshotter returned. Dynamic strike-step (5pt → 10pt → 25pt as
 *  EM widens) is queued as a separate follow-up — implementing it
 *  here would require knowing the snapshotter's strike grid step,
 *  which isn't a backend contract yet.
 *
 *  Caller is responsible for passing a sensible `atmStrike`; when
 *  null we fall back to the median tape strike. */
export function selectVisibleStrikes(
  tape: VelocityTape,
  atmStrike: number | null,
  maxRows = 15,
): number[] {
  const all = tape.strikes.map((s) => s.strike);
  if (all.length === 0) return [];
  if (all.length <= maxRows) return [...all].sort((a, b) => b - a);
  const anchor = atmStrike ?? all[Math.floor(all.length / 2)];
  // Sort by distance from ATM ascending, take the first maxRows, then
  // re-sort descending for display.
  return [...all]
    .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))
    .slice(0, maxRows)
    .sort((a, b) => b - a);
}

// ── Geometry ──────────────────────────────────────────────────────

/** Interpolate a price to a y-pixel offset within the strike-row stack.
 *
 *  `strikes` MUST be ordered descending (highest first) — that's how
 *  the renderer stacks rows (top → bottom). `rowH` is each row's pixel
 *  height. Returns 0 when the strike list is empty.
 *
 *  Outside-window clamping: prices ABOVE the highest strike clamp to
 *  the top row's center; prices BELOW the lowest strike clamp to the
 *  bottom row's center. This is intentional — production EM lines can
 *  fall outside the visible strike window, and we want the marker to
 *  pin to the edge rather than vanish.
 *
 *  Used by:
 *    - spot triangle (white)
 *    - EM upper / EM lower triangles (amber) */
export function priceToY(
  price: number,
  strikes: number[],
  rowH: number,
): number {
  if (strikes.length === 0) return 0;
  if (price >= strikes[0]) return rowH * 0.5;
  if (price <= strikes[strikes.length - 1]) {
    return (strikes.length - 0.5) * rowH;
  }
  for (let i = 0; i < strikes.length - 1; i++) {
    const hi = strikes[i];
    const lo = strikes[i + 1];
    if (price <= hi && price >= lo) {
      const frac = (hi - price) / (hi - lo);
      return (i + 0.5) * rowH + frac * rowH;
    }
  }
  // Unreachable given the prefix clamps; satisfies the type checker.
  return 0;
}

// ── Dominance color ───────────────────────────────────────────────

/** Diverging color for the call/put dominance encoding. Blue at the
 *  call-heavy extreme, amber at the put-heavy extreme, dark grey in
 *  the balanced middle band. Colorblind-safe (the blue↔amber axis is
 *  preserved across deuteranopia, protanopia, and tritanopia — unlike
 *  the red/green axis the heatmap originally tried).
 *
 *  Thresholds: callShare > 0.6 reads as call-heavy, < 0.4 as
 *  put-heavy, [0.4, 0.6] as balanced. The 0.6/0.4 gates are wide
 *  enough that small noisy minutes don't flicker between colors but
 *  narrow enough that the operator gets distinct hues on genuine
 *  imbalances.
 *
 *  Returns `"transparent"` for zero-volume cells so empty minutes
 *  render as panel background (matches the v4 mock — "no print this
 *  minute" reads as blank, not as a faint amber baseline). */
export function dominanceColor(call: number, put: number): string {
  const total = call + put;
  if (total === 0) return "transparent";
  const callShare = call / total;
  if (callShare > 0.6) {
    // 0.6 → light blue, 1.0 → saturated blue.
    const t = (callShare - 0.6) / 0.4;
    const r = Math.round(96 + (59 - 96) * t);
    const g = Math.round(165 + (130 - 165) * t);
    const b = Math.round(250 + (246 - 250) * t);
    return `rgb(${r},${g},${b})`;
  }
  if (callShare < 0.4) {
    const t = (0.4 - callShare) / 0.4;
    const r = Math.round(251 + (245 - 251) * t);
    const g = Math.round(191 + (158 - 191) * t);
    const b = Math.round(36 + (11 - 36) * t);
    return `rgb(${r},${g},${b})`;
  }
  // Balanced: a dark slate that reads as "no clear lean".
  return "#475569";
}

// ── Keyboard navigation (#331) ───────────────────────────────────

/** Compute the next focused cell given a key press + bounds.
 *
 *  Pure helper extracted from the component-side keyboard handler so
 *  the bounding arithmetic + key-mapping can be pinned in tests
 *  without mounting React. Returns:
 *    - the new `FocusedCell` to set
 *    - `"unchanged"` if the key isn't a nav key (caller doesn't
 *      preventDefault — the event bubbles to default browser
 *      behavior like Tab moving focus elsewhere)
 *    - `"clear"` if Escape was pressed (caller clears focus state +
 *      blurs the grid)
 *    - `"init"` if no cell is focused yet AND the key is a nav key
 *      (caller initializes at the live cell of the ATM row)
 *
 *  Bounds: rowIdx ∈ [0, maxRow], colIdx ∈ [0, maxCol]. Movement past
 *  an edge clamps; doesn't wrap (predictable navigation, no
 *  surprise jumps).
 */
export type NavResult =
  | { kind: "move"; rowIdx: number; colIdx: number }
  | { kind: "clear" }
  | { kind: "init" }
  | { kind: "unchanged" };

export function nextFocusedCell(
  key: string,
  current: { rowIdx: number; colIdx: number } | null,
  maxRow: number,
  maxCol: number,
): NavResult {
  const NAV_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    "Home", "End", "PageUp", "PageDown",
  ]);
  if (key === "Escape") return { kind: "clear" };
  if (current == null) {
    return NAV_KEYS.has(key) ? { kind: "init" } : { kind: "unchanged" };
  }
  const { rowIdx, colIdx } = current;
  switch (key) {
    case "ArrowLeft":
      return { kind: "move", rowIdx, colIdx: Math.max(0, colIdx - 1) };
    case "ArrowRight":
      return { kind: "move", rowIdx, colIdx: Math.min(maxCol, colIdx + 1) };
    case "ArrowUp":
      return { kind: "move", rowIdx: Math.max(0, rowIdx - 1), colIdx };
    case "ArrowDown":
      return { kind: "move", rowIdx: Math.min(maxRow, rowIdx + 1), colIdx };
    case "Home":
      return { kind: "move", rowIdx, colIdx: 0 };
    case "End":
      return { kind: "move", rowIdx, colIdx: maxCol };
    case "PageUp":
      return { kind: "move", rowIdx: 0, colIdx };
    case "PageDown":
      return { kind: "move", rowIdx: maxRow, colIdx };
    default:
      return { kind: "unchanged" };
  }
}

// ── Hover-tooltip geometry ────────────────────────────────────────

/** Map a mouse client-X coordinate to a column index inside a lane
 *  SVG. The lane SVG stretches a 1000-unit viewBox to fit the cell's
 *  pixel width, so the mapping is `floor((mouseX - rectLeft) / rectWidth
 *  * axisLength)`. Returns `-1` when the cursor is outside the cell
 *  (or `rectWidth`/`axisLength` is 0) so callers can use a single
 *  guard against the no-hit case.
 *
 *  Used by the hover-tooltip handler (#329) to locate which minute
 *  block the cursor sits over without per-rect event listeners (450+
 *  cells per panel — single delegated handler is cheaper). */
export function cellIndexFromX(
  mouseClientX: number,
  rect: { left: number; width: number },
  axisLength: number,
): number {
  if (!Number.isFinite(mouseClientX) || !Number.isFinite(rect.left) || !Number.isFinite(rect.width)) {
    return -1;
  }
  if (rect.width <= 0 || axisLength <= 0) return -1;
  const frac = (mouseClientX - rect.left) / rect.width;
  if (frac < 0 || frac >= 1) return -1;
  return Math.floor(frac * axisLength);
}

// ── Layout constants (exported for tests + CSS coordination) ──────

/** Row height in pixels. Lane SVGs have height: 100% of the cell, and
 *  the strike-column triangle overlay positions triangles at
 *  `(rowIndex + 0.5) * ROW_H` for on-strike prices, interpolated
 *  otherwise. Keep in sync with the CSS `.lane-row { height: 44px }`. */
export const ROW_H = 44;

/** Strike column width AT THE DESKTOP BREAKPOINT only — must match
 *  CSS `.svt-row` grid-template column 1 width. The triangle overlay
 *  positions at `left: 0; width: 96px` (default) so it overlaps the
 *  strike column exactly. CSS media queries override the width to
 *  78px (≤720px) and 64px (≤480px) for the overlay AND the grid
 *  column in lockstep; those responsive variants are owned by the
 *  CSS file and NOT reflected here. TS code does not consume this
 *  constant for any geometry computation — it's exported only to
 *  give the test suite a manual-discipline anchor against the CSS. */
export const STRIKE_COL_W = 96;

/** Max strike rows shown — caps panel height regardless of how many
 *  strikes the snapshotter returns. */
export const MAX_ROWS = 15;
