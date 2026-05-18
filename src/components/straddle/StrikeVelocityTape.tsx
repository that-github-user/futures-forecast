/**
 * StrikeVelocityTape (v4 lane redesign — #325).
 *
 * Replaces the ECharts heatmap that shipped in PR #206 (#320). The
 * heatmap had structural problems the operator flagged:
 *   1. Warm-gradient color (amber → red) is colorblind-hostile.
 *   2. The sibling SPX line chart couldn't align with the discrete-
 *      time heatmap grid; auto-scaled price y-axis drifted between
 *      refreshes; operator had to "look all the way to the left" to
 *      read price.
 *   3. ITM/OTM tags in the right column were side-dependent and
 *      ambiguous for a strike trading both calls and puts.
 *
 * v4 design (locked in static mock at ~/.claude/plans/velocity-
 * lanes-mock/):
 *   - One row per strike, one BLOCK per minute. Block height encodes
 *     total (call+put) volume; block color encodes which side
 *     dominates via a colorblind-safe blue ↔ grey ↔ amber diverging
 *     palette. Spike minutes wear a bright-white outline (NOT red —
 *     red-on-amber-gradient was invisible in #206).
 *   - Spot + EM markers as right-pointing triangles INSIDE the strike
 *     column (left-aligned, at interpolated y-pixels between rows).
 *     Numeric values live in a panel-head readout, not next to each
 *     marker, so the chart body has nothing left to overlap.
 *   - Right column: per-strike session call/put split bar. Collapses
 *     below 720px viewport via media query.
 *   - Per-row / panel-wide normalization toggle in the panel head.
 *     Default per-row so quiet strikes still show contour.
 *
 * Critical SVG note: `width: 100%; height: 100%` on the lane SVG plus
 * `min-width: 0` on the cell — otherwise SVG keeps its intrinsic
 * 300px width and the rightmost minutes overflow. v3 mock had this
 * bug; v4 + this implementation fix it. CSS lives in
 * `StrikeVelocityTape.css`.
 */

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import type { VelocityTape } from "../../api/terminalTypes";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import { InfoPopover } from "../common/InfoPopover";
import {
  buildMinuteAxis,
  buildXLabelMask,
  cellIndexFromX,
  dominanceColor,
  formatMinuteLabel,
  formatVolume,
  MAX_ROWS,
  nextFocusedCell,
  panelMaxVol,
  priceToY,
  rowMaxVol,
  rowSplit,
  rowTotalVolume,
  ROW_H,
  selectVisibleStrikes,
} from "./strikeVelocityHelpers";
import "./StrikeVelocityTape.css";

// ── Constants (kept inside the file rather than tokens because they
// describe lane GEOMETRY specifically, not theme primitives) ──────
const LANE_VIEWBOX_W = 1000;
const LANE_VIEWBOX_H = 40;
const LANE_CELL_PAD = 1;
/** Cell-spike outline color/width. Bright-white (textBright) so it
 *  remains visible against the saturated dominance hues at the peak
 *  of the gradient — the #206 round-1 review caught red-on-red being
 *  invisible at hot cells. */
const SPIKE_STROKE = colors.textBright;
const SPIKE_STROKE_W = 1.5;

/**
 * Cold-start contract for the headline fields (spot, emUpper, emLower,
 * atmStrike). Per the snapshotter at
 *   automated-dc-entry/futures_terminal/systems/straddle_chain.py:822-823
 * `em_upper = spot + atm_straddle_mid` and `em_lower = spot -
 * atm_straddle_mid` — all four fields populate atomically. Either every
 * field is non-null (live snapshot) or every field is null (cold-start
 * before the first snapshot of the session). The component handles
 * both shapes:
 *   - All non-null: triangles + ATM amber highlight + numeric chips.
 *   - All null: panel still renders the replay lanes (replay tape is
 *     independent of today's session). A "cold-start" notice in the
 *     panel head explicitly cues the operator that spot + EM are
 *     unavailable; readout chips show "—" instead of values.
 *     `selectVisibleStrikes` falls back to the median tape strike.
 */
export interface StrikeVelocityTapeProps {
  tape: VelocityTape | null;
  /** Current spot price. */
  spot: number | null;
  /** Expected-move upper bound. */
  emUpper: number | null;
  /** Expected-move lower bound. */
  emLower: number | null;
  /** ATM strike — used to center the visible strike window and to
   *  amber-highlight that row. */
  atmStrike: number | null;
}

type ScaleMode = "row" | "panel";

/** Tooltip-state shape: which (strike, minute) is hovered + the
 *  pre-computed volume/spike payload + cursor position in client
 *  coordinates. Computed by LaneSvg on mousemove (one delegated
 *  handler per row, not per-cell) and lifted via `onCellHover`.
 *  Internal — keep unexported so the shape can evolve without a
 *  cross-file contract. */
interface HoveredCell {
  strike: number;
  ts: string;
  callVol: number;
  putVol: number;
  isSpike: boolean;
  mouseX: number;
  mouseY: number;
  // Row's session call/put totals — for computing session % in the
  // tooltip. e.g., a cell with callVol=150 in a row whose session
  // call total is 1000 reads as "C 150 (15%)". The percentage is the
  // signal the cell color CAN'T convey (color shows direction, not
  // relative magnitude vs the strike's session). Source: row.split
  // (already pre-computed in the layout memo) — passed through here
  // so the tooltip closure doesn't have to re-scan minute arrays.
  rowCallSession: number;
  rowPutSession: number;
}

/** Keyboard-focus cell coordinates (#331). Roving-tabindex pattern —
 *  the lane grid is a single tabstop; arrow keys move the focused
 *  cell. Decoupled from `HoveredCell` because:
 *   - Focus is index-based (rowIdx, colIdx) so the keyboard handler
 *     can do bounded arithmetic without re-looking-up strike/ts.
 *   - Hover and focus can coexist (hover wins for tooltip rendering
 *     if both are set; focus drives the focus ring + aria-live).
 *   - Touch also writes to focus (not hover) so a tap-then-arrow-key
 *     flow works on mobile/tablet without a mouse. */
interface FocusedCell {
  rowIdx: number;
  colIdx: number;
}

export function StrikeVelocityTape({
  tape,
  spot,
  emUpper,
  emLower,
  atmStrike,
}: StrikeVelocityTapeProps) {
  // Scale toggle state. Default "row" preserves contour on quiet
  // strikes so the operator can read curve SHAPE on every row.
  // "panel" flips to absolute scaling — the day's standout strike
  // becomes the only tall one.
  const [scaleMode, setScaleMode] = useState<ScaleMode>("row");

  // Hover-tooltip state (#329). Single panel-level cell at most can
  // be "active" at any moment, so we lift state here and pass an
  // onCellHover callback down to each LaneRow. Null = no cell hovered
  // (tooltip hidden). Position is in client coords; the tooltip renders
  // with `position: fixed` so it can escape any panel overflow clipping.
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);

  // Keyboard-focus state (#331). Roving-tabindex over the lane grid:
  // the grid wrapper is the single tabstop; arrow keys move the
  // focused cell within bounds. Touch tap also writes here (not
  // hovered) so the tooltip stays visible after the finger lifts.
  // Tooltip rendering uses focused-cell coords as a fallback when
  // no cell is hovered — see render path below.
  const [focusedCell, setFocusedCell] = useState<FocusedCell | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);


  // Pre-compute the things every row needs. `tape` is the only data
  // dependency; everything else is layout state.
  const layout = useMemo(() => {
    if (!tape || tape.strikes.length === 0) return null;
    const visible = selectVisibleStrikes(tape, atmStrike, MAX_ROWS);
    const axis = buildMinuteAxis(tape);
    const xLabelShown = buildXLabelMask(axis);
    const panelMax = panelMaxVol(tape, visible);
    // Per-strike side maps for O(1) lookup during lane render.
    type SideMap = Map<string, number>;
    type RowData = {
      strike: number;
      callMap: SideMap;
      putMap: SideMap;
      callSpikes: Set<string>;
      putSpikes: Set<string>;
      rowMax: number;
      split: ReturnType<typeof rowSplit>;
      total: number;
    };
    const visibleSet = new Set(visible);
    const rowsByStrike = new Map<number, RowData>();
    for (const s of tape.strikes) {
      if (!visibleSet.has(s.strike)) continue;
      const callMap: SideMap = new Map();
      const putMap: SideMap = new Map();
      for (const m of s.call_minutes) callMap.set(m.ts, m.volume);
      for (const m of s.put_minutes) putMap.set(m.ts, m.volume);
      rowsByStrike.set(s.strike, {
        strike: s.strike,
        callMap,
        putMap,
        callSpikes: new Set(s.call_spike_minutes),
        putSpikes: new Set(s.put_spike_minutes),
        rowMax: rowMaxVol(s),
        split: rowSplit(s),
        total: rowTotalVolume(s),
      });
    }
    const rows: RowData[] = [];
    for (const strike of visible) {
      const r = rowsByStrike.get(strike);
      if (r) rows.push(r);
    }
    return { visible, axis, xLabelShown, panelMax, rows };
  }, [tape, atmStrike]);

  if (!tape) return <EmptyState message="No velocity tape data yet." />;
  if (!layout || layout.rows.length === 0) {
    return <EmptyState message="No replay activity for this window." />;
  }

  // Derive a HoveredCell from focusedCell so the existing
  // MinuteTooltip component renders for keyboard users too. The
  // mouseX/Y here aren't real cursor coords — we point them at the
  // focused cell's approximate screen position (computed from the
  // grid's bounding rect, the focused row index, and the column
  // fraction). The tooltip's flip logic still works because the
  // coords are real client-space pixels.
  const focusCellRow = focusedCell ? layout.rows[focusedCell.rowIdx] : null;
  const focusCellTs =
    focusedCell != null ? layout.axis[focusedCell.colIdx] : null;
  const focusCellPayload: HoveredCell | null = (() => {
    if (!focusedCell || !focusCellRow || focusCellTs == null) return null;
    const callVol = focusCellRow.callMap.get(focusCellTs) ?? 0;
    const putVol = focusCellRow.putMap.get(focusCellTs) ?? 0;
    // Approximate client coords for tooltip placement. The grid
    // rect gives us the lane area; column index → fractional x,
    // row index → integer y row center. If the grid hasn't been
    // measured yet (first render) the tooltip just anchors at
    // viewport (0,0) for one frame; React rerenders on focus
    // change so this is invisible to the operator.
    const rect = gridRef.current?.getBoundingClientRect();
    const mouseX = rect
      ? rect.left + 96 + ((focusedCell.colIdx + 0.5) / layout.axis.length) *
        (rect.width - 96 - 120)
      : 0;
    const mouseY = rect
      ? rect.top + (focusedCell.rowIdx + 0.5) * 44
      : 0;
    return {
      strike: focusCellRow.strike,
      ts: focusCellTs,
      callVol,
      putVol,
      isSpike:
        focusCellRow.callSpikes.has(focusCellTs) ||
        focusCellRow.putSpikes.has(focusCellTs),
      mouseX,
      mouseY,
      rowCallSession: focusCellRow.split.call,
      rowPutSession: focusCellRow.split.put,
    };
  })();
  // Hover wins over focus for tooltip rendering — the operator's
  // active mouse takes precedence over a stale keyboard focus.
  const tooltipCell = hoveredCell ?? focusCellPayload;

  // Roving-tabindex keyboard handler. Navigation arithmetic lives
  // in the pure `nextFocusedCell` helper so the bounded math is
  // testable; this wrapper just routes the result into React state.
  const handleGridKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const result = nextFocusedCell(
      e.key,
      focusedCell,
      layout.rows.length - 1,
      layout.axis.length - 1,
    );
    switch (result.kind) {
      case "init": {
        // First nav-key press — initialize focus at the live minute
        // of the ATM row (or median if no ATM). Matches where the
        // operator's eye would land first.
        const atmRowIdx = layout.rows.findIndex((r) => r.strike === atmStrike);
        const startRow = atmRowIdx >= 0
          ? atmRowIdx
          : Math.floor(layout.rows.length / 2);
        setFocusedCell({ rowIdx: startRow, colIdx: layout.axis.length - 1 });
        e.preventDefault();
        return;
      }
      case "move":
        setFocusedCell({ rowIdx: result.rowIdx, colIdx: result.colIdx });
        e.preventDefault();
        return;
      case "clear":
        setFocusedCell(null);
        gridRef.current?.blur();
        e.preventDefault();
        return;
      case "unchanged":
        return;
    }
  };

  // aria-live announcement text for the focused cell. Screen readers
  // announce this on focus change. Includes strike, minute, total,
  // call/put split, spike flag — same content as the visual tooltip.
  const liveAnnouncement = (() => {
    if (focusCellPayload == null) return "";
    const total = focusCellPayload.callVol + focusCellPayload.putVol;
    const minLabel = formatMinuteLabel(focusCellPayload.ts);
    if (total === 0) {
      return `Strike ${focusCellPayload.strike}, ${minLabel}, no activity`;
    }
    const spikeWord = focusCellPayload.isSpike ? ", spike" : "";
    return (
      `Strike ${focusCellPayload.strike}, ${minLabel}, ` +
      `total ${formatVolume(total)}, ` +
      `${formatVolume(focusCellPayload.callVol)} calls, ` +
      `${formatVolume(focusCellPayload.putVol)} puts` +
      spikeWord
    );
  })();

  return (
    <div
      role="img"
      aria-label={
        "Strike velocity tape. Rows are strikes, blocks are 1-minute " +
        "buckets. Block height encodes total (call+put) volume; block " +
        "color encodes which side dominates (blue for calls, amber for " +
        "puts, grey for balanced). Bright outlines mark spike minutes."
      }
      style={{
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 4,
        overflow: "hidden",
        fontFamily: fonts.mono,
      }}
    >
      <PanelHead
        spot={spot}
        emUpper={emUpper}
        emLower={emLower}
        scaleMode={scaleMode}
        onScaleChange={setScaleMode}
      />
      <div style={{ padding: "12px 14px 6px 14px" }}>
        <div
          ref={gridRef}
          className="svt-lane-grid"
          // Roving-tabindex: the GRID is the single tabstop (#331).
          // Arrow keys / Home / End / PageUp / PageDown move focus
          // within the cell matrix; Escape blurs. aria-label
          // describes the navigation surface; per-cell content
          // updates flow through the aria-live region below.
          tabIndex={0}
          role="grid"
          aria-label={
            "Strike velocity cells. Use arrow keys to navigate; Escape to exit."
          }
          aria-rowcount={layout.rows.length}
          aria-colcount={layout.axis.length}
          aria-activedescendant={
            focusedCell
              ? `svt-cell-${focusedCell.rowIdx}-${focusedCell.colIdx}`
              : undefined
          }
          onKeyDown={handleGridKeyDown}
          onBlur={(e) => {
            // Clear focus when focus moves OUTSIDE the grid. Inside-
            // grid focus shifts (e.g., the InfoButton in PanelHead
            // doesn't apply here) shouldn't clear; relatedTarget
            // tells us where focus went.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setFocusedCell(null);
            }
          }}
        >
          {layout.rows.map((row, rowIdx) => (
            <LaneRow
              key={row.strike}
              row={row}
              rowIdx={rowIdx}
              axis={layout.axis}
              scale={scaleMode === "row" ? row.rowMax : layout.panelMax}
              isAtm={row.strike === atmStrike}
              focusedColIdx={
                focusedCell?.rowIdx === rowIdx ? focusedCell.colIdx : null
              }
              onCellHover={setHoveredCell}
              onCellTouch={(touchedCol) => {
                // Touch tap pins focus, not hover — finger-up
                // shouldn't dismiss the tooltip. The grid takes
                // keyboard focus so subsequent arrow keys work.
                setFocusedCell({ rowIdx, colIdx: touchedCol });
                gridRef.current?.focus();
              }}
            />
          ))}
          <GutterOverlay
            strikes={layout.visible}
            spot={spot}
            emUpper={emUpper}
            emLower={emLower}
          />
        </div>
        <AxisRow axis={layout.axis} xLabelShown={layout.xLabelShown} />
      </div>
      {/* Tooltip: hover takes precedence, keyboard-focus is the
          fallback. Lets mouse + keyboard coexist without state
          contention. */}
      {tooltipCell && <MinuteTooltip cell={tooltipCell} />}
      {/* aria-live region for screen-reader announcements as the
          keyboard focus moves through cells. Visually hidden via
          the `.svt-sr-only` utility class. `polite` so it doesn't
          interrupt; per-focus-change updates are paced naturally by
          arrow-key cadence. */}
      <div role="status" aria-live="polite" className="svt-sr-only">
        {liveAnnouncement}
      </div>
    </div>
  );
}

// ── Panel head ─────────────────────────────────────────────────────

function PanelHead({
  spot,
  emUpper,
  emLower,
  scaleMode,
  onScaleChange,
}: {
  spot: number | null;
  emUpper: number | null;
  emLower: number | null;
  scaleMode: ScaleMode;
  onScaleChange: (m: ScaleMode) => void;
}) {
  // Cold-start (per the snapshotter contract documented at the top
  // of this file): all four headline fields populate atomically, so
  // `spot == null` is the single indicator that the live session
  // hasn't begun. Render an explicit notice so the operator doesn't
  // mistake the missing triangles + ATM highlight for a rendering
  // bug — the chips show "—" too, but the notice is the louder cue.
  const isColdStart = spot == null;
  return (
    <div className="svt-panel-head">
      <div className="svt-title-block">
        <div className="svt-title-row">
          <h3 className="svt-title">Strike Velocity Tape</h3>
          {/* Shared InfoPopover (#334). Renders the ⓘ button inline +
              the popover absolutely-positioned relative to the
              `.svt-panel-head` wrapper (which is position:relative).
              Help content is passed as children; styling overrides
              for the velocity-panel-specific anchor live in
              StrikeVelocityTape.css under
              `.svt-panel-head .info-popover-panel`. */}
          <InfoPopover label="How to read the strike velocity tape">
            <ul>
              <li>
                <b>Each row</b> is one strike (ATM in amber); <b>each block</b> is
                one minute of trading.
              </li>
              <li>
                Block <b>height</b> = total (call + put) volume; <b>color</b> = which
                side dominates:
                <span className="swatch call" /> calls,
                <span className="swatch put" /> puts,
                <span className="swatch balanced" /> balanced.
              </li>
              <li>
                <b>Bright outline</b> on a block = spike minute (≥3σ MAD from the
                strike's baseline). Triangles in the strike column mark
                <b> spot</b> (white) + <b>EM upper / lower</b> (amber).
              </li>
              <li>
                <b>Scale toggle</b>: <i>per row</i> normalizes each row to its own
                peak (shape on quiet strikes); <i>panel</i> uses one scale (the day's
                standout strike).
              </li>
            </ul>
          </InfoPopover>
        </div>
        <div className="svt-sub">
          {isColdStart
            ? "Replay window shown · spot + EM marks unavailable until session open"
            : "Per minute: one block. Height = total volume · color = which side dominates · outline = spike (≥3σ MAD)."}
        </div>
      </div>
      <div className="svt-controls">
        <Readout spot={spot} emUpper={emUpper} emLower={emLower} />
        <ScaleToggle mode={scaleMode} onChange={onScaleChange} />
      </div>
    </div>
  );
}

function Readout({
  spot,
  emUpper,
  emLower,
}: {
  spot: number | null;
  emUpper: number | null;
  emLower: number | null;
}) {
  // Three chips, ordered EM↑ / spot / EM↓ vertically descending in
  // price-space so the operator reads them in the same order as the
  // strike axis below. Null values render as "—".
  return (
    <div className="svt-readout">
      <Chip kind="em" label="EM↑" value={emUpper} />
      <Chip kind="spot" label="spot" value={spot} />
      <Chip kind="em" label="EM↓" value={emLower} />
    </div>
  );
}

function Chip({
  kind,
  label,
  value,
}: {
  kind: "em" | "spot";
  label: string;
  value: number | null;
}) {
  return (
    <span className={`svt-chip svt-chip-${kind}`}>
      <span className="svt-chip-tri" aria-hidden="true" />
      <span className="svt-chip-lbl">{label}</span>
      <span className="svt-chip-val">
        {value == null ? "—" : value.toFixed(1)}
      </span>
    </span>
  );
}

function ScaleToggle({
  mode,
  onChange,
}: {
  mode: ScaleMode;
  onChange: (m: ScaleMode) => void;
}) {
  return (
    <div className="svt-toggle" role="group" aria-label="Volume scale">
      <span className="svt-toggle-lbl">scale</span>
      <button
        type="button"
        className={mode === "row" ? "active" : ""}
        aria-pressed={mode === "row"}
        onClick={() => onChange("row")}
      >
        per row
      </button>
      <button
        type="button"
        className={mode === "panel" ? "active" : ""}
        aria-pressed={mode === "panel"}
        onClick={() => onChange("panel")}
      >
        panel
      </button>
    </div>
  );
}

// ── Per-strike lane row ────────────────────────────────────────────

function LaneRow({
  row,
  rowIdx,
  axis,
  scale,
  isAtm,
  focusedColIdx,
  onCellHover,
  onCellTouch,
}: {
  row: {
    strike: number;
    callMap: Map<string, number>;
    putMap: Map<string, number>;
    callSpikes: Set<string>;
    putSpikes: Set<string>;
    rowMax: number;
    split: { call: number; put: number; total: number };
    total: number;
  };
  rowIdx: number;
  axis: string[];
  scale: number;
  isAtm: boolean;
  focusedColIdx: number | null;
  onCellHover: (cell: HoveredCell | null) => void;
  onCellTouch: (colIdx: number) => void;
}) {
  return (
    <div
      className={`svt-row${isAtm ? " atm" : ""}`}
      role="row"
      aria-rowindex={rowIdx + 1}
    >
      <div className="svt-strike">
        <div className="svt-strike-px">{row.strike}</div>
        <div className="svt-strike-vol">{formatVolume(row.total)} vol</div>
      </div>
      <div className="svt-lane-cell">
        <LaneSvg
          row={row}
          rowIdx={rowIdx}
          axis={axis}
          scale={scale}
          focusedColIdx={focusedColIdx}
          onCellHover={onCellHover}
          onCellTouch={onCellTouch}
        />
      </div>
      <SessionSplit split={row.split} />
    </div>
  );
}

function LaneSvg({
  row,
  rowIdx,
  axis,
  scale,
  focusedColIdx,
  onCellHover,
  onCellTouch,
}: {
  row: {
    strike: number;
    callMap: Map<string, number>;
    putMap: Map<string, number>;
    callSpikes: Set<string>;
    putSpikes: Set<string>;
    split: { call: number; put: number; total: number };
  };
  rowIdx: number;
  axis: string[];
  scale: number;
  focusedColIdx: number | null;
  onCellHover: (cell: HoveredCell | null) => void;
  onCellTouch: (colIdx: number) => void;
}) {
  const W = LANE_VIEWBOX_W;
  const H = LANE_VIEWBOX_H;
  const cellW = axis.length > 0 ? W / axis.length : 0;
  // Rect data computed in a flat array — avoids per-cell wrapping
  // elements which add layout cost in long axes (30+ minutes × 15
  // strikes = 450+ cells per render).
  const blocks: ReactNode[] = [];
  for (let i = 0; i < axis.length; i++) {
    const ts = axis[i];
    const callVol = row.callMap.get(ts) ?? 0;
    const putVol = row.putMap.get(ts) ?? 0;
    const total = callVol + putVol;
    if (total === 0) continue; // skip empty cells — bg shows through
    const x = i * cellW + LANE_CELL_PAD;
    const w = cellW - 2 * LANE_CELL_PAD;
    const h = (total / scale) * (H - 4);
    const y = H - h - 2;
    const color = dominanceColor(callVol, putVol);
    blocks.push(
      <rect key={`b${i}`} x={x} y={y} width={w} height={h} fill={color} />,
    );
    if (row.callSpikes.has(ts) || row.putSpikes.has(ts)) {
      blocks.push(
        <rect
          key={`s${i}`}
          x={x - 0.5}
          y={y - 0.5}
          width={w + 1}
          height={h + 1}
          fill="none"
          stroke={SPIKE_STROKE}
          strokeWidth={SPIKE_STROKE_W}
          rx={1}
        />,
      );
    }
  }
  // Hover handler: one delegated listener for the whole row (vs ~30
  // per-cell listeners) — maps cursor X → column index via
  // `cellIndexFromX`, looks up the call/put/spike payload from the
  // already-built maps, and dispatches to the panel. onMouseLeave
  // clears so the tooltip dismisses when the cursor leaves the row.
  const handleMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const colIdx = cellIndexFromX(e.clientX, rect, axis.length);
    if (colIdx < 0) {
      onCellHover(null);
      return;
    }
    const ts = axis[colIdx];
    const callVol = row.callMap.get(ts) ?? 0;
    const putVol = row.putMap.get(ts) ?? 0;
    if (callVol + putVol === 0 && !row.callSpikes.has(ts) && !row.putSpikes.has(ts)) {
      // Empty cell + no orphan spike — surface nothing rather than
      // a "0 vol" tooltip that adds noise on quiet minutes.
      onCellHover(null);
      return;
    }
    onCellHover({
      strike: row.strike,
      ts,
      callVol,
      putVol,
      isSpike: row.callSpikes.has(ts) || row.putSpikes.has(ts),
      mouseX: e.clientX,
      mouseY: e.clientY,
      rowCallSession: row.split.call,
      rowPutSession: row.split.put,
    });
  };
  // Touch handler (#331): same column-detection logic as mouse,
  // dispatched to onCellTouch (which the panel routes into focus
  // state, NOT hover state). A tap pins the cell; the next tap
  // outside the grid clears focus via the grid's onBlur. We
  // preventDefault to suppress the synthetic mouse events the
  // browser would otherwise fire on tap end.
  const handleTouchStart = (e: ReactTouchEvent<SVGSVGElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const colIdx = cellIndexFromX(touch.clientX, rect, axis.length);
    if (colIdx < 0) return;
    onCellTouch(colIdx);
    e.preventDefault();
  };
  // Focus-ring overlay (#331): when this row contains the focused
  // cell, render a bright outline at the cell's column position.
  // Always-on-top via a final rect drawn AFTER the data blocks so
  // it isn't obscured by adjacent spike borders or block fills.
  // Cell width/x match the data-cell geometry above so the ring
  // tracks block positions at every viewport width.
  const focusRing =
    focusedColIdx != null && focusedColIdx >= 0 && focusedColIdx < axis.length
      ? (() => {
          const x = focusedColIdx * cellW + LANE_CELL_PAD - 0.5;
          const w = cellW - 2 * LANE_CELL_PAD + 1;
          return (
            <rect
              key="focus"
              x={x}
              y={0.5}
              width={w}
              height={H - 1}
              fill="none"
              stroke={colors.accentAmber}
              strokeWidth={1.5}
              rx={1}
              id={`svt-cell-${rowIdx}-${focusedColIdx}`}
            />
          );
        })()
      : null;
  return (
    <svg
      className="svt-lane-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onMouseMove={handleMove}
      onMouseLeave={() => onCellHover(null)}
      onTouchStart={handleTouchStart}
    >
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        fill={withAlpha(colors.textBright, 0.02)}
      />
      {blocks}
      {focusRing}
    </svg>
  );
}

// ── Session split column ──────────────────────────────────────────

function SessionSplit({
  split,
}: {
  split: { call: number; put: number; total: number };
}) {
  if (split.total === 0) {
    return (
      <div className="svt-session">
        <div className="svt-session-nums">—</div>
      </div>
    );
  }
  const callPct = (split.call / split.total) * 100;
  const putPct = 100 - callPct;
  return (
    <div className="svt-session">
      <div className="svt-split-bar">
        <div
          className="svt-split-call"
          style={{ width: `${callPct.toFixed(1)}%` }}
        />
        <div
          className="svt-split-put"
          style={{ width: `${putPct.toFixed(1)}%` }}
        />
      </div>
      <div className="svt-session-nums">
        <span className="c">C {formatVolume(split.call)}</span>
        <span className="p">P {formatVolume(split.put)}</span>
      </div>
    </div>
  );
}

// ── Gutter overlay (triangles inside strike column) ───────────────

function GutterOverlay({
  strikes,
  spot,
  emUpper,
  emLower,
}: {
  strikes: number[];
  spot: number | null;
  emUpper: number | null;
  emLower: number | null;
}) {
  // Triangles point right; base at x=2, apex at x = 2 + width.
  // Spot is larger (14px wide, 12px tall) so it reads as primary;
  // EM markers are 10px wide, 8px tall.
  // The overlay sits over the strike COLUMN (left:0, width:STRIKE_COL_W)
  // — see CSS .svt-gutter-overlay.
  const tris: ReactNode[] = [];
  if (emUpper != null) {
    tris.push(triPoly("emU", priceToY(emUpper, strikes, ROW_H), 10, 8, "em"));
  }
  if (spot != null) {
    tris.push(triPoly("spot", priceToY(spot, strikes, ROW_H), 14, 12, "spot"));
  }
  if (emLower != null) {
    tris.push(triPoly("emL", priceToY(emLower, strikes, ROW_H), 10, 8, "em"));
  }
  if (tris.length === 0) return null;
  return (
    <div className="svt-gutter-overlay" aria-hidden="true">
      <svg preserveAspectRatio="none">{tris}</svg>
    </div>
  );
}

function triPoly(
  key: string,
  y: number,
  width: number,
  height: number,
  cls: "em" | "spot",
) {
  const xBase = 2;
  const xApex = xBase + width;
  const halfH = height / 2;
  const points = `${xBase},${y - halfH} ${xApex},${y} ${xBase},${y + halfH}`;
  return (
    <polygon
      key={key}
      className={cls === "spot" ? "svt-tri-spot" : "svt-tri-em"}
      points={points}
    />
  );
}

// ── X-axis time labels ────────────────────────────────────────────

function AxisRow({
  axis,
  xLabelShown,
}: {
  axis: string[];
  xLabelShown: boolean[];
}) {
  const ticks: ReactNode[] = [];
  for (let i = 0; i < axis.length; i++) {
    if (!xLabelShown[i]) continue;
    const isLast = i === axis.length - 1;
    const pct = ((i + 0.5) / axis.length) * 100;
    ticks.push(
      <span
        key={i}
        className={`svt-tick${isLast ? " now" : ""}`}
        style={{ left: `${pct}%` }}
      >
        {formatMinuteLabel(axis[i])}
      </span>,
    );
  }
  return (
    <div className="svt-axis">
      <div className="svt-axis-pad" />
      <div className="svt-axis-ticks">{ticks}</div>
      <div className="svt-axis-pad" />
    </div>
  );
}

// ── Minute hover tooltip ─────────────────────────────────────────

function MinuteTooltip({ cell }: { cell: HoveredCell }) {
  // Position the tooltip near the cursor but offset so it never sits
  // directly under the pointer. Anchor TOP-LEFT relative to the cursor
  // unless we're close to the right or bottom of the viewport, in
  // which case flip to the opposite side so the tooltip stays visible.
  // `position: fixed` so it escapes any panel overflow clipping.
  const offset = 12;
  // Conservative size estimates for the flip decision (#329 R1+R2 nit).
  // Tooltip has `min-width: 180px` + padding; spike footer adds ~22px
  // height. Rounding generous so a 5-digit strike + spike line doesn't
  // overshoot the viewport before the flip fires.
  const estW = 260;
  const estH = 130;
  const flipX = cell.mouseX + offset + estW > window.innerWidth;
  const flipY = cell.mouseY + offset + estH > window.innerHeight;
  const style: CSSProperties = {
    position: "fixed",
    left: flipX ? cell.mouseX - offset - estW : cell.mouseX + offset,
    top: flipY ? cell.mouseY - offset - estH : cell.mouseY + offset,
    pointerEvents: "none",
    zIndex: 1000,
  };
  const total = cell.callVol + cell.putVol;
  // Session % (#332): the cell's call/put volume as a share of the
  // STRIKE'S session call/put total (NOT cell total). This is the
  // signal the cell color CAN'T convey — color shows direction, the
  // % shows "this minute represented X% of today's call flow at this
  // strike". Cell-share % was redundant with the color encoding.
  // Guard against div-by-zero: when the row's call/put session total
  // is 0 (illiquid side), the % renders as "—".
  const callSessionPct =
    cell.rowCallSession > 0 ? (cell.callVol / cell.rowCallSession) * 100 : null;
  const putSessionPct =
    cell.rowPutSession > 0 ? (cell.putVol / cell.rowPutSession) * 100 : null;
  return (
    <div className="svt-tooltip" style={style}>
      <div className="svt-tooltip-head">
        <span className="svt-tooltip-strike">Strike {cell.strike}</span>
        <span className="svt-tooltip-time">{formatMinuteLabel(cell.ts)} ET</span>
      </div>
      <div className="svt-tooltip-total">
        Total <b>{formatVolume(total)}</b>
      </div>
      <div className="svt-tooltip-split">
        <span className="c">
          C <b>{formatVolume(cell.callVol)}</b>
          <i>{callSessionPct == null ? "—" : `${callSessionPct.toFixed(0)}% sess`}</i>
        </span>
        <span className="p">
          P <b>{formatVolume(cell.putVol)}</b>
          <i>{putSessionPct == null ? "—" : `${putSessionPct.toFixed(0)}% sess`}</i>
        </span>
      </div>
      {cell.isSpike && (
        <div className="svt-tooltip-spike">⚠ Spike (≥3σ MAD)</div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 4,
        padding: "28px 18px",
        textAlign: "center",
        color: colors.textMuted,
        fontFamily: fonts.mono,
        fontSize: 12,
        letterSpacing: "0.04em",
      }}
    >
      {message}
    </div>
  );
}

