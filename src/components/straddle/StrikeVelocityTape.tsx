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
  buildMinuteAxis,
  buildSpotPathPoints,
  computeMaxVolume,
  formatMinuteLabel,
  formatVolume,
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

/** Compact SPX spot-path line chart, anchored above the heatmap. */
function SpotPathChart({ tape }: { tape: VelocityTape }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // Resolve the data once per tape — buildSpotPathPoints returns null
  // when there's no path to draw (handled by the caller; we still guard
  // here to keep the chart effect pure).
  const points = useMemo(() => buildSpotPathPoints(tape), [tape]);

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
    if (!points || points.length < 2) return null;
    const prices = points.map((p) => p[1]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = Math.max(0.01, max - min);
    // 5% headroom on each side so the line never hugs the chart edge.
    const yMin = min - range * 0.05;
    const yMax = max + range * 0.05;
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
        data: points.map((p) => p[0]),
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
          const p = params[0] as { axisValue?: string; data?: number };
          const ts = typeof p.axisValue === "string" ? p.axisValue : "";
          const price = typeof p.data === "number" ? p.data : NaN;
          const label = ts ? formatMinuteLabel(ts) : "";
          return `<div style="color:${colors.textBright}">SPX ${price.toFixed(2)}</div>` +
            `<div style="color:${colors.textMuted};margin-top:2px">${label} ET</div>`;
        },
      },
      series: [
        {
          type: "line",
          smooth: true,
          showSymbol: false,
          // Endpoint markers anchor the eye to the start/end prices the
          // header surfaces in text — operator can correlate the chart
          // tail to "{start} → {end}" without cross-referencing.
          markPoint: {
            symbol: "circle",
            symbolSize: 6,
            itemStyle: { color: colors.accentAmber, borderColor: colors.bgPanel, borderWidth: 1 },
            label: { show: false },
            data: [
              { name: "start", coord: [points[0][0], points[0][1]] },
              { name: "end", coord: [points[points.length - 1][0], points[points.length - 1][1]] },
            ],
          },
          lineStyle: { color: colors.accentAmber, width: 1.6 },
          data: points.map((p) => p[1]),
        },
      ],
    };
  }, [points]);

  useEffect(() => {
    if (!chartRef.current || !option) return;
    chartRef.current.setOption(option, { notMerge: true });
  }, [option]);

  if (!points) return null;
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
    // X-axis labels at 5-min intervals so the tape doesn't read as a
    // wall of timestamps. ECharts category axes accept a per-tick
    // formatter; we sample every 5th index off the formatted minute
    // (or render empty when not on a 5-min boundary).
    const xLabels = axis.map((ts) => formatMinuteLabel(ts));
    // Strike labels go on the left axis with the highest strike at the
    // top — y-axis natively renders categories bottom-up, so we feed it
    // descending strings and rely on `inverse: false` so [0] ends up at
    // the BOTTOM, then flip with `inverse: true`. Easier: just feed
    // already-descending strikes and inverse=true. We choose the latter.
    const yLabels = strikes.map((s) => s.toFixed(0));
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: {
        left: STRIKE_LABEL_WIDTH,
        right: TOTAL_LABEL_WIDTH,
        top: 10,
        bottom: 30,
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
          // Only render every 5th tick label (5-min cadence). ECharts
          // accepts a formatter that returns "" to hide labels per-tick.
          interval: (i: number) => i % 5 === 0,
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
          // Warm gradient: dark transparent panel → amber → bright red
          // at peak. Background panel base means low-volume cells fade
          // into the panel; only meaningful flow reads as "lit".
          color: [
            withAlpha(colors.bgPanel, 0),
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
            ? `<div style="color:${colors.accentRed};margin-top:4px">⚠ Spike (both)</div>`
            : callSpike
              ? `<div style="color:${colors.accentRed};margin-top:4px">⚠ Spike (call)</div>`
              : putSpike
                ? `<div style="color:${colors.accentRed};margin-top:4px">⚠ Spike (put)</div>`
                : "";
          return [
            `<div style="font-weight:bold;color:${colors.textBright}">Strike ${strike.toFixed(0)}</div>`,
            `<div style="color:${colors.textMuted};margin-top:2px">${formatMinuteLabel(ts)} ET</div>`,
            `<div style="margin-top:4px;color:${colors.textPrimary}">Total: ${formatVolume(totalVol)}</div>`,
            `<div style="margin-top:2px"><span style="color:${colors.accentBlue}">Call ${formatVolume(callVol)}</span> / <span style="color:${colors.accentAmber}">Put ${formatVolume(putVol)}</span></div>`,
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
              borderColor: colors.textBright,
              borderWidth: 2,
            },
          },
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

  // ── Shared minute axis (union of all minutes in the tape) ─────────
  const axis = useMemo(
    () => (tape ? buildMinuteAxis(tape) : []),
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
          <SpotPathChart tape={tape} />
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
 *  div is the simpler, more legible approach. */
function RightTotalsColumn({
  strikes,
  rowTotals,
}: {
  strikes: number[];
  rowTotals: Map<number, { total: number; hasSpike: boolean }>;
}) {
  const n = strikes.length;
  if (n === 0) return null;
  // Match the heatmap's grid: top=10, bottom=30 — so the usable y-range
  // is `chartHeight - 10 - 30`. Each row's center y is
  //   top_offset + (i + 0.5) * rowHeight
  // where rowHeight = usable / n. We can't easily get the *rendered*
  // chart height here without measuring; instead we let the parent's
  // flex layout drive height and position labels by percentage of the
  // chart container, anchored to the chart's effective y-range via the
  // same paddings the chart uses.
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        bottom: 30,
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
              borderTop: `1px dashed ${withAlpha(colors.borderDim, 0)}`,
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
