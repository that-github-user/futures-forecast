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
  /**
   * Live-IV curve at "halfway to front expiry" — same IVs as
   * `liveCurve` but with as_of advanced. Shows the tent mid-life.
   * Optional; rendered as a subtle bridge overlay between today
   * and at-expiry. Suppressed when DTE is too small for a
   * meaningful midpoint.
   */
  halfwayCurve?: DCTentResponse | null;
  /**
   * Live-IV curve at "just before front expiry" — the canonical
   * "two tents" shape. Operators expect this view (OptionStrat-style
   * time slider) and the at-expiry breakevens are the operationally
   * meaningful DC breakevens. When present, the breakeven markLines
   * are sourced from THIS curve, not `frozenCurve`.
   */
  atExpiryCurve?: DCTentResponse | null;
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
const COLOR_HALFWAY = colors.textSecondary; // bridge curve: mid-life snapshot
const COLOR_AT_EXPIRY = colors.accentRed;   // at-expiry: canonical "two tents" shape


export function TentChart({
  frozenCurve,
  liveCurve,
  halfwayCurve = null,
  atExpiryCurve = null,
  height = 340,
  compact = false,
}: TentChartProps) {
  const option = useMemo(() => {
    if (frozenCurve == null) return null;

    // Frozen series suppression: when the backend resolved iv_source
    // to "intrinsic" (legacy position with no entry_*_iv columns AND
    // no live snapshots yet), `frozen.points` are mathematically zero
    // everywhere — same-strike DC intrinsic = 0. Rendering a labeled
    // "Frozen IV (entry)" curve along the X axis is actively
    // misleading (operator sees what looks like a flat tent at $0
    // with the entry_debit markLine at $22 — appears as a "delta
    // impulse" at the current_spx vertical). Suppress and rely on
    // the warnings array (rendered by TentChartModal) to explain.
    const frozenIsIntrinsic = frozenCurve.iv_source === "intrinsic";

    // Decide whether the live overlay adds information. When the
    // backend returned `entry_fallback`, frozen and live are
    // bitwise-identical and stacking them just halves the visual
    // contrast — drop the overlay in that case.
    const showLive =
      liveCurve != null &&
      liveCurve.iv_source === "latest" &&
      liveCurve.points.length > 0;
    // If the frozen curve is intrinsic-junk AND no usable live curve
    // exists, there's nothing tent-shaped to render. Caller should
    // already be surfacing the warnings array; we render an empty
    // option object so ECharts shows axes without garbage data.
    const showFrozen = !frozenIsIntrinsic;

    const frozenData = showFrozen
      ? frozenCurve.points.map((p) => [p.spx, p.value])
      : [];
    const liveData = showLive
      ? liveCurve!.points.map((p) => [p.spx, p.value])
      : [];

    // Vertical-label stagger (#337): pre-#337 ALL labels (SPX / P-pole
    // / C-pole / BE@exp_low / BE@exp_high) anchored to the top of
    // their markLine ("end") with no vertical offset. When two
    // markLines sat close in X (e.g. SPX near a pole, or a tight
    // at-expiry BE near a strike on a low-cushion trade), the labels
    // collided into illegible mush.
    //
    // Three-tier top-anchored layout (vertical bands via padding,
    // measured top → down):
    //   tier 0 (offset  0px): Poles    — strike reference, dim
    //   tier 1 (offset 14px): SPX      — operator's "you are here", prominent
    //   tier 2 (offset 28px): BE@exp   — risk zones, muted
    // Padding moves the label box DOWN by N px from the line's
    // top endpoint without changing the line endpoint itself, so
    // X-collision in markLine geometry no longer implies overlap of
    // the label text boxes. The chart grid `top: 48` (both compact
    // and full modes — see grid config below) reserves the band
    // these labels occupy with ~8px headroom over tier 2's bottom
    // edge.
    type LabelPosition = "start" | "middle" | "end";
    type Padding = [number, number, number, number]; // [top, right, bottom, left]
    const TIER_POLE: Padding = [0, 0, 0, 0];
    const TIER_SPX: Padding = [14, 0, 0, 0];
    const TIER_BE: Padding = [28, 0, 0, 0];
    const verticals: Array<{
      xAxis: number;
      lineStyle: { color: string; type?: "solid" | "dashed" | "dotted"; width?: number };
      label: {
        formatter: string;
        color: string;
        position: LabelPosition;
        padding: Padding;
      };
    }> = [];

    // Poles — short strikes. Top band (tier 0).
    verticals.push({
      xAxis: frozenCurve.pole_low,
      lineStyle: { color: COLOR_POLE, width: 1, type: "dotted" },
      label: {
        formatter: `P${frozenCurve.pole_low.toFixed(0)}`,
        color: COLOR_POLE,
        position: "end",
        padding: TIER_POLE,
      },
    });
    verticals.push({
      xAxis: frozenCurve.pole_high,
      lineStyle: { color: COLOR_POLE, width: 1, type: "dotted" },
      label: {
        formatter: `C${frozenCurve.pole_high.toFixed(0)}`,
        color: COLOR_POLE,
        position: "end",
        padding: TIER_POLE,
      },
    });

    // Current SPX — only when broker_state sidecar gave us a value.
    // Tier 1: just below pole labels.
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
          position: "end",
          padding: TIER_SPX,
        },
      });
    }

    // Breakevens — the canonical DC breakevens are AT-EXPIRY: where
    // the at-expiry tent crosses entry_debit. Today's curve often has
    // 0 or 1 breakevens because mid-life the tent peaks haven't yet
    // grown past entry_debit (back-leg time premium hasn't decoupled
    // from front-leg yet). Operator-meaningful answer is "where do I
    // break even AT EXPIRY", which is what the at-expiry curve
    // computes. Prefer that; fall back to frozen/today's only when
    // at-expiry curve isn't loaded.
    const beSource = atExpiryCurve ?? frozenCurve;
    const beLabel = atExpiryCurve != null ? "BE@exp" : "BE";
    if (beSource.breakeven_low != null) {
      verticals.push({
        xAxis: beSource.breakeven_low,
        lineStyle: { color: COLOR_BREAKEVEN, width: 1, type: "dashed" },
        label: {
          formatter: `${beLabel} ${beSource.breakeven_low.toFixed(0)}`,
          color: COLOR_BREAKEVEN,
          position: "end",
          padding: TIER_BE,
        },
      });
    }
    if (beSource.breakeven_high != null) {
      verticals.push({
        xAxis: beSource.breakeven_high,
        lineStyle: { color: COLOR_BREAKEVEN, width: 1, type: "dashed" },
        label: {
          formatter: `${beLabel} ${beSource.breakeven_high.toFixed(0)}`,
          color: COLOR_BREAKEVEN,
          position: "end",
          padding: TIER_BE,
        },
      });
    }

    // MarkLine config (verticals + entry_debit horizontal) attaches
    // to whichever series renders first — frozen if present, else
    // live. Centralized so a frozen-suppressed render still gets
    // the breakeven verticals and entry_debit reference line.
    const markLineConfig = {
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
    };

    const series: Record<string, unknown>[] = [];

    if (showFrozen) {
      series.push({
        name: "Frozen IV (entry)",
        type: "line",
        data: frozenData,
        smooth: true,
        symbol: "none",
        // `itemStyle.color` drives the legend marker; without it
        // ECharts picks from a default palette so the legend dot
        // can mismatch the line color (operator reported a yellow
        // dot on a blue Live IV line, etc.). Force both to the
        // series' line color so legend == on-chart color always.
        itemStyle: { color: COLOR_FROZEN },
        lineStyle: { color: COLOR_FROZEN, width: 2 },
        areaStyle: { color: withAlpha(COLOR_FROZEN, 0.12) },
        markLine: markLineConfig,
      });
    }

    if (showLive) {
      // When frozen is suppressed (intrinsic-only legacy position),
      // live is the only curve in the chart — promote it from dashed
      // overlay to solid primary with area fill + the markLine.
      const livePromoted = !showFrozen;
      series.push({
        name: "Live IV",
        type: "line",
        data: liveData,
        smooth: true,
        symbol: "none",
        itemStyle: { color: COLOR_LIVE },
        lineStyle: {
          color: COLOR_LIVE,
          width: 2,
          ...(livePromoted ? {} : { type: "dashed" as const }),
        },
        ...(livePromoted
          ? {
              areaStyle: { color: withAlpha(COLOR_LIVE, 0.12) },
              markLine: markLineConfig,
            }
          : {}),
      });
    }

    // Evolution overlays — same IV source as live, advanced as_of.
    // Shows how the tent reshapes over time. The at-expiry curve is
    // the canonical "two tents" shape operators recognize from
    // OptionStrat-style time sliders. Dotted to read as "future
    // projection, not measured value". Rendered AFTER live so they
    // sit visually on top.
    const showHalfway =
      halfwayCurve != null &&
      halfwayCurve.iv_source === "latest" &&
      halfwayCurve.points.length > 0;
    const showAtExpiry =
      atExpiryCurve != null &&
      atExpiryCurve.iv_source === "latest" &&
      atExpiryCurve.points.length > 0;

    if (showHalfway) {
      series.push({
        name: "Halfway",
        type: "line",
        data: halfwayCurve!.points.map((p) => [p.spx, p.value]),
        smooth: true,
        symbol: "none",
        itemStyle: { color: COLOR_HALFWAY },
        lineStyle: { color: COLOR_HALFWAY, width: 1.5, type: "dotted" as const },
      });
    }
    if (showAtExpiry) {
      series.push({
        name: "At front expiry",
        type: "line",
        data: atExpiryCurve!.points.map((p) => [p.spx, p.value]),
        smooth: true,
        symbol: "none",
        itemStyle: { color: COLOR_AT_EXPIRY },
        lineStyle: { color: COLOR_AT_EXPIRY, width: 2, type: "dashed" as const },
      });
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: {
        left: compact ? 36 : 56,
        right: compact ? 16 : 32,
        // Top reserves the three-tier label band (Poles | SPX | BE@exp)
        // staggered via per-tier padding (#337). Tier offsets are
        // 0/14/28 px, plus ~12 px text height for the bottommost tier
        // = ~40 px needed. Both compact (small-multiples on the Tent
        // tab) and full mode get 48 px — at compact height=180 (per
        // DCTentTab), this trades ~5% of vertical data resolution for
        // labels that don't bleed into the data area. R1 flagged that
        // the previously-tighter 32 px in compact left BE@exp ~8 px
        // inside the plot area; harmless for tent shape but
        // distracting for an operator scanning the small-multiples
        // grid. Pre-#337 this was 16/32 with all labels stacked at
        // the same top position; operators reported collisions when
        // SPX sat near a pole.
        top: 48,
        // Bottom needs to clear: x-axis name "SPX" (~24px) + the
        // moved-from-top legend strip (~24px) + a little padding.
        // Compact mode: legend is hidden so revert to tight bottom.
        bottom: compact ? 28 : 64,
      },
      legend: compact
        ? { show: false }
        : {
            data: [
              ...(showFrozen ? ["Frozen IV (entry)"] : []),
              ...(showLive ? ["Live IV"] : []),
              ...(showHalfway ? ["Halfway"] : []),
              ...(showAtExpiry ? ["At front expiry"] : []),
            ],
            textStyle: { color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 11 },
            // Moved to bottom (was top: 4) — at the top it collided
            // with the markLine labels (BE@exp / P-strike / C-strike)
            // that anchor to the top of each vertical line. Bottom
            // placement is conventional for line charts with named
            // markers and never overlaps with annotation labels.
            bottom: 4,
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
      // SVG renderer (instead of canvas) so the chart stays crisp at
      // any browser zoom level. Canvas renderer bakes in the resolution
      // at mount time and goes blurry at zoom > 100% (operator-reported
      // at 170% zoom). SVG is resolution-independent. Marginal perf
      // cost on our ~170-point tent (negligible).
      opts={{ renderer: "svg" }}
    />
  );
}
