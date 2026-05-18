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

import { useEffect, useMemo, useRef } from "react";
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

// Tier Y positions (px from chart top) for the graphic-overlay labels
// (#347). Matches the grid `top: 60` reservation: 8 + 18 (= 26) + 18
// (= 44) keeps adjacent tiers 18px apart and the bottommost tier
// ~16px clear of the data area. Module-scoped so the values aren't
// re-allocated on every render.
const TIER_Y: Record<"spx" | "be" | "pole", number> = {
  spx: 8,
  be: 26,
  pole: 44,
};


export function TentChart({
  frozenCurve,
  liveCurve,
  atExpiryCurve = null,
  height = 340,
  compact = false,
}: TentChartProps) {
  const memo = useMemo(() => {
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

    // #347: ECharts `markLine.label.padding` is CSS-internal padding
    // (whitespace within the label box), NOT an anchor offset — so the
    // padding-based "tier stagger" attempted in #337/#344 didn't
    // actually move labels vertically. They all rendered at the same Y
    // (the line's top endpoint), just inside differently-sized boxes.
    //
    // Real fix: strip the labels off the markLine entirely (lines only)
    // and render label text via a `graphic` overlay with pixel-exact
    // positions. See the post-render useEffect below that calls
    // `chart.convertToPixel` to map data-X → pixel-X and writes the
    // graphic elements onto the chart.
    //
    // Three-tier layout, top-to-bottom (Y in pixels from chart top):
    //   tier 'spx'  Y =  8: SPX     — top, furthest from chart
    //   tier 'be'   Y = 26: BE@exp  — middle row
    //   tier 'pole' Y = 44: Poles   — closest to chart
    //
    // The `verticals` list still feeds markLine.data (for the LINES),
    // but each entry has `label: { show: false }` so ECharts doesn't
    // draw any text. Parallel `verticalLabels` carries the text data
    // for the graphic overlay.
    type Vertical = {
      xAxis: number;
      lineStyle: { color: string; type?: "solid" | "dashed" | "dotted"; width?: number };
      label: { show: false };
    };
    type VerticalLabel = {
      xValue: number;
      tier: "spx" | "be" | "pole";
      text: string;
      color: string;
    };
    const verticals: Vertical[] = [];
    const verticalLabels: VerticalLabel[] = [];

    // Poles — short strikes.
    verticals.push({
      xAxis: frozenCurve.pole_low,
      lineStyle: { color: COLOR_POLE, width: 1, type: "dotted" },
      label: { show: false },
    });
    verticalLabels.push({
      xValue: frozenCurve.pole_low,
      tier: "pole",
      text: `P${frozenCurve.pole_low.toFixed(0)}`,
      color: COLOR_POLE,
    });
    verticals.push({
      xAxis: frozenCurve.pole_high,
      lineStyle: { color: COLOR_POLE, width: 1, type: "dotted" },
      label: { show: false },
    });
    verticalLabels.push({
      xValue: frozenCurve.pole_high,
      tier: "pole",
      text: `C${frozenCurve.pole_high.toFixed(0)}`,
      color: COLOR_POLE,
    });

    // Current SPX vertical. Render whenever the backend gave us a
    // non-null value, regardless of source. Backend sources are:
    //   - "index"             RTH SPX cash (most accurate)
    //   - "es_proxy"          ETH ES→SPX proxy with fresh basis
    //   - "es_proxy_stale"    ETH proxy w/ stale basis (12-72h old)
    //   - "fallback_midstrike" SpxProxy ran but produced nothing;
    //                         backend centered tent on strike midpoint
    // Pre-#338 we gated on `=== "broker_state"`, a literal string the
    // backend never actually produces. Now: render unconditionally on
    // non-null SPX; degraded sources get a dashed line + parenthetical
    // label tag so the operator can distinguish authoritative SPX
    // from a proxy.
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
        label: { show: false },
      });
      verticalLabels.push({
        xValue: frozenCurve.current_spx,
        tier: "spx",
        text: `SPX ${frozenCurve.current_spx.toFixed(0)}${sourceTag}`,
        color: COLOR_SPX,
      });
    }

    // Breakevens — at-expiry preferred; fall back to frozen/today's
    // breakeven solver result when the at-expiry curve isn't loaded.
    const beSource = atExpiryCurve ?? frozenCurve;
    const beLabel = atExpiryCurve != null ? "BE@exp" : "BE";
    if (beSource.breakeven_low != null) {
      verticals.push({
        xAxis: beSource.breakeven_low,
        lineStyle: { color: COLOR_BREAKEVEN, width: 1, type: "dashed" },
        label: { show: false },
      });
      verticalLabels.push({
        xValue: beSource.breakeven_low,
        tier: "be",
        text: `${beLabel} ${beSource.breakeven_low.toFixed(0)}`,
        color: COLOR_BREAKEVEN,
      });
    }
    if (beSource.breakeven_high != null) {
      verticals.push({
        xAxis: beSource.breakeven_high,
        lineStyle: { color: COLOR_BREAKEVEN, width: 1, type: "dashed" },
        label: { show: false },
      });
      verticalLabels.push({
        xValue: beSource.breakeven_high,
        tier: "be",
        text: `${beLabel} ${beSource.breakeven_high.toFixed(0)}`,
        color: COLOR_BREAKEVEN,
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

    const result = {
      backgroundColor: "transparent",
      animation: false,
      grid: {
        left: compact ? 36 : 56,
        right: compact ? 16 : 32,
        // Top reserves the three-tier label band populated by the
        // graphic overlay (#347). Tier Y positions in pixels:
        //   SPX:    Y =  8
        //   BE@exp: Y = 26
        //   Poles:  Y = 44
        // With default echarts 12px font + ~14px line-height, the
        // poles tier extends from Y=44 to Y=58. Reserving 60 gives
        // a small headroom buffer over the data area. Same value
        // for both compact and full modes — at compact height=180
        // (per DCTentTab), this consumes ~33% of vertical resolution
        // but is the cost of three distinct readable rows.
        top: 60,
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
    return { option: result, labels: verticalLabels };
  }, [frozenCurve, liveCurve, atExpiryCurve, compact]);

  // Post-render graphic overlay positioning (#347). markLine labels
  // can't be staggered via padding (CSS-internal, not anchor offset),
  // so we draw labels as `graphic.text` elements with pixel-exact
  // positions computed from `chart.convertToPixel`. Re-positions on
  // every render-finished event so resize / data-update / tab-switch
  // (which all change the xAxis pixel mapping) stay correct.
  const chartRef = useRef<ReactECharts | null>(null);
  // Cache key of last-applied graphic state — labels content + their
  // resolved pixel positions joined into a single string. The
  // `'finished'` event fires asynchronously after each render, so
  // an `updating` flag can't guard against async re-entry: setOption
  // would render → fire 'finished' → handler runs again → setOption →
  // hot loop. The cache key breaks the loop: if the labels haven't
  // moved (same content + same pixels), skip the setOption entirely.
  // QA OBS-1 fix.
  const lastAppliedRef = useRef<string>("");
  const labels = memo?.labels;
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance();
    if (!inst) return;

    const updateGraphic = () => {
      const graphics = (labels ?? [])
        .map((lbl) => {
          const px = inst.convertToPixel({ xAxisIndex: 0 }, lbl.xValue);
          if (px == null || !Number.isFinite(px)) return null;
          return {
            type: "text" as const,
            x: px,
            y: TIER_Y[lbl.tier],
            silent: true,
            z: 100,
            style: {
              text: lbl.text,
              fill: lbl.color,
              font: `11px ${fonts.mono}`,
              // EC5 canonical alignment names (NOT textAlign /
              // textVerticalAlign — those are EC4 legacy aliases
              // that work today via runtime shim but could be
              // dropped in a future ECharts major).
              align: "center" as const,
              verticalAlign: "top" as const,
            },
          };
        })
        .filter((g): g is NonNullable<typeof g> => g != null);
      // Cache key: serialize the load-bearing fields so a no-op render
      // (same labels at same pixels) doesn't trigger a setOption that
      // would re-fire 'finished' → infinite loop. Position rounded to
      // 1px because sub-pixel jitter from convertToPixel isn't worth
      // re-rendering.
      const key = graphics
        .map((g) => `${g.style.text}@${Math.round(g.x)},${g.y}:${g.style.fill}`)
        .join("|");
      if (key === lastAppliedRef.current) return;
      lastAppliedRef.current = key;
      inst.setOption(
        { graphic: graphics },
        { replaceMerge: ["graphic"] },
      );
    };

    updateGraphic();
    inst.on("finished", updateGraphic);
    return () => {
      inst.off("finished", updateGraphic);
      // QA OBS-3: explicit clear on unmount-or-empty so stale graphic
      // elements can't linger if labels become [] between renders.
      // lastAppliedRef is component-scoped so it resets on remount.
      lastAppliedRef.current = "";
    };
  }, [labels]);

  if (memo == null) {
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
      ref={chartRef}
      option={memo.option}
      style={{ height, width: "100%" }}
      // replaceMerge['series'] (was: notMerge) — wipe stale series
      // on data refresh (the original reason for notMerge: prevent
      // the dropped halfway series from lingering when curves
      // change) WITHOUT wiping the graphic overlay. Pre-#347 fix:
      // `notMerge: true` wiped the graphic on every parent
      // re-render → the 'finished' handler re-injected it on the
      // next frame, producing a 1-frame label flicker at 30s poll
      // cadence. Switching to selective replaceMerge preserves
      // graphic across re-renders.
      replaceMerge={["series"]}
      // SVG renderer (instead of canvas) so the chart stays crisp at
      // any browser zoom level. Canvas renderer bakes in the resolution
      // at mount time and goes blurry at zoom > 100% (operator-reported
      // at 170% zoom). SVG is resolution-independent. Marginal perf
      // cost on our ~170-point tent (negligible).
      opts={{ renderer: "svg" }}
    />
  );
}
