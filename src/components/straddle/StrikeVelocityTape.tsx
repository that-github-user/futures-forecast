/**
 * StrikeVelocityTape — frozen replay of strike-level trade velocity
 * for the 0DTE chain, rendered as a full-width major panel BELOW the
 * straddle body grid. Promoted from the original 280px sidebar — the
 * sparklines need more horizontal room than that gave them.
 *
 * IMPORTANT: this panel is NOT a row-aligned overlay on the chart.
 * The chart packs ~40 strikes at ~13.5px/row; this panel uses a fixed
 * ROW_HEIGHT (~48px) sized for legible sparklines, and shows a focused
 * ATM ± 5 cluster subset of strikes. Operators should read the two
 * grids as paired views of the same chain, NOT as a strike-by-strike
 * row mirror.
 *
 * Layout (one row per cluster strike, sorted descending):
 *   - Left:   strike label (mono, right-aligned numerical)
 *   - Center: TWO inline SVG sparklines stacked vertically — top row
 *             is call-side per-minute volume, bottom row is put-side.
 *             One bar per 1-min bucket within the replay window
 *             (typically 15-30 buckets). Spike minutes (those tagged
 *             on the backend as > mean+3σ) get an amber glow + a small
 *             ▲/▼ glyph above the bar so the operator can scan for
 *             unusual flow visually.
 *   - Right:  total volume scalar for the 15-min window (call + put
 *             combined), formatted with k-suffix for readability.
 *
 * Optional spot overlay: above the per-strike rows, a thin SVG line
 * renders the SPX 1-min close path during the replay window so the
 * operator can correlate strike-level activity with the underlying
 * move. Suppressed gracefully when `velocity_tape.spot_path` is null.
 *
 * Null contract: when the parent passes `tape={null}` (no replay row
 * exists yet), the component renders a single muted "(no replay
 * available)" placeholder, sized to match the chart so the layout
 * doesn't reflow when a replay first appears.
 *
 * Implementation notes:
 *   - No ECharts here — inline SVG sparklines are cheaper to render
 *     and the fixed-row layout keeps sparklines at a legible size
 *     regardless of how many strikes the chart packs in.
 *   - The component is presentational; data shape comes straight from
 *     `velocity_tape` on the StraddleChainResponse.
 */

import { useMemo } from "react";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import type { VelocityTape } from "../../api/terminalTypes";
import {
  buildMinuteAxis,
  densify,
  formatVolume,
  resolveStrikeOrder,
  rowTotalVolume,
  spikeGlyphsAt,
  sumVolume,
} from "./strikeVelocityHelpers";

// ── Geometry ────────────────────────────────────────────────────────
// Single source of truth for sparkline dims; keeps row math honest.

// Row height. Inner column stacks SPIKE_GLYPH_HEIGHT(11) + SPARK_GAP(2)
// + SPARK_HEIGHT(14) + SPARK_GAP(2) + SPARK_HEIGHT(14) = 43px of
// content. 48 leaves a small comfortable padding for the row's top/bottom
// padding + bottom border so the divider doesn't crowd the put sparkline.
// (Subsumes #318.)
const ROW_HEIGHT = 48;
const SPARK_HEIGHT = 14;                // height of each call/put sparkline
const SPARK_GAP = 2;                    // vertical gap between call and put rows
const SPIKE_GLYPH_HEIGHT = 11;          // glyph row above the call sparkline
                                        // (was 8 — bumped so the stacked
                                        // collision case has room for two
                                        // glyphs at ≥6px fontSize, which
                                        // is the practical legibility
                                        // floor for ▲/▼ on most displays)
const SPOT_OVERLAY_HEIGHT = 36;
// Label columns. Bumped slightly from the 56/56 the old 280px sidebar
// used — now that the panel is full-width (~1100px), the extra room
// in the strike + volume columns reads more cleanly without crowding
// the sparkline column.
const STRIKE_LABEL_WIDTH = 64;
const VOLUME_LABEL_WIDTH = 80;
const BAR_GAP = 1;
const MIN_BAR_WIDTH = 2;

// SVG logical coordinate width for the responsive sparkline / glyph /
// spot SVGs. Bars + glyphs + polyline points are positioned in this
// logical space; `preserveAspectRatio="none"` lets the SVG CSS-scale
// horizontally to fill its container while keeping the pixel-accurate
// vertical layout (heights are fixed).
const LOGICAL_WIDTH = 1000;

interface Props {
  tape: VelocityTape | null;
  /** Strike order from the chart (descending). The component filters
   *  to strikes the tape carries and renders them in this order so the
   *  cluster subset reads in the same direction as the chart's y-axis.
   *  This is NOT a row-by-row alignment — the panel uses its own fixed
   *  ROW_HEIGHT (sized for legible sparklines), independent of the
   *  chart's per-strike pixel density. When null/empty, falls back to
   *  the tape's own strike order (descending by strike). */
  strikeOrder?: number[];
  /** Optional container height. When omitted (the default), the panel
   *  sizes to its content — the right behavior for the major-panel
   *  promotion (#319), where forcing a fixed 540px caused an internal
   *  scrollbar because 11 strikes × 48px ROW_HEIGHT + header + spot
   *  overlay ≈ 680px exceeds 540. Pass an explicit number to cap (e.g.,
   *  if embedding in a side panel that needs a fixed band). */
  height?: number;
}

/** Build a flat sparkline of `<rect>` bars for one strike/side.
 *  Bars normalize against the maximum volume across BOTH call+put for
 *  this strike+axis pair, so the call vs put bars at the same minute
 *  are visually comparable.
 *
 *  Responsive layout: the SVG is sized in a logical LOGICAL_WIDTH
 *  coordinate space and CSS-scales to fill its parent column via
 *  width="100%" + preserveAspectRatio="none". Vertical layout stays
 *  pixel-exact because SPARK_HEIGHT is fixed. */
function Sparkline({
  values,
  axis,
  spikes,
  strike,
  side,
}: {
  values: Array<number | null>;
  axis: string[];
  spikes: Set<string>;
  strike: number;
  side: "call" | "put";
}) {
  // Hemisphere convention: calls = blue, puts = amber. Spike border
  // is a brighter accent on top of the side's base colour.
  const baseColor = side === "call" ? colors.accentBlue : colors.accentAmber;
  const spikeColor = colors.accentRed;
  const numericValues = values.filter((v): v is number => v !== null);
  const max = numericValues.length > 0 ? Math.max(...numericValues) : 0;
  // Bar width in logical coords: derive from logical width / axis length,
  // then floor to MIN_BAR_WIDTH so even a 30-bucket window stays legible
  // when the SVG renders into a narrow container. preserveAspectRatio
  // stretches the bars horizontally beyond the MIN_BAR_WIDTH floor as the
  // container widens.
  const slot = axis.length > 0 ? LOGICAL_WIDTH / axis.length : LOGICAL_WIDTH;
  const barWidth = Math.max(MIN_BAR_WIDTH, slot - BAR_GAP);

  return (
    <svg
      width="100%"
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${LOGICAL_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
      aria-label={`Per-minute ${side} volume at strike ${strike}`}
    >
      {axis.map((ts, i) => {
        const v = values[i];
        const x = i * slot;
        if (v == null || v <= 0) {
          // Empty-minute placeholder: a faint baseline tick so the
          // operator can tell "no print" from "off-axis". Without this,
          // illiquid strikes look mid-air.
          return (
            <line
              key={ts}
              x1={x}
              x2={x + barWidth}
              y1={SPARK_HEIGHT - 1}
              y2={SPARK_HEIGHT - 1}
              stroke={withAlpha(colors.textMuted, 0.3)}
              strokeWidth={1}
            />
          );
        }
        const h = max > 0 ? Math.max(1, (v / max) * (SPARK_HEIGHT - 1)) : 1;
        const y = SPARK_HEIGHT - h;
        const isSpike = spikes.has(ts);
        return (
          <rect
            key={ts}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            fill={isSpike ? spikeColor : baseColor}
            opacity={isSpike ? 1 : 0.65}
          />
        );
      })}
    </svg>
  );
}

/** Render the small ▲/▼ glyph row above the call sparkline, one glyph
 *  per spike minute per side. Renders to the right of the call
 *  sparkline's x-grid so each glyph sits directly over its
 *  corresponding bar.
 *
 *  When BOTH sides spike at the same minute, we stack the glyphs
 *  vertically (▲ in the top half, ▼ in the bottom half) so neither
 *  side is silently dropped. Both glyphs keep their side-specific
 *  colors so the operator can still tell call-vs-put at a glance. */
function SpikeGlyphRow({
  axis,
  callSpikes,
  putSpikes,
  strike,
}: {
  axis: string[];
  callSpikes: Set<string>;
  putSpikes: Set<string>;
  strike: number;
}) {
  // Color convention: call spikes pop in red (the emphasis hue used
  // for the spike bar itself), put spikes use the amber put accent so
  // the operator can still tell sides apart when both fire at the
  // same minute.
  const callGlyphColor = colors.accentRed;
  const putGlyphColor = colors.accentAmber;
  // RENDER AS HTML, NOT SVG — when the panel widens past LOGICAL_WIDTH
  // (1000px) and we used `preserveAspectRatio="none"` on the SVG, the
  // ▲/▼ text glyphs got horizontally stretched along with the bars,
  // breaking the legibility floor that motivated the size bump in the
  // first place. Rendering glyphs as absolutely-positioned HTML spans
  // anchored by percentage left lets them scale POSITION horizontally
  // (matching the bar columns below) without distorting their NATIVE
  // font shape. Bars in Sparkline can still stretch — that's intended
  // for the bar visualization. Glyphs are text, they shouldn't stretch.
  const axisLen = axis.length;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: SPIKE_GLYPH_HEIGHT,
      }}
      role="img"
      aria-label={`Spike-minute markers at strike ${strike}`}
    >
      {axis.map((ts, i) => {
        const glyphs = spikeGlyphsAt(ts, callSpikes, putSpikes);
        if (glyphs.length === 0) return null;
        // Center the glyph in its bucket: ((i + 0.5) / N) * 100%.
        const leftPct = ((i + 0.5) / axisLen) * 100;
        const stacked = glyphs.length === 2;
        return glyphs.map((g) => {
          // Single-side fire → glyph sits on the row baseline (bottom).
          // Stacked fire → call ▲ in the top half, put ▼ in the bottom.
          let topPx: number;
          if (g.position === "top") topPx = 0;
          else topPx = stacked ? Math.floor(SPIKE_GLYPH_HEIGHT / 2) : 0;
          const fill = g.side === "call" ? callGlyphColor : putGlyphColor;
          return (
            <span
              key={`${ts}-${g.side}`}
              style={{
                position: "absolute",
                left: `${leftPct}%`,
                top: topPx,
                transform: "translateX(-50%)",
                color: fill,
                // Stacked fontSize 6 fits two glyphs in 11px. Single-side
                // gets 8px for legibility. Mono font keeps width
                // consistent across digits / glyphs.
                fontSize: stacked ? 6 : 8,
                fontFamily: fonts.mono,
                lineHeight: 1,
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {g.glyph}
            </span>
          );
        });
      })}
    </div>
  );
}

/** Spot-path mini-line above the per-strike rows. One SVG <polyline>
 *  fed by the velocity_tape.spot_path 1-min closes. Suppressed when
 *  spot_path is null or empty.
 *
 *  Responsive layout: same viewBox pattern as Sparkline — points are
 *  placed in logical LOGICAL_WIDTH coords; the SVG CSS-scales
 *  horizontally to fill its container. */
function SpotOverlay({
  points,
}: {
  points: Array<{ ts: string; price: number }>;
}) {
  if (points.length < 2) return null;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(0.01, max - min);
  // Layout: small vertical padding so the line never touches the
  // border edges; this avoids the rendered first/last point looking
  // visually clipped.
  const padding = 4;
  const usableHeight = SPOT_OVERLAY_HEIGHT - padding * 2;
  const xs = points.map((_, i) => (i / (points.length - 1)) * LOGICAL_WIDTH);
  const ys = prices.map((p) => padding + (1 - (p - min) / range) * usableHeight);
  const pathPoints = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  // Endpoint readout: shows the change across the window for context.
  const change = prices[prices.length - 1] - prices[0];
  const changeStr = `${change >= 0 ? "+" : ""}${change.toFixed(2)}`;
  return (
    <div
      style={{
        position: "relative",
        height: SPOT_OVERLAY_HEIGHT,
        marginBottom: 6,
      }}
    >
      <svg
        width="100%"
        height={SPOT_OVERLAY_HEIGHT}
        viewBox={`0 0 ${LOGICAL_WIDTH} ${SPOT_OVERLAY_HEIGHT}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
        aria-label="SPX spot path during replay window"
      >
        <polyline
          points={pathPoints}
          stroke={colors.textSecondary}
          strokeWidth={1}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: 2,
          left: 4,
          fontFamily: fonts.mono,
          fontSize: 9,
          color: colors.textMuted,
          letterSpacing: "0.04em",
        }}
      >
        SPX {prices[0].toFixed(2)}
      </div>
      <div
        style={{
          position: "absolute",
          top: 2,
          right: 4,
          fontFamily: fonts.mono,
          fontSize: 9,
          color: change >= 0 ? colors.accentGreen : colors.accentRed,
          letterSpacing: "0.04em",
        }}
      >
        {changeStr}
      </div>
    </div>
  );
}

export function StrikeVelocityTape({
  tape,
  strikeOrder,
  height,
}: Props) {
  // All hooks must run unconditionally to satisfy React's hook order.
  // The empty/null contract is rendered AFTER memoization via a
  // boolean gate — when `tape` is null, the memos return safe empty
  // defaults so we never read tape.strikes on null.

  // ── Strike order (descending to match chart's y-axis) ─────────────
  const strikesByKey = useMemo(() => {
    const m = new Map<number, NonNullable<typeof tape>["strikes"][number]>();
    if (tape) {
      for (const s of tape.strikes) m.set(s.strike, s);
    }
    return m;
  }, [tape]);

  const orderedStrikes = useMemo(
    () => (tape ? resolveStrikeOrder(tape, strikeOrder) : []),
    [strikeOrder, tape],
  );

  // ── Shared minute axis (union of all minutes in the tape) ─────────
  const axis = useMemo(
    () => (tape ? buildMinuteAxis(tape) : []),
    [tape],
  );

  // ── Window label for header (e.g. "Fri 15:30-16:00 ET") ───────────
  const headerLabel = useMemo(() => {
    if (!tape) return "";
    try {
      const start = new Date(tape.window_start);
      const end = new Date(tape.window_end);
      // Date(...) returns Invalid Date (NaN time) for unparseable
      // inputs instead of throwing — guard explicitly so we don't
      // leak the raw ISO string when an upstream feed gets weird.
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return "(replay window unavailable)";
      }
      const fmt = (d: Date) =>
        d.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "America/New_York",
        });
      const dayLabel = start.toLocaleDateString("en-US", {
        weekday: "short",
        month: "numeric",
        day: "numeric",
        timeZone: "America/New_York",
      });
      return `${dayLabel} ${fmt(start)}-${fmt(end)} ET`;
    } catch {
      // Defensive — current toLocale* paths shouldn't throw on a
      // valid Date, but operator shouldn't see raw ISO either way.
      return "(replay window unavailable)";
    }
  }, [tape]);

  // ── Total volume across all strikes in the tape ───────────────────
  const totalVolume = useMemo(() => {
    if (!tape) return 0;
    let n = 0;
    for (const s of tape.strikes) {
      n += sumVolume(s.call_minutes) + sumVolume(s.put_minutes);
    }
    return n;
  }, [tape]);

  // ── Null / empty contract ──────────────────────────────────────────
  if (!tape || tape.strikes.length === 0) {
    return (
      <div
        style={{
          width: "100%",
          height,
          background: colors.bgPanel,
          border: `1px solid ${colors.borderDim}`,
          borderRadius: 6,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: colors.textMuted,
          fontFamily: fonts.sans,
          fontSize: 12,
          letterSpacing: "0.04em",
          textAlign: "center",
        }}
      >
        <div>(no replay available)</div>
        <div style={{ fontSize: 10, marginTop: 6, color: colors.textMuted }}>
          run scripts/replay_strike_velocity.py
        </div>
      </div>
    );
  }

  // ── Row grid template ──────────────────────────────────────────────
  // Strike label + volume label are fixed-pixel columns; the sparkline
  // column takes 1fr (the remainder of the row's full width). The inner
  // SVGs fill that 1fr column at width="100%" via the viewBox pattern.
  const rowGridTemplate = `${STRIKE_LABEL_WIDTH}px 1fr ${VOLUME_LABEL_WIDTH}px`;

  return (
    <div
      style={{
        width: "100%",
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: "12px 14px 14px 14px",
        height,
        display: "flex",
        flexDirection: "column",
        fontFamily: fonts.sans,
      }}
    >
      {/* Section header — major-panel treatment marks this as a peer
          of the chart, not a sidebar. Title + subline. The "Frozen
          Replay" eyebrow was dropped because the word "Frozen" already
          appeared in the title tail ("Frozen Friday-close replay") —
          redundant on adjacent lines (R2 round-2 review). */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginBottom: 10,
        }}
      >
        {/* Section title — slightly larger, semibold, mixed-weight so
            the panel reads as a peer of the chart. The dot-separated
            tail spells out the panel's framing: this is a focused
            ATM-cluster view, NOT a row-aligned mirror of the chart.
            Flex-wrap lets the tail drop to a second line on narrow
            viewports instead of breaking mid-phrase. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            columnGap: 8,
            rowGap: 2,
            fontFamily: fonts.sans,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: colors.textBright,
            }}
          >
            Trade Velocity
          </span>
          <span
            style={{
              fontSize: 12,
              color: colors.textSecondary,
              fontWeight: 400,
            }}
          >
            · ATM ± 5 cluster · Frozen Friday-close replay
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "center",
            fontFamily: fonts.mono,
            fontSize: 11,
            color: colors.textPrimary,
          }}
        >
          <span>{headerLabel}</span>
          <span style={{ color: colors.textMuted }}>
            {formatVolume(totalVolume)} contracts ·{" "}
            <span style={{ color: colors.accentBlue }}>calls</span>
            {" / "}
            <span style={{ color: colors.accentAmber }}>puts</span>
          </span>
        </div>
      </div>

      {/* Optional SPX spot overlay — sits in the sparkline column so it
          aligns horizontally with the per-strike sparklines below.
          Outer 3-col grid mirrors the per-strike row layout. */}
      {tape.spot_path && tape.spot_path.length > 1 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: rowGridTemplate,
            gap: 8,
            alignItems: "stretch",
          }}
        >
          <div />
          <SpotOverlay points={tape.spot_path} />
          <div />
        </div>
      )}

      {/* Column headers above the per-strike rows */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: rowGridTemplate,
          gap: 8,
          alignItems: "center",
          paddingBottom: 4,
          borderBottom: `1px solid ${colors.borderDim}`,
          fontFamily: fonts.mono,
          fontSize: 9,
          color: colors.textMuted,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ textAlign: "right" }}>strike</span>
        <span>velocity (1-min)</span>
        <span style={{ textAlign: "right" }}>vol</span>
      </div>

      {/* Per-strike rows */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          marginTop: 4,
        }}
      >
        {orderedStrikes.map((strike, idx) => {
          const s = strikesByKey.get(strike)!;
          const callValues = densify(s.call_minutes, axis);
          const putValues = densify(s.put_minutes, axis);
          const callSpikes = new Set(s.call_spike_minutes);
          const putSpikes = new Set(s.put_spike_minutes);
          const rowTotal = rowTotalVolume(s);
          const hasSpike = s.call_spike_minutes.length > 0 || s.put_spike_minutes.length > 0;
          const isLast = idx === orderedStrikes.length - 1;
          return (
            <div
              key={strike}
              style={{
                display: "grid",
                gridTemplateColumns: rowGridTemplate,
                gap: 8,
                alignItems: "center",
                height: ROW_HEIGHT,
                paddingTop: 2,
                paddingBottom: 2,
                // Subtle horizontal divider between strike rows so operators
                // can scan the wider panel without the rows blurring into
                // each other. Last row drops the divider so the table
                // doesn't double-up with the panel's own bottom border.
                borderBottom: isLast
                  ? "none"
                  : `1px solid ${withAlpha(colors.borderDim, 0.6)}`,
              }}
            >
              <div
                style={{
                  textAlign: "right",
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  color: hasSpike ? colors.accentRed : colors.textPrimary,
                  fontWeight: hasSpike ? 600 : 400,
                }}
              >
                {strike.toFixed(0)}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: SPARK_GAP,
                  minWidth: 0,
                }}
              >
                <SpikeGlyphRow
                  axis={axis}
                  callSpikes={callSpikes}
                  putSpikes={putSpikes}
                  strike={strike}
                />
                <Sparkline
                  values={callValues}
                  axis={axis}
                  spikes={callSpikes}
                  strike={strike}
                  side="call"
                />
                <Sparkline
                  values={putValues}
                  axis={axis}
                  spikes={putSpikes}
                  strike={strike}
                  side="put"
                />
              </div>
              <div
                style={{
                  textAlign: "right",
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  color: colors.textPrimary,
                }}
              >
                {formatVolume(rowTotal)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
