/**
 * TentChart — DC payoff "tent" visualization.
 *
 * Renders the position's value curve across SPX with overlays:
 *   - Frozen-IV curve (entry_*_iv anchor) — solid amber
 *   - Live-IV curve (latest greek_snapshots) — dashed blue
 *     (only present when both responses provided)
 *   - Current SPX vertical (from broker_state sidecar)
 *   - Breakeven verticals (low + high; off-chart values silently
 *     omitted)
 *   - Pole markers (the two short strikes — the "tent pegs")
 *   - Horizontal entry_debit reference line (P&L=0)
 *
 * Phantom positions get a dashed container border + an
 * "AUTOMATION MISSED" pill in the header. Real positions render
 * unadorned. Both pull from the same tent endpoint shape.
 *
 * The container's parent decides sizing; TentChart fills width and
 * uses a fixed `height` prop (default 340) so the modal can give it
 * the full panel and a small-multiples grid can give it ~200.
 */

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import type { DCTentResponse } from "../../api/dcTypes";


export interface TentChartProps {
  /** Frozen-IV curve. Always shown when present. */
  frozenCurve: DCTentResponse | null;
  /**
   * Live-IV curve (from greek_snapshots latest snapshot). Optional;
   * when present AND iv_source==="latest", rendered as a dashed
   * overlay so operator can see frozen-vs-drifted IV side-by-side.
   * When iv_source==="entry_fallback" the curves are identical and
   * the live overlay is suppressed.
   */
  liveCurve?: DCTentResponse | null;
  /** Pixel height. Default 340; small-multiples shrink to ~200. */
  height?: number;
  /** Compact mode hides axis labels and legend (small-multiples). */
  compact?: boolean;
}


const COLOR_FROZEN = colors.lumen;          // amber — frozen-at-entry
const COLOR_LIVE = colors.accentBlue;       // blue — live-drift
const COLOR_SPX = colors.accentGreen;       // green — current SPX marker
const COLOR_BREAKEVEN = colors.textMuted;   // muted — zero P&L verticals
const COLOR_POLE = colors.textDim;          // dim — short-strike markers
const COLOR_DEBIT_LINE = withAlpha(colors.textMuted, 0.4);


export function TentChart({
  frozenCurve,
  liveCurve,
  height = 340,
  compact = false,
}: TentChartProps) {
  const option = useMemo(() => {
    if (frozenCurve == null) return null;

    // Decide whether the live overlay adds information. When the
    // backend returned `entry_fallback`, frozen and live are
    // bitwise-identical and stacking them just halves the visual
    // contrast — drop the overlay in that case.
    const showLive =
      liveCurve != null &&
      liveCurve.iv_source === "latest" &&
      liveCurve.points.length > 0;

    const frozenData = frozenCurve.points.map((p) => [p.spx, p.value]);
    const liveData = showLive
      ? liveCurve!.points.map((p) => [p.spx, p.value])
      : [];

    const verticals: Array<{
      xAxis: number;
      lineStyle: { color: string; type?: "solid" | "dashed" | "dotted"; width?: number };
      label: { formatter: string; color: string };
    }> = [];

    // Current SPX — only when broker_state sidecar gave us a value.
    if (
      frozenCurve.current_spx != null &&
      frozenCurve.current_spx_source === "broker_state"
    ) {
      verticals.push({
        xAxis: frozenCurve.current_spx,
        lineStyle: { color: COLOR_SPX, width: 2, type: "solid" },
        label: {
          formatter: `SPX ${frozenCurve.current_spx.toFixed(0)}`,
          color: COLOR_SPX,
        },
      });
    }

    // Poles — short strikes.
    verticals.push({
      xAxis: frozenCurve.pole_low,
      lineStyle: { color: COLOR_POLE, width: 1, type: "dotted" },
      label: { formatter: `P${frozenCurve.pole_low.toFixed(0)}`, color: COLOR_POLE },
    });
    verticals.push({
      xAxis: frozenCurve.pole_high,
      lineStyle: { color: COLOR_POLE, width: 1, type: "dotted" },
      label: { formatter: `C${frozenCurve.pole_high.toFixed(0)}`, color: COLOR_POLE },
    });

    // Breakevens — null on either side means "off-chart", so skip.
    if (frozenCurve.breakeven_low != null) {
      verticals.push({
        xAxis: frozenCurve.breakeven_low,
        lineStyle: { color: COLOR_BREAKEVEN, width: 1, type: "dashed" },
        label: {
          formatter: `BE ${frozenCurve.breakeven_low.toFixed(0)}`,
          color: COLOR_BREAKEVEN,
        },
      });
    }
    if (frozenCurve.breakeven_high != null) {
      verticals.push({
        xAxis: frozenCurve.breakeven_high,
        lineStyle: { color: COLOR_BREAKEVEN, width: 1, type: "dashed" },
        label: {
          formatter: `BE ${frozenCurve.breakeven_high.toFixed(0)}`,
          color: COLOR_BREAKEVEN,
        },
      });
    }

    const series: Record<string, unknown>[] = [
      {
        name: "Frozen IV (entry)",
        type: "line",
        data: frozenData,
        smooth: true,
        symbol: "none",
        lineStyle: { color: COLOR_FROZEN, width: 2 },
        areaStyle: { color: withAlpha(COLOR_FROZEN, 0.12) },
        // Horizontal markLine at entry_debit — the zero-P&L threshold.
        // Anchoring it to the frozen series so it doesn't double when
        // both curves are shown.
        markLine: {
          symbol: "none",
          silent: true,
          lineStyle: { color: COLOR_DEBIT_LINE, type: "dashed", width: 1 },
          data: [
            ...verticals,
            {
              yAxis: frozenCurve.entry_debit,
              lineStyle: { color: COLOR_DEBIT_LINE, type: "dashed", width: 1 },
              label: {
                formatter: `entry $${frozenCurve.entry_debit.toFixed(2)}`,
                color: colors.textMuted,
                position: "insideEndTop" as const,
              },
            },
          ],
        },
      },
    ];

    if (showLive) {
      series.push({
        name: "Live IV",
        type: "line",
        data: liveData,
        smooth: true,
        symbol: "none",
        lineStyle: { color: COLOR_LIVE, width: 2, type: "dashed" },
      });
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: {
        left: compact ? 36 : 56,
        right: compact ? 16 : 32,
        top: compact ? 16 : 32,
        bottom: compact ? 28 : 40,
      },
      legend: compact
        ? { show: false }
        : {
            data: showLive ? ["Frozen IV (entry)", "Live IV"] : ["Frozen IV (entry)"],
            textStyle: { color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 11 },
            top: 4,
          },
      tooltip: {
        trigger: "axis",
        backgroundColor: colors.bgPanel,
        borderColor: colors.borderMid,
        textStyle: { color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 11 },
        // Each series gets a row in the tooltip; cap to 2 decimals so
        // a 121-point tent doesn't render 6-digit float precision.
        valueFormatter: (v: unknown) =>
          typeof v === "number" ? `$${v.toFixed(2)}` : String(v),
      },
      xAxis: {
        type: "value",
        // `scale: true` tells ECharts to fit the axis to the actual data
        // extents instead of "nicely" extending to zero. Without this,
        // SPX in [6800, 7640] gets rendered on an axis that spans
        // [0, 8000] — tent shape collapses into the rightmost ~10% of
        // the chart, illegible. Operator-reported regression.
        scale: true,
        name: compact ? "" : "SPX",
        nameLocation: "middle",
        nameGap: 24,
        nameTextStyle: { color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 11 },
        axisLabel: {
          color: colors.textSecondary,
          fontFamily: fonts.mono,
          fontSize: 10,
          formatter: (v: number) => v.toFixed(0),
        },
        axisLine: { lineStyle: { color: colors.borderMid } },
        splitLine: { lineStyle: { color: withAlpha(colors.borderDim, 0.5) } },
      },
      yAxis: {
        type: "value",
        // Same `scale: true` rationale as xAxis — a tent whose value
        // ranges $4-$45 should fit the chart, not show $0-$50 with
        // half the chart wasted on empty space below the valley.
        scale: true,
        name: compact ? "" : "Position value ($)",
        nameLocation: "middle",
        nameGap: 44,
        nameTextStyle: { color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 11 },
        axisLabel: {
          color: colors.textSecondary,
          fontFamily: fonts.mono,
          fontSize: 10,
          formatter: (v: number) => `$${v.toFixed(0)}`,
        },
        axisLine: { lineStyle: { color: colors.borderMid } },
        splitLine: { lineStyle: { color: withAlpha(colors.borderDim, 0.5) } },
      },
      series,
    };
  }, [frozenCurve, liveCurve, compact]);

  if (option == null) {
    return (
      <div style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.textMuted,
        fontFamily: fonts.sans,
        fontSize: 12,
      }}>
        No tent data available
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ height, width: "100%" }}
      notMerge
    />
  );
}
