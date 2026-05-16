/**
 * Pure builder for the StraddleMapChart ECharts option object.
 *
 * Single-bar net-OI layout: each strike is represented by ONE bar whose
 * signed length is `call_oi - put_oi`. Positive values extend right
 * (call-dominant); negative values extend left (put-dominant). Bar
 * color follows the hemisphere convention shared with
 * `PinCandidatesPanel`: call-side → accentBlue, put-side → accentAmber.
 *
 * A net-fresh-flow glyph (▲/▼) is overlaid on bars whose
 * |fresh_flow_call - fresh_flow_put| exceeds the visibility threshold.
 * Green ▲ = net new openings, red ▼ = net closings — the glyphs map
 * sign of net flow, NOT side of the bar.
 *
 * Extracted from the React component so the markLine/series shape can
 * be pinned by tests without rendering a chart (echarts requires a DOM
 * canvas which happy-dom doesn't fully simulate).
 */

import type { EChartsOption } from "echarts";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import type { StraddleChainResponse } from "../../api/terminalTypes";

/** Bar fill alpha for the net-OI hemispheres. Matches the original
 *  two-bar version so the visual density of the chart is unchanged. */
export const NET_OI_ALPHA = 0.55;

/** Net fresh flow magnitude threshold (in contracts) below which the
 *  glyph is suppressed. Keeps the chart quiet during the first few
 *  minutes after the daily baseline trigger when fresh flow is small
 *  and noisy on both sides. */
export const NET_FRESH_FLOW_GLYPH_MIN = 50;

/** Compute net OI for a strike row, treating null sides as zero. */
export function netOi(call_oi: number | null, put_oi: number | null): number {
  return (call_oi ?? 0) - (put_oi ?? 0);
}

/** Compute net fresh flow for a strike row, treating null sides as zero.
 *  Positive = net openings, negative = net closings. */
export function netFreshFlow(
  fresh_flow_call: number | null,
  fresh_flow_put: number | null,
): number {
  return (fresh_flow_call ?? 0) - (fresh_flow_put ?? 0);
}

/** Map sign of net OI to a hemisphere tint. Call-dominant → blue, put-
 *  dominant → amber. Zero net falls back to a neutral muted tone so the
 *  bar remains visible (rare in practice — exact-tie strikes are
 *  uncommon at 5pt spacing). */
export function netOiTint(net: number): string {
  if (net > 0) return withAlpha(colors.accentBlue, NET_OI_ALPHA);
  if (net < 0) return withAlpha(colors.accentAmber, NET_OI_ALPHA);
  return withAlpha(colors.textMuted, NET_OI_ALPHA);
}

/** Map net fresh flow to a colorblind-friendly glyph. Net openings →
 *  ▲, net closings → ▼. Empty string when |net| is below the visibility
 *  threshold so the chart isn't peppered with noise glyphs. */
export function netFreshFlowGlyph(net: number): string {
  if (Math.abs(net) <= NET_FRESH_FLOW_GLYPH_MIN) return "";
  return net > 0 ? "▲" : "▼";
}

/** Build the ECharts option for the strike-map chart.
 *
 *  Returns null when there's nothing renderable yet — the React
 *  wrapper shows a "No 0DTE chain data yet" placeholder in that case.
 *  Cold-start (`stale=true` AND `spot===null`) also returns null
 *  because EM-band markLines can't be positioned without spot.
 */
export function buildStraddleMapOption(
  data: StraddleChainResponse | null,
): EChartsOption | null {
  if (!data || data.strikes.length === 0) return null;

  // Diverging horizontal bars require yAxis=category (strikes as
  // labels) + xAxis=value (net-OI signed magnitude). With value-value
  // axes ECharts renders bars VERTICALLY at the x-coordinate of value[0]
  // — the previous shape's bug. Category yAxis pins each bar to its
  // strike row, value xAxis lets the bar extend left (negative) or
  // right (positive) from the central x=0 baseline.
  //
  // Sort strikes descending so highest strike sits at the top of the
  // chart — matches how operators read option chains (calls above,
  // puts below the ATM spot line in the middle).
  const sortedRows = [...data.strikes].sort((a, b) => b.strike - a.strike);
  const strikeCategories: string[] = sortedRows.map((s) =>
    s.strike.toFixed(0),
  );

  // x-axis symmetric range: max(|net_oi|) across strikes, padded ~10%.
  let maxAbsNet = 0;
  for (const row of sortedRows) {
    const net = netOi(row.call_oi, row.put_oi);
    if (Math.abs(net) > maxAbsNet) maxAbsNet = Math.abs(net);
  }
  const xExtent = Math.max(1, Math.ceil(maxAbsNet * 1.1));

  // Helper: given a numeric strike, return its fractional category
  // index along the (descending) strike axis. Used to position the
  // spot / EM-band markLines between strikes when the value doesn't
  // line up with an exact strike row. Out-of-range values clamp to
  // the nearest edge; missing values return null (caller skips line).
  function categoryIndex(value: number | null): number | null {
    if (value == null) return null;
    if (sortedRows.length === 0) return null;
    // Strikes are sorted descending so index 0 = highest strike.
    // Walk down to find the first strike <= value, then interpolate.
    const topStrike = sortedRows[0].strike;
    const bottomStrike = sortedRows[sortedRows.length - 1].strike;
    if (value >= topStrike) return 0;
    if (value <= bottomStrike) return sortedRows.length - 1;
    for (let i = 0; i < sortedRows.length - 1; i++) {
      const hi = sortedRows[i].strike;
      const lo = sortedRows[i + 1].strike;
      if (value <= hi && value >= lo) {
        const span = hi - lo;
        if (span === 0) return i;
        // Descending order: index increases as strike decreases. So
        // a value at hi is index i; at lo is index i+1.
        const frac = (hi - value) / span;
        return i + frac;
      }
    }
    return null;
  }

  // Single net-OI series. Each bar's value sign drives length (positive
  // right, negative left) and tint (blue / amber). Net fresh-flow glyph
  // is overlaid on bars whose |net flow| exceeds the threshold; glyph
  // color reflects the SIGN of net flow (green opening / red closing),
  // independent of which hemisphere the bar lives in.
  const netData = sortedRows.map((s) => {
    const net = netOi(s.call_oi, s.put_oi);
    const netFlow = netFreshFlow(s.fresh_flow_call, s.fresh_flow_put);
    const glyph = netFreshFlowGlyph(netFlow);
    return {
      value: net,
      itemStyle: {
        color: netOiTint(net),
      },
      label: glyph
        ? {
            show: true,
            formatter: glyph,
            // Bars extend toward the dominant side; show the glyph on
            // the bar's interior tip so it tracks the bar end rather
            // than sitting off-canvas on the opposite side.
            position: net >= 0 ? ("insideRight" as const) : ("insideLeft" as const),
            // Defensive: `netFlow >= 0` rather than `> 0`. The label
            // is gated by `glyph` being non-empty above, which already
            // requires |netFlow| > NET_FRESH_FLOW_GLYPH_MIN, so the
            // exact-zero case can't actually render today. The `>= 0`
            // form survives any future relaxation of that threshold
            // without flipping zero-flow glyphs to red.
            color: netFlow >= 0 ? colors.accentGreen : colors.accentRed,
            fontFamily: fonts.mono,
            fontSize: 10,
            fontWeight: 700,
          }
        : { show: false },
    };
  });

  // markLine entries. Spec: dashed for em_upper/em_lower, solid for
  // spot. yAxis is now a category axis (strikes as labels), so we
  // position markLines by FRACTIONAL category index — letting ECharts
  // interpolate between strike rows when the value (e.g. spot=7501.24)
  // falls between two strikes. Each entry sets `yAxis` to the index;
  // the label still shows the underlying numeric value.
  const markLineData: Array<Record<string, unknown>> = [];
  const emUpperIdx = categoryIndex(data.em_upper);
  const emLowerIdx = categoryIndex(data.em_lower);
  const spotIdx = categoryIndex(data.spot);

  if (emUpperIdx != null && data.em_upper != null) {
    markLineData.push({
      yAxis: emUpperIdx,
      name: "em_upper",
      lineStyle: {
        type: "dashed",
        color: colors.accentAmber,
        width: 1.2,
      },
      label: {
        formatter: `EM+ ${data.em_upper.toFixed(0)}`,
        color: colors.accentAmber,
        fontFamily: fonts.mono,
        fontSize: 10,
        position: "insideEndTop",
      },
    });
  }
  if (emLowerIdx != null && data.em_lower != null) {
    markLineData.push({
      yAxis: emLowerIdx,
      name: "em_lower",
      lineStyle: {
        type: "dashed",
        color: colors.accentAmber,
        width: 1.2,
      },
      label: {
        formatter: `EM- ${data.em_lower.toFixed(0)}`,
        color: colors.accentAmber,
        fontFamily: fonts.mono,
        fontSize: 10,
        position: "insideEndBottom",
      },
    });
  }
  if (spotIdx != null && data.spot != null) {
    markLineData.push({
      yAxis: spotIdx,
      name: "spot",
      lineStyle: {
        type: "solid",
        color: colors.textBright,
        width: 1.6,
      },
      label: {
        formatter: `SPOT ${data.spot.toFixed(2)}`,
        color: colors.textBright,
        fontFamily: fonts.mono,
        fontSize: 11,
        fontWeight: "bold",
        position: "insideEndTop",
      },
    });
  }

  const option: EChartsOption = {
    backgroundColor: "transparent",
    animation: false,
    grid: {
      left: 60,
      right: 60,
      // Top padding leaves room for both the legend strip (overlaid in
      // the upper-left at y≈12) and the EM-band labels rendered at
      // `insideEndTop` near the plot's right edge.
      top: 36,
      bottom: 36,
      containLabel: false,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", label: { backgroundColor: colors.bgInset } },
      backgroundColor: colors.bgInset,
      borderColor: colors.borderDim,
      borderWidth: 1,
      textStyle: { color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 11 },
      formatter: (params: unknown) => {
        // ECharts passes an array on axis-trigger. With yAxis as
        // category, each entry's `axisValue` is the strike label
        // (string). We parse it back to numeric and look up the
        // original row to render per-side call+put detail — the
        // visual bar is net-OI, but operators still need both sides
        // to act on it.
        if (!Array.isArray(params) || params.length === 0) return "";
        const first = params[0] as { axisValue?: string | number };
        const axisLabel = first?.axisValue;
        const strikeNum = typeof axisLabel === "string" ? Number(axisLabel) : axisLabel;
        if (typeof strikeNum !== "number" || !Number.isFinite(strikeNum)) return "";
        const row = data.strikes.find((s) => s.strike === strikeNum);
        if (!row) return "";
        const strike = strikeNum;
        const fmt = (v: number | null, digits = 0): string =>
          v == null ? "—" : v.toFixed(digits);
        const net = netOi(row.call_oi, row.put_oi);
        const netFlow = netFreshFlow(row.fresh_flow_call, row.fresh_flow_put);
        // Match netOiTint's muted-neutral for exact-tie strikes
        // (net===0) so the tooltip header agrees with the bar color.
        const netColor = net > 0 ? colors.accentBlue : net < 0 ? colors.accentAmber : colors.textMuted;
        return [
          `<div style="font-weight:bold;color:${colors.textBright}">Strike ${strike.toFixed(0)}</div>`,
          `<div style="margin-top:4px;color:${netColor}">`,
          `NET OI ${net >= 0 ? "+" : ""}${net.toFixed(0)} · `,
          `NET flow ${netFlow >= 0 ? "+" : ""}${netFlow.toFixed(0)}`,
          `</div>`,
          `<div style="margin-top:4px;">`,
          `<span style="color:${colors.accentBlue}">CALL</span> `,
          `OI ${fmt(row.call_oi)} · Vol ${fmt(row.call_volume)} · `,
          `IV ${fmt(row.call_iv, 3)} · Δ ${fmt(row.call_delta, 2)} · `,
          `flow ${fmt(row.fresh_flow_call)}`,
          `</div>`,
          `<div>`,
          `<span style="color:${colors.accentAmber}">PUT </span> `,
          `OI ${fmt(row.put_oi)} · Vol ${fmt(row.put_volume)} · `,
          `IV ${fmt(row.put_iv, 3)} · Δ ${fmt(row.put_delta, 2)} · `,
          `flow ${fmt(row.fresh_flow_put)}`,
          `</div>`,
        ].join("");
      },
    },
    xAxis: {
      type: "value",
      min: -xExtent,
      max: xExtent,
      axisLabel: {
        // Show absolute contract count — direction is conveyed by the
        // bar's hemisphere (right=calls dominant, left=puts dominant).
        formatter: (v: number) => `${Math.abs(v).toFixed(0)}`,
        color: colors.textMuted,
        fontFamily: fonts.mono,
        fontSize: 10,
      },
      axisLine: { lineStyle: { color: colors.borderDim } },
      splitLine: { lineStyle: { color: withAlpha(colors.borderDim, 0.5) } },
    },
    yAxis: {
      // Category axis with strikes as labels lets the bar series extend
      // horizontally from the x=0 baseline. Each bar sits on its
      // strike's row; positive net values reach right, negative reach
      // left. This is the canonical ECharts diverging-bar pattern.
      type: "category",
      data: strikeCategories,
      // Reverse so the highest strike is at the TOP of the chart
      // (matches how operators read option chains, with calls/upside
      // strikes visually above the ATM line).
      inverse: false,
      axisLabel: {
        color: colors.textMuted,
        fontFamily: fonts.mono,
        fontSize: 10,
        // Thin out the labels on dense strike grids — every 5th tick
        // is enough at 5pt spacing, otherwise the axis gets cluttered.
        interval: Math.max(0, Math.floor(strikeCategories.length / 12)),
      },
      axisLine: { lineStyle: { color: colors.borderDim } },
      // Subtle horizontal gridlines on alternating rows would be too
      // busy; keep them off and let the bars + markLines carry the
      // visual rhythm.
      splitLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: "net_oi",
        type: "bar",
        data: netData,
        // Bars extend along the value-x axis from the x=0 baseline
        // (the center of the chart, where the category yAxis sits).
        // Bar thickness (height of each row) is auto-sized by ECharts
        // based on category count.
        barWidth: "70%",
        markLine: {
          symbol: "none",
          silent: true,
          data: markLineData as never,
        },
      },
    ],
  };

  return option;
}
