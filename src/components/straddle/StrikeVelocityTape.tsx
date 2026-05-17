/**
 * StrikeVelocityTape — frozen replay of strike-level trade velocity
 * for the 0DTE chain, rendered as a full-width major panel BELOW the
 * straddle body grid.
 *
 * Heatmap redesign (#320). The previous SVG sparkline + spike-glyph
 * layout was "fancy but not actionable" — bars smushed as the panel
 * widened, the two-per-strike rows blurred call vs put, the SPX
 * overlay collided with column headers, and no interactivity. The
 * redesign trades all of that for a dense ECharts heatmap where:
 *
 *   - Rows are strikes (descending top→bottom, same as the chart axis)
 *   - Columns are 1-min buckets across the replay window
 *   - Cell color encodes total (call+put) volume on a warm gradient
 *     so "heat" reads naturally — operators scan for the bright spots
 *   - Spike minutes (>3σ MAD threshold) wear a thick red border so
 *     they pop without distorting the gradient
 *   - Hover tooltip discloses the call/put split and the spike flag
 *
 * Above the heatmap, a small ECharts line chart traces the SPX 1-min
 * close path across the same window. Same minute-axis range, separate
 * chart instance (simpler to size independently than ECharts grids).
 *
 * Null contract: when the parent passes `tape={null}` (no replay row
 * yet), the component renders a single muted "(no replay available)"
 * placeholder, sized to match the chart so the layout doesn't reflow
 * when a replay first appears.
 *
 * Chart-lifecycle rules (matching StraddleMapChart):
 *   - `echarts.init` once with `[]` dep — instance held in a ref
 *   - `setOption(...)` in a separate `[data]` dep effect (no teardown
 *     on refresh — just rebind series)
 *   - `ResizeObserver` on the container → `chart.resize()`
 *   - `chart.dispose()` on unmount (echarts holds the canvas otherwise)
 */

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import type { VelocityStrike, VelocityTape } from "../../api/terminalTypes";
import {
  buildHeatmapCells,
  buildSpotPathPoints,
  buildSpotPathSeries,
  buildUnifiedMinuteAxis,
  buildXLabelMask,
  computeMaxVolume,
  formatMinuteLabel,
  formatVolume,
  HEATMAP_GRID_BOTTOM,
  HEATMAP_GRID_TOP,
  resolveStrikeOrder,
  rowTotalVolume,
  sumVolume,
} from "./strikeVelocityHelpers";

// ── Geometry ────────────────────────────────────────────────────────
// Single source of truth for chart dims. The heatmap height scales
// with strike count so 11 strikes (the typical ATM ± 5 cluster) gets
// ~30px per row + axis-label headroom; very narrow tapes still get
// a legible row height.

const SPOT_CHART_HEIGHT = 80;
const HEATMAP_ROW_PX = 28;
const HEATMAP_AXIS_PADDING = 60;
const STRIKE_LABEL_WIDTH = 60;
const TOTAL_LABEL_WIDTH = 72;

interface Props {
  tape: VelocityTape | null;
  /** Strike order from the chart (descending). The component filters
   *  to strikes the tape carries and renders them in this order so the
   *  cluster subset reads in the same direction as the chart's y-axis.
   *  This is NOT a row-by-row alignment — the heatmap uses its own per-
   *  row pixel density, independent of the chart's strike packing.
   *  When null/empty, falls back to the tape's own strike order
   *  (descending by strike). */
  strikeOrder?: number[];
  /** Optional container height. When omitted (the default), the panel
   *  sizes to its content — the heatmap row count drives the total
   *  height. Pass an explicit number to cap (e.g., if embedding in a
   *  side panel that needs a fixed band). */
  height?: number;
}

/** Compact SPX spot-path line chart, anchored above the heatmap.
 *
 *  Renders against the SHARED minute axis (`axis` prop) — the same axis
 *  the heatmap uses — so column N of the heatmap and point N of the
 *  spot line refer to the SAME wall-clock minute (#206 R2 B3). Missing
 *  minutes (axis ticks that have no spot_path entry) render as a gap
 *  in the line via null values in the series data. */
function SpotPathChart({ tape, axis }: { tape: VelocityTape; axis: string[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // Resolve the axis-aligned series once per (tape, axis). Returns null
  // when fewer than 2 non-null points exist (matches the legacy
  // buildSpotPathPoints contract — caller hides the section).
  const series = useMemo(() => buildSpotPathSeries(tape, axis), [tape, axis]);

  // ── Init once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // ── Re-bind options whenever data changes ──────────────────────────
  const option = useMemo<EChartsOption | null>(() => {
    if (!series || axis.length === 0) return null;
    const prices: number[] = [];
    for (const v of series) if (v !== null) prices.push(v);
    if (prices.length < 2) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = Math.max(0.01, max - min);
    // 5% headroom on each side so the line never hugs the chart edge.
    const yMin = min - range * 0.05;
    const yMax = max + range * 0.05;
    // Endpoints for markPoint: first and last NON-NULL values, paired
    // with their axis indices so the markers sit on the actual data
    // points (axis category index, not time). Captured as concrete
    // numbers (not `null`) so the coord arrays we hand to ECharts
    // satisfy MarkPointDataItemOption's `(string | number)[]` shape.
    let firstIdx = -1;
    let lastIdx = -1;
    let firstPrice = NaN;
    let lastPrice = NaN;
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v !== null) {
        if (firstIdx === -1) {
          firstIdx = i;
          firstPrice = v;
        }
        lastIdx = i;
        lastPrice = v;
      }
    }
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: {
        left: STRIKE_LABEL_WIDTH,
        right: TOTAL_LABEL_WIDTH,
        top: 8,
        bottom: 20,
        containLabel: false,
      },
      xAxis: {
        type: "category",
        // Render against the SHARED minute axis (same as the heatmap)
        // so equal x-coordinates between this chart and the heatmap
        // represent the same wall-clock minute (#206 R2 B3).
        data: axis,
        axisLine: { lineStyle: { color: colors.borderDim } },
        axisTick: { show: false },
        axisLabel: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: "value",
        min: yMin,
        max: yMax,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          show: true,
          color: colors.textMuted,
          fontFamily: fonts.mono,
          fontSize: 9,
          showMinLabel: true,
          showMaxLabel: true,
          formatter: (v: number) => v.toFixed(2),
        },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: colors.bgPanel,
        borderColor: colors.borderDim,
        borderWidth: 1,
        textStyle: { color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 11 },
        formatter: (params: unknown) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const p = params[0] as { axisValue?: string; data?: number | null };
          const ts = typeof p.axisValue === "string" ? p.axisValue : "";
          const label = ts ? formatMinuteLabel(ts) : "";
          if (p.data === null || p.data === undefined || typeof p.data !== "number") {
            return `<div style="color:${colors.textMuted}">SPX —</div>` +
              `<div style="color:${colors.textMuted};margin-top:2px">${label} ET</div>`;
          }
          return `<div style="color:${colors.textBright}">SPX ${p.data.toFixed(2)}</div>` +
            `<div style="color:${colors.textMuted};margin-top:2px">${label} ET</div>`;
        },
      },
      series: [
        {
          type: "line",
          smooth: true,
          showSymbol: false,
          // ECharts skips null values in line series, creating a clean
          // gap rather than a fake interpolated value across missing
          // minutes (#206 R2 B3).
          connectNulls: false,
          // Endpoint markers anchor the eye to the start/end prices the
          // header surfaces in text — operator can correlate the chart
          // tail to "{start} → {end}" without cross-referencing. Anchored
          // on the first/last NON-NULL axis indices.
          markPoint: firstIdx >= 0 && lastIdx >= 0 && firstIdx !== lastIdx
            ? {
                symbol: "circle",
                symbolSize: 6,
                itemStyle: { color: colors.accentAmber, borderColor: colors.bgPanel, borderWidth: 1 },
                label: { show: false },
                data: [
                  { name: "start", coord: [axis[firstIdx], firstPrice] },
                  { name: "end", coord: [axis[lastIdx], lastPrice] },
                ],
              }
            : undefined,
          lineStyle: { color: colors.accentAmber, width: 1.6 },
          data: series,
        },
      ],
    };
  }, [series, axis]);

  useEffect(() => {
    if (!chartRef.current || !option) return;
    chartRef.current.setOption(option, { notMerge: true });
  }, [option]);

  if (!series) return null;
  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="SPX spot path during replay window"
      style={{ width: "100%", height: SPOT_CHART_HEIGHT }}
    />
  );
}

/** Heatmap chart: strike rows × minute columns, color = total volume,
 *  spike border = >3σ MAD minute on either side. */
function HeatmapChart({
  tape,
  strikes,
  axis,
}: {
  tape: VelocityTape;
  strikes: number[];
  axis: string[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // Build the data array + helpers once per (tape, strikes, axis). The
  // helpers are pure so this memo is cheap; keeps the option-builder
  // effect from re-running on unrelated parent rerenders.
  const data = useMemo(() => {
    const cells = buildHeatmapCells(tape, strikes, axis);
    const max = computeMaxVolume(tape, strikes);
    return { cells, max };
  }, [tape, strikes, axis]);

  // ── Init once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // ── Re-bind options whenever data changes ──────────────────────────
  const option = useMemo<EChartsOption | null>(() => {
    if (axis.length === 0 || strikes.length === 0) return null;
    // X-axis labels at 5-min intervals derived from the WALL-CLOCK minute
    // (not the array index) so labels land on :00/:05 boundaries
    // regardless of where the replay window starts (#206 R1 I1).
    const xLabels = axis.map((ts) => formatMinuteLabel(ts));
    const xLabelShown = buildXLabelMask(axis);
    // Strike labels go on the left axis with the highest strike at the
    // top — y-axis natively renders categories bottom-up, so we feed it
    // descending strings and rely on `inverse: false` so [0] ends up at
    // the BOTTOM, then flip with `inverse: true`. Easier: just feed
    // already-descending strikes and inverse=true. We choose the latter.
    const yLabels = strikes.map((s) => s.toFixed(0));
    // Latest-minute accent (#206 R2 I1 + round-2 follow-up): a dashed
    // vertical line BETWEEN the last and second-to-last cells, labeled
    // "NOW", draws the eye to "what's hot right now". Skipped when
    // axis has fewer than 2 minutes.
    //
    // ECharts category xAxis defaults to `boundaryGap: true`, so an
    // integer `xAxis: N-1` markLine renders AT the CENTER of band N-1
    // (i.e., ON the last column). To position the line BETWEEN the
    // last two cells (the visual boundary signaling "now"), we use the
    // fractional category index `N - 1.5` — ECharts accepts fractional
    // markLine positions on category axes and interpolates between
    // band centers. The "NOW" label anchors the semantic explicitly so
    // the dashed line isn't ambiguous.
    const latestMinuteMarkLine = axis.length >= 2
      ? {
          symbol: "none",
          silent: true,
          animation: false,
          lineStyle: {
            color: withAlpha(colors.textBright, 0.5),
            type: "dashed" as const,
            width: 1,
          },
          label: {
            show: true,
            formatter: "NOW",
            position: "end" as const,
            color: withAlpha(colors.textBright, 0.7),
            fontFamily: fonts.mono,
            fontSize: 9,
            fontWeight: 700,
          },
          data: [{ xAxis: axis.length - 1.5 }],
        }
      : undefined;
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: {
        left: STRIKE_LABEL_WIDTH,
        right: TOTAL_LABEL_WIDTH,
        // Heatmap plot bounds are pulled from the shared constants so
        // the RightTotalsColumn wrapper stays in lockstep (#206 R1 I2).
        top: HEATMAP_GRID_TOP,
        bottom: HEATMAP_GRID_BOTTOM,
        containLabel: false,
      },
      xAxis: {
        type: "category",
        data: xLabels,
        position: "bottom",
        axisLine: { lineStyle: { color: colors.borderDim } },
        axisTick: { show: false },
        splitArea: { show: false },
        axisLabel: {
          color: colors.textSecondary,
          fontFamily: fonts.mono,
          fontSize: 10,
          // Label visibility is derived from the WALL-CLOCK minute (see
          // xLabelShown above). ECharts' `interval` axis callback
          // receives `(index, value)`; we precomputed the boolean per
          // tick so the callback is a simple array lookup. Returning
          // true shows the label, false hides it.
          interval: (i: number) => xLabelShown[i] === true,
        },
      },
      yAxis: {
        type: "category",
        data: yLabels,
        // `strikes` is already descending (high→low). ECharts category
        // axes put index[0] at the BOTTOM by default; `inverse: true`
        // flips so index[0] (the HIGHEST strike) sits at the TOP,
        // matching how operators read option chains (calls/upside above
        // ATM, puts/downside below).
        inverse: true,
        // Lock the band layout so RightTotalsColumn's flex:1 row
        // distribution stays aligned with the heatmap's strike rows
        // (#206 R1 I2). For category axes, `boundaryGap: true` makes
        // each category occupy a full band with the tick at the band
        // center — heatmap cells then span an entire band per strike,
        // matching the equal-flex rows in RightTotalsColumn.
        boundaryGap: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitArea: { show: false },
        axisLabel: {
          color: colors.textPrimary,
          fontFamily: fonts.mono,
          fontSize: 11,
          formatter: (v: string) => v,
        },
      },
      visualMap: {
        type: "continuous",
        min: 0,
        max: data.max,
        calculable: false,
        show: false,
        inRange: {
          // Warm gradient: faint amber baseline → amber mid → bright red
          // at peak. The baseline tint (low stop) is a faint amber wash
          // rather than fully transparent so zero-volume cells still
          // render as a visible cell — operator can hover them to see
          // "0 prints this minute" instead of the cell vanishing into
          // background (#206 R2 B2). The mid stop stays amber so the
          // gradient still climbs warmth-to-heat through the band.
          color: [
            withAlpha(colors.accentAmber, 0.12),
            withAlpha(colors.accentAmber, 0.55),
            colors.accentRed,
          ],
        },
      },
      tooltip: {
        trigger: "item",
        backgroundColor: colors.bgPanel,
        borderColor: colors.borderDim,
        borderWidth: 1,
        textStyle: { color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 11 },
        formatter: (params: unknown) => {
          // ECharts heatmap params.value === [colIdx, rowIdx, value]
          const p = params as { value?: [number, number, number] };
          if (!p.value || p.value.length < 3) return "";
          const [colIdx, rowIdx, totalVol] = p.value;
          const strike = strikes[rowIdx];
          const ts = axis[colIdx];
          const row = tape.strikes.find((s) => s.strike === strike);
          const callVol = row?.call_minutes.find((m) => m.ts === ts)?.volume ?? 0;
          const putVol = row?.put_minutes.find((m) => m.ts === ts)?.volume ?? 0;
          const callSpike = row?.call_spike_minutes.includes(ts) ?? false;
          const putSpike = row?.put_spike_minutes.includes(ts) ?? false;
          const spikeLine = callSpike && putSpike
            ? `<div style="color:${colors.textBright};margin-top:4px">⚠ Spike (both)</div>`
            : callSpike
              ? `<div style="color:${colors.textBright};margin-top:4px">⚠ Spike (call)</div>`
              : putSpike
                ? `<div style="color:${colors.textBright};margin-top:4px">⚠ Spike (put)</div>`
                : "";
          // Put-side label uses `accentBlue` (the same hue as the call
          // side, paired with the "PUT"/"CALL" prefix to carry the
          // distinction via text) rather than `accentAmber`. Amber is
          // the heatmap's midpoint visualMap color, so a warm-amber
          // cell with amber put-text in its tooltip produced a
          // chromatic clash (#206 R2 I4). Matches PinCandidatesPanel
          // text-only-distinction convention.
          return [
            `<div style="font-weight:bold;color:${colors.textBright}">Strike ${strike.toFixed(0)}</div>`,
            `<div style="color:${colors.textMuted};margin-top:2px">${formatMinuteLabel(ts)} ET</div>`,
            `<div style="margin-top:4px;color:${colors.textPrimary}">Total: ${formatVolume(totalVol)}</div>`,
            `<div style="margin-top:2px"><span style="color:${colors.accentBlue}">CALL ${formatVolume(callVol)}</span> / <span style="color:${colors.accentBlue}">PUT ${formatVolume(putVol)}</span></div>`,
            spikeLine,
          ].join("");
        },
      },
      series: [
        {
          type: "heatmap",
          data: data.cells,
          itemStyle: {
            borderRadius: 2,
            borderColor: withAlpha(colors.bgPanel, 0.8),
            borderWidth: 1,
          },
          emphasis: {
            itemStyle: {
              // Bump emphasis borderWidth above the spike border (2px)
              // so hovering a spike cell always produces a visible
              // delta — without this, hovering a spike cell looked
              // identical to the resting state (#206 R2 I3).
              borderColor: colors.textBright,
              borderWidth: 3,
            },
          },
          markLine: latestMinuteMarkLine,
          progressive: 0, // disable progressive rendering for crispness
        },
      ],
    };
  }, [tape, strikes, axis, data]);

  useEffect(() => {
    if (!chartRef.current || !option) return;
    chartRef.current.setOption(option, { notMerge: true });
  }, [option]);

  const chartHeight = Math.max(
    HEATMAP_ROW_PX * 3 + HEATMAP_AXIS_PADDING,
    strikes.length * HEATMAP_ROW_PX + HEATMAP_AXIS_PADDING,
  );

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={
        "Strike velocity heatmap. Rows are strikes, columns are " +
        "1-minute buckets. Cell color intensity encodes total " +
        "(call+put) volume; a red border marks spike minutes."
      }
      style={{ width: "100%", height: chartHeight }}
    />
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
  const orderedStrikes = useMemo(
    () => (tape ? resolveStrikeOrder(tape, strikeOrder) : []),
    [strikeOrder, tape],
  );

  // ── Shared minute axis (union of strike minutes ∪ spot-path minutes)
  // Both the spot-path chart and the heatmap consume this same axis so
  // a column index in one refers to the SAME wall-clock minute as the
  // same column index in the other (#206 R2 B3).
  const axis = useMemo(
    () => (tape ? buildUnifiedMinuteAxis(tape) : []),
    [tape],
  );

  // ── Per-strike row total + spike-flag lookup for the right-side col
  const rowTotals = useMemo(() => {
    if (!tape) return new Map<number, { total: number; hasSpike: boolean }>();
    const m = new Map<number, { total: number; hasSpike: boolean }>();
    for (const s of tape.strikes) {
      const total = rowTotalVolume(s);
      const hasSpike =
        s.call_spike_minutes.length > 0 || s.put_spike_minutes.length > 0;
      m.set(s.strike, { total, hasSpike });
    }
    return m;
  }, [tape]);

  // ── Window label for header (e.g. "Fri 15:30-16:00 ET") ───────────
  const headerLabel = useMemo(() => {
    if (!tape) return "";
    try {
      const start = new Date(tape.window_start);
      const end = new Date(tape.window_end);
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

  // ── Spot path summary for the section header above the line chart
  const spotSummary = useMemo(() => {
    if (!tape) return null;
    const pts = buildSpotPathPoints(tape);
    if (!pts) return null;
    const start = pts[0][1];
    const end = pts[pts.length - 1][1];
    return { start, end, change: end - start };
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
          of the chart, not a sidebar. The three-tone title row is
          preserved from the prior design (operator approved). */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginBottom: 10,
        }}
      >
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
            · ATM ± 5 cluster ·{" "}
            <span style={{ color: colors.accentAmber }}>
              Frozen Friday-close replay
            </span>
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

      {/* SPX spot path — labeled section header + ECharts line chart.
          Suppressed when buildSpotPathPoints returns null. */}
      {spotSummary && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 10,
              color: colors.textMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            SPX during window —{" "}
            <span style={{ color: colors.textPrimary }}>
              {spotSummary.start.toFixed(2)}
            </span>
            {" → "}
            <span style={{ color: colors.textPrimary }}>
              {spotSummary.end.toFixed(2)}
            </span>
            {"  "}
            <span
              style={{
                color:
                  spotSummary.change >= 0
                    ? colors.accentGreen
                    : colors.accentRed,
              }}
            >
              ({spotSummary.change >= 0 ? "+" : ""}
              {spotSummary.change.toFixed(2)})
            </span>
          </div>
          <SpotPathChart tape={tape} axis={axis} />
        </div>
      )}

      {/* Heatmap section — labeled section header + ECharts heatmap +
          right-side per-strike total volume column overlaid on the
          chart's right margin. */}
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 10,
          color: colors.textMuted,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        Heatmap · color = total volume · red border = spike
      </div>

      {/* Heatmap + right-side total column. Position the totals
          absolutely over the chart's right margin so they align row-by-
          row with the heatmap's strike y-axis. */}
      <div style={{ position: "relative" }}>
        <HeatmapChart tape={tape} strikes={orderedStrikes} axis={axis} />
        <RightTotalsColumn
          strikes={orderedStrikes}
          rowTotals={rowTotals}
        />
      </div>
    </div>
  );
}

/** Per-strike total-volume column rendered as absolutely-positioned
 *  labels in the heatmap's right margin. Each label sits at the
 *  vertical center of its strike row by computing
 *  `top = (rowIdx + 0.5) / N * heatmapHeight`. Spike rows render bold +
 *  red so the operator can scan totals visually alongside the heatmap.
 *
 *  Lives outside the ECharts chart because ECharts' built-in axis-tick
 *  labels can't carry per-row styling (red/bold for spike rows) without
 *  fragile custom-graphic gymnastics. A plain absolutely-positioned
 *  div is the simpler, more legible approach.
 *
 *  Row alignment: the wrapper's `top`/`bottom` mirror the heatmap's
 *  `grid.top`/`grid.bottom` (HEATMAP_GRID_TOP / _BOTTOM), and the
 *  heatmap's yAxis pins `boundaryGap: true` so each strike occupies a
 *  full categorical band centered on its tick — the ECharts band layout
 *  then partitions the usable height into N equal bands, matching the
 *  `flex:1` row distribution here (#206 R1 I2). */
function RightTotalsColumn({
  strikes,
  rowTotals,
}: {
  strikes: number[];
  rowTotals: Map<number, { total: number; hasSpike: boolean }>;
}) {
  const n = strikes.length;
  if (n === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: HEATMAP_GRID_TOP,
        bottom: HEATMAP_GRID_BOTTOM,
        right: 0,
        width: TOTAL_LABEL_WIDTH,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      {strikes.map((strike) => {
        const entry = rowTotals.get(strike) ?? { total: 0, hasSpike: false };
        return (
          <div
            key={strike}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingRight: 8,
              fontFamily: fonts.mono,
              fontSize: 11,
              color: entry.hasSpike ? colors.accentRed : colors.textPrimary,
              fontWeight: entry.hasSpike ? 600 : 400,
            }}
          >
            {formatVolume(entry.total)}
          </div>
        );
      })}
    </div>
  );
}

// Re-export so consumers (and tests) can still import VelocityStrike
// from the helpers if needed; future-proofs the API surface.
export type { VelocityStrike };
