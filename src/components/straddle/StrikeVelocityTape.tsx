/**
 * StrikeVelocityTape — frozen replay of strike-level trade velocity
 * for the 0DTE chain, rendered to the right of `StraddleMapChart`.
 *
 * Layout (one row per strike, sorted descending to match the chart):
 *   - Left:   strike label (mono, right-aligned numerical)
 *   - Center: TWO inline SVG sparklines stacked vertically — top row
 *             is call-side per-minute volume, bottom row is put-side.
 *             One bar per 1-min bucket within the replay window
 *             (typically 15-30 buckets). Spike minutes (those tagged
 *             on the backend as > mean+3σ) get an amber glow + a small
 *             ▲ glyph above the bar so the operator can scan for
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
 *     and easier to align row-by-row to whatever y-grid the operator's
 *     chart settles into. Same render cost as a static badge.
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
  sumVolume,
} from "./strikeVelocityHelpers";

// ── Geometry ────────────────────────────────────────────────────────
// Single source of truth for sparkline dims; keeps row math honest.

const ROW_HEIGHT = 36;                  // per-strike row total height
const SPARK_HEIGHT = 14;                // height of each call/put sparkline
const SPARK_GAP = 2;                    // vertical gap between call and put rows
const SPIKE_GLYPH_HEIGHT = 8;           // glyph row above the call sparkline
const SPOT_OVERLAY_HEIGHT = 36;
const STRIKE_LABEL_WIDTH = 56;
const VOLUME_LABEL_WIDTH = 56;
const BAR_GAP = 1;
const MIN_BAR_WIDTH = 2;

interface Props {
  tape: VelocityTape | null;
  /** Strike order from the chart (descending). The component aligns
   *  rows to this order so the velocity column reads in lockstep with
   *  the strike chart on its left. When null/empty, falls back to the
   *  tape's own strike order (descending by strike). */
  strikeOrder?: number[];
  /** Container height, typically passed in to match the chart's height
   *  so the two columns visually align. Spot overlay + rows are laid
   *  out proportionally within. */
  height?: number;
}

/** Build a flat sparkline of `<rect>` bars for one strike/side.
 *  Bars normalize against the maximum volume across BOTH call+put for
 *  this strike+axis pair, so the call vs put bars at the same minute
 *  are visually comparable. */
function Sparkline({
  values,
  axis,
  spikes,
  width,
  side,
}: {
  values: Array<number | null>;
  axis: string[];
  spikes: Set<string>;
  width: number;
  side: "call" | "put";
}) {
  // Hemisphere convention: calls = blue, puts = amber. Spike border
  // is a brighter accent on top of the side's base colour.
  const baseColor = side === "call" ? colors.accentBlue : colors.accentAmber;
  const spikeColor = colors.accentRed;
  const numericValues = values.filter((v): v is number => v !== null);
  const max = numericValues.length > 0 ? Math.max(...numericValues) : 0;
  // Bar width: derive from container width / axis length, then floor
  // to MIN_BAR_WIDTH so even a 30-bucket window stays legible.
  const slot = axis.length > 0 ? width / axis.length : width;
  const barWidth = Math.max(MIN_BAR_WIDTH, slot - BAR_GAP);

  return (
    <svg
      width={width}
      height={SPARK_HEIGHT}
      style={{ display: "block" }}
      aria-label={`${side} per-minute volume sparkline`}
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

/** Render the small ▲ glyph row above the call sparkline, one ▲ per
 *  spike minute. Renders to the right of the call sparkline's x-grid
 *  so each glyph sits directly over its corresponding bar. */
function SpikeGlyphRow({
  axis,
  callSpikes,
  putSpikes,
  width,
}: {
  axis: string[];
  callSpikes: Set<string>;
  putSpikes: Set<string>;
  width: number;
}) {
  const slot = axis.length > 0 ? width / axis.length : width;
  // We render one row of glyphs spanning both sides: ▲ for call spikes,
  // ▼ for put spikes — same minute may carry both. They share the row
  // to keep vertical space tight.
  return (
    <svg
      width={width}
      height={SPIKE_GLYPH_HEIGHT}
      style={{ display: "block" }}
      aria-label="spike-minute markers"
    >
      {axis.map((ts, i) => {
        const isCall = callSpikes.has(ts);
        const isPut = putSpikes.has(ts);
        if (!isCall && !isPut) return null;
        const cx = i * slot + slot / 2;
        const glyph = isCall ? "▲" : "▼"; // ▲ / ▼
        return (
          <text
            key={ts}
            x={cx}
            y={SPIKE_GLYPH_HEIGHT - 1}
            fill={colors.accentRed}
            fontSize={7}
            fontFamily={fonts.mono}
            textAnchor="middle"
          >
            {glyph}
          </text>
        );
      })}
    </svg>
  );
}

/** Spot-path mini-line above the per-strike rows. One SVG <polyline>
 *  fed by the velocity_tape.spot_path 1-min closes. Suppressed when
 *  spot_path is null or empty. */
function SpotOverlay({
  points,
  width,
}: {
  points: Array<{ ts: string; price: number }>;
  width: number;
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
  const xs = points.map((_, i) => (i / (points.length - 1)) * width);
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
        width={width}
        height={SPOT_OVERLAY_HEIGHT}
        style={{ display: "block" }}
        aria-label="SPX spot path during replay window"
      >
        <polyline
          points={pathPoints}
          stroke={colors.textSecondary}
          strokeWidth={1}
          fill="none"
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
  height = 540,
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
      return tape.window_start;
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

  // ── Width budget for sparkline columns ────────────────────────────
  // Total component width is constrained by parent (~280px on
  // desktop). The sparkline gets whatever remains after the strike +
  // volume labels.
  const componentWidth = 280;
  const sparkWidth = componentWidth - STRIKE_LABEL_WIDTH - VOLUME_LABEL_WIDTH - 16;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: componentWidth,
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: "10px 10px 12px 10px",
        height,
        display: "flex",
        flexDirection: "column",
        fontFamily: fonts.sans,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 10,
            letterSpacing: "0.08em",
            color: colors.accentAmber,
            textTransform: "uppercase",
          }}
        >
          Frozen Replay
        </div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 11,
            color: colors.textPrimary,
          }}
        >
          {headerLabel}
        </div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 10,
            color: colors.textMuted,
          }}
        >
          {formatVolume(totalVolume)} contracts ·{" "}
          <span style={{ color: colors.accentBlue }}>calls</span>{" "}
          /{" "}
          <span style={{ color: colors.accentAmber }}>puts</span>
        </div>
      </div>

      {/* Optional SPX spot overlay */}
      {tape.spot_path && tape.spot_path.length > 1 && (
        <SpotOverlay points={tape.spot_path} width={componentWidth - 20} />
      )}

      {/* Column headers above the per-strike rows */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${STRIKE_LABEL_WIDTH}px 1fr ${VOLUME_LABEL_WIDTH}px`,
          gap: 6,
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
        {orderedStrikes.map((strike) => {
          const s = strikesByKey.get(strike)!;
          const callValues = densify(s.call_minutes, axis);
          const putValues = densify(s.put_minutes, axis);
          const callSpikes = new Set(s.call_spike_minutes);
          const putSpikes = new Set(s.put_spike_minutes);
          const rowTotal = rowTotalVolume(s);
          const hasSpike = s.call_spike_minutes.length > 0 || s.put_spike_minutes.length > 0;
          return (
            <div
              key={strike}
              style={{
                display: "grid",
                gridTemplateColumns: `${STRIKE_LABEL_WIDTH}px 1fr ${VOLUME_LABEL_WIDTH}px`,
                gap: 6,
                alignItems: "center",
                height: ROW_HEIGHT,
                paddingTop: 2,
                paddingBottom: 2,
                borderBottom: `1px solid ${withAlpha(colors.borderDim, 0.4)}`,
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
                }}
              >
                <SpikeGlyphRow
                  axis={axis}
                  callSpikes={callSpikes}
                  putSpikes={putSpikes}
                  width={sparkWidth}
                />
                <Sparkline
                  values={callValues}
                  axis={axis}
                  spikes={callSpikes}
                  width={sparkWidth}
                  side="call"
                />
                <Sparkline
                  values={putValues}
                  axis={axis}
                  spikes={putSpikes}
                  width={sparkWidth}
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
