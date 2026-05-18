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
const COLOR_AT_EXPIRY = colors.accentRed;   // at-expiry: canonical "two tents" shape


export function TentChart({
  frozenCurve,
  liveCurve,
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

    // Vertical-label stagger (#337 → #344). Pre-#337 ALL labels (SPX /
    // P-pole / C-pole / BE@exp_low / BE@exp_high) anchored to the top
    // of their markLine ("end") with no vertical offset. When two
    // markLines sat close in X (e.g. SPX near a pole, or a tight
    // at-expiry BE near a strike on a low-cushion trade), the labels
    // collided into illegible mush. #337 introduced a 3-tier stagger;
    // #344 reordered + widened the tiers because operators reported
    // the labels still read as a mush at 14px spacing.
    //
    // Three-tier layout, ordered VISUALLY from chart-edge upward:
    //   tier 0 (offset 36px): Poles    — closest to chart (dim, dotted)
    //   tier 1 (offset 18px): BE@exp   — middle row (muted, dashed)
    //   tier 2 (offset  0px): SPX      — top, furthest from chart (prominent)
    //
    // Padding moves the label box DOWN by N px from the line's top
    // endpoint (i.e. higher offset = closer to chart in screen coords).
    // 18px between tiers exceeds the ~14px default label text height
    // so adjacent tiers don't visually touch even when colors clash.
    // The chart grid `top: 56` (both compact and full modes — see
    // grid config below) reserves the band these labels occupy with
    // a small headroom over tier 0's bottom edge.
    type LabelPosition = "start" | "middle" | "end";
    type Padding = [number, number, number, number]; // [top, right, bottom, left]
    const TIER_SPX: Padding = [0, 0, 0, 0];
    const TIER_BE: Padding = [18, 0, 0, 0];
    const TIER_POLE: Padding = [36, 0, 0, 0];
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

    // Current SPX vertical. Render whenever the backend gave us a
    // non-null value, regardless of source. Backend sources are:
    //   - "index"             RTH SPX cash (most accurate)
    //   - "es_proxy"          ETH ES→SPX proxy with fresh basis
    //   - "es_proxy_stale"    ETH proxy w/ stale basis (12-72h old)
    //   - "fallback_midstrike" SpxProxy ran but produced nothing;
    //                         backend centered tent on strike midpoint
    // Pre-#338 we gated on `=== "broker_state"`, a literal string the
    // backend never actually produces — leftover from an early doc
    // draft. Result: SPX vertical never rendered, even during RTH.
    // Now: render unconditionally on non-null SPX; degraded sources
    // get a dashed line + parenthetical label so the operator can
    // distinguish authoritative SPX from a proxy.
    if (frozenCurve.current_spx != null) {
      const isDegraded =
        frozenCurve.current_spx_source === "es_proxy_stale" ||
        frozenCurve.current_spx_source === "fallback_midstrike";
      const sourceTag =
        frozenCurve.current_spx_source === "es_proxy"
          ? " (ES)"
          : frozenCurve.current_spx_source === "es_proxy_stale"
            ? " (ES~)"
            : frozenCurve.current_spx_source === "fallback_midstrike"
              ? " (est)"
              : ""; // "index" or unknown → no tag (authoritative)
      verticals.push({
        xAxis: frozenCurve.current_spx,
        lineStyle: {
          color: COLOR_SPX,
          width: 2,
          type: isDegraded ? "dashed" : "solid",
        },
        label: {
          formatter: `SPX ${frozenCurve.current_spx.toFixed(0)}${sourceTag}`,
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

    // Evolution overlay — same IV source as live, anchored at front
    // expiry. The at-expiry curve is the canonical "two tents" shape
    // operators recognize from OptionStrat-style time sliders. Dashed
    // to read as "future projection, not measured value". Rendered
    // AFTER live so it sits visually on top.
    //
    // (Halfway curve removed in #338 — convexity / exponential theta
    // decay made it visually collapse onto Today; precomputer cycles
    // continued for one tick post-deploy because the backend keeps
    // computing it until #339 lands, but the prop is no longer
    // consumed.)
    const showAtExpiry =
      atExpiryCurve != null &&
      atExpiryCurve.iv_source === "latest" &&
      atExpiryCurve.points.length > 0;

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
        // Top reserves the three-tier label band, visually ordered
        // SPX (top) → BE@exp → Poles (closest to chart). #344 widened
        // the tier spacing from 0/14/28 to 0/18/36 so adjacent tiers
        // don't visually touch even when colors clash (operators
        // reported the 14px spacing still read as a mush — see #344
        // discussion). Tier 0 (poles) occupies pixels 36-50; reserving
        // 56 leaves a small headroom buffer over the data area.
        // Same value for both compact and full modes — at compact
        // height=180 (per DCTentTab), this consumes ~31% of vertical
        // resolution but is the cost of three distinct readable rows.
        top: 56,
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
    // atExpiryCurve is read for BE label source + at-expiry series
    // (lines above). Pre-#338 the deps array missed it, so a lazy
    // atExpiryCurve fetch wouldn't re-run the memo and the BE labels
    // could render stale ("BE" instead of "BE@exp", stale x-coords).
    // Retro-QA B1.
  }, [frozenCurve, liveCurve, atExpiryCurve, compact]);

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
