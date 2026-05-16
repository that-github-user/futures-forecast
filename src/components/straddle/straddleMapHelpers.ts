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

  // Strike-axis bounds: derive from rendered strikes but extend to fit
  // EM band + spot (so dashed markLines never sit off-canvas).
  const strikeValues = data.strikes.map((s) => s.strike);
  let yMin = Math.min(...strikeValues);
  let yMax = Math.max(...strikeValues);
  if (data.em_lower != null) yMin = Math.min(yMin, data.em_lower);
  if (data.em_upper != null) yMax = Math.max(yMax, data.em_upper);
  if (data.spot != null) {
    yMin = Math.min(yMin, data.spot);
    yMax = Math.max(yMax, data.spot);
  }
  // Pad y-axis by 5 strike-units so EM dashed lines aren't flush with
  // the chart edge — operators expect a small visual gutter.
  const padding = 5;
  yMin = Math.floor(yMin - padding);
  yMax = Math.ceil(yMax + padding);

  // x-axis symmetric range: max(|net_oi|) across strikes, padded ~10%.
  let maxAbsNet = 0;
  for (const row of data.strikes) {
    const net = netOi(row.call_oi, row.put_oi);
    if (Math.abs(net) > maxAbsNet) maxAbsNet = Math.abs(net);
  }
  const xExtent = Math.max(1, Math.ceil(maxAbsNet * 1.1));

  // Single net-OI series. Bar value sign drives both length (positive
  // right, negative left) and tint (blue / amber). Net fresh-flow glyph
  // is overlaid on bars whose |net flow| exceeds the threshold; glyph
  // color reflects the SIGN of net flow (green opening / red closing),
  // independent of which hemisphere the bar lives in.
  const netData = data.strikes.map((s) => {
    const net = netOi(s.call_oi, s.put_oi);
    const netFlow = netFreshFlow(s.fresh_flow_call, s.fresh_flow_put);
    const glyph = netFreshFlowGlyph(netFlow);
    return {
      value: [net, s.strike],
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
  // spot. yAxis-anchored so they span horizontally across the plot.
  const markLineData: Array<Record<string, unknown>> = [];
  if (data.em_upper != null) {
    markLineData.push({
      yAxis: data.em_upper,
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
  if (data.em_lower != null) {
    markLineData.push({
      yAxis: data.em_lower,
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
  if (data.spot != null) {
    markLineData.push({
      yAxis: data.spot,
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
        // ECharts passes an array on axis-trigger. Each entry holds
        // `data.value = [x, strike]`. We use the strike from the
        // first entry and look up the original row to render both
        // sides' microstructure in the tooltip body — the visual
        // bar is net-OI, but operators still need to see the
        // per-side call/put detail to act on it.
        if (!Array.isArray(params) || params.length === 0) return "";
        const first = params[0] as { data?: { value?: [number, number] } };
        const strike = first?.data?.value?.[1];
        if (typeof strike !== "number") return "";
        const row = data.strikes.find((s) => s.strike === strike);
        if (!row) return "";
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
        formatter: (v: number) => `${Math.abs(v).toFixed(0)}`,
        color: colors.textMuted,
        fontFamily: fonts.mono,
        fontSize: 10,
      },
      axisLine: { lineStyle: { color: colors.borderDim } },
      splitLine: { lineStyle: { color: withAlpha(colors.borderDim, 0.5) } },
    },
    yAxis: {
      type: "value",
      min: yMin,
      max: yMax,
      axisLabel: {
        formatter: (v: number) => `${v.toFixed(0)}`,
        color: colors.textMuted,
        fontFamily: fonts.mono,
        fontSize: 10,
      },
      axisLine: { lineStyle: { color: colors.borderDim } },
      splitLine: { show: false },
    },
    series: [
      {
        name: "net_oi",
        type: "bar",
        data: netData,
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
