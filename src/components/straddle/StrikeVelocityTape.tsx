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

import { useMemo, useState, type ReactNode } from "react";
import type { VelocityTape } from "../../api/terminalTypes";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import {
  buildMinuteAxis,
  buildXLabelMask,
  dominanceColor,
  formatMinuteLabel,
  formatVolume,
  MAX_ROWS,
  panelMaxVol,
  priceToY,
  rowMaxVol,
  rowSplit,
  rowTotalVolume,
  ROW_H,
  selectVisibleStrikes,
  STRIKE_COL_W,
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
  // ── Cold-start contract ──────────────────────────────────────────
  // Per the snapshotter
  // (automated-dc-entry/futures_terminal/systems/straddle_chain.py:822-823),
  // `em_upper = spot + atm_straddle_mid` and `em_lower = spot -
  // atm_straddle_mid` — all four headline fields (spot, emUpper,
  // emLower, atmStrike) are populated atomically. Either every field
  // is non-null (live snapshot) or every field is null (cold-start
  // before the first snapshot of the session). The component handles
  // both shapes:
  //   - All non-null: triangles + ATM amber highlight + numeric chips.
  //   - All null: panel still renders the replay lanes (replay tape
  //     is independent of today's session). A "cold-start" notice in
  //     the panel head explicitly cues the operator that spot + EM
  //     are unavailable; readout chips show "—" instead of values.
  //     `selectVisibleStrikes` falls back to the median tape strike.
}

type ScaleMode = "row" | "panel";

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
        <div className="svt-lane-grid">
          {layout.rows.map((row) => (
            <LaneRow
              key={row.strike}
              row={row}
              axis={layout.axis}
              scale={scaleMode === "row" ? row.rowMax : layout.panelMax}
              isAtm={row.strike === atmStrike}
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
      <div>
        <h3 className="svt-title">Strike Velocity Tape</h3>
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
  axis,
  scale,
  isAtm,
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
  axis: string[];
  scale: number;
  isAtm: boolean;
}) {
  return (
    <div className={`svt-row${isAtm ? " atm" : ""}`}>
      <div className="svt-strike">
        <div className="svt-strike-px">{row.strike}</div>
        <div className="svt-strike-vol">{formatVolume(row.total)} vol</div>
      </div>
      <div className="svt-lane-cell">
        <LaneSvg row={row} axis={axis} scale={scale} />
      </div>
      <SessionSplit split={row.split} />
    </div>
  );
}

function LaneSvg({
  row,
  axis,
  scale,
}: {
  row: {
    callMap: Map<string, number>;
    putMap: Map<string, number>;
    callSpikes: Set<string>;
    putSpikes: Set<string>;
  };
  axis: string[];
  scale: number;
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
  return (
    <svg
      className="svt-lane-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        fill={withAlpha(colors.textBright, 0.02)}
      />
      {blocks}
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

// Re-export the geometry constants the CSS coordinates with, so tests
// + CSS source can stay in lockstep.
export { ROW_H, STRIKE_COL_W };
