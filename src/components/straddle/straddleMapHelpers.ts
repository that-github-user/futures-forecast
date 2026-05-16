/**
 * Pure builder for the StraddleMapChart ECharts option object.
 *
 * Extracted from the React component so the markLine/series shape can
 * be pinned by tests without rendering a chart (echarts requires a DOM
 * canvas which happy-dom doesn't fully simulate). Tests assert that
 * the option has the expected markLines (em_upper / em_lower / spot)
 * and that call/put series carry their respective signed OI data.
 */

import type { EChartsOption } from "echarts";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import type { StraddleChainResponse } from "../../api/terminalTypes";

/** Alpha applied to BOTH opening (green) and closing (red) fresh-flow
 *  tints. Keeping these symmetric (rather than saturated-vs-alpha)
 *  prevents the chart from over-emphasizing opening flow at the
 *  expense of closing flow — both signals are equally informative. */
export const FRESH_FLOW_ALPHA = 0.55;

/** Map a strike's fresh-flow value to a bar color tint.
 *
 *  - Positive flow (new contracts opened today) → alpha-blended green
 *    — indicates new participants taking exposure at that strike.
 *  - Negative flow (contracts closed) → alpha-blended red — positions
 *    are being unwound.
 *  - Null / zero → neutral base color. The bar is still rendered so
 *    the static OI distribution remains visible.
 *
 *  Returned color is layered onto a soft border-dim background bar
 *  per side so the chart still reads visually when fresh-flow is
 *  null across the board (common in the first minutes after the
 *  daily baseline trigger).
 */
export function freshFlowTint(
  freshFlow: number | null,
  base: string,
): string {
  if (freshFlow == null) return base;
  if (freshFlow > 0) return withAlpha(colors.accentGreen, FRESH_FLOW_ALPHA);
  if (freshFlow < 0) return withAlpha(colors.accentRed, FRESH_FLOW_ALPHA);
  return base;
}

/** Map a strike's fresh-flow value to a colorblind-friendly glyph.
 *  Opening flow → ▲ (up triangle), closing → ▼ (down triangle),
 *  null/zero → empty string (no label). Used as the bar's label
 *  formatter so the cue surfaces in addition to the color tint. */
export function freshFlowGlyph(freshFlow: number | null): string {
  if (freshFlow == null || freshFlow === 0) return "";
  return freshFlow > 0 ? "▲" : "▼";
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

  // x-axis symmetric range: max(call_oi, put_oi).
  let maxOi = 0;
  for (const row of data.strikes) {
    if (row.call_oi != null) maxOi = Math.max(maxOi, row.call_oi);
    if (row.put_oi != null) maxOi = Math.max(maxOi, row.put_oi);
  }
  const xExtent = Math.max(1, Math.ceil(maxOi * 1.05));

  // Call series — positive x, color tinted by fresh_flow_call.
  // Each bar carries a per-point label glyph (▲ open / ▼ close) so
  // colorblind operators (and screen-readers) get the fresh-flow
  // signal independent of hue.
  const callData = data.strikes.map((s) => {
    const glyph = freshFlowGlyph(s.fresh_flow_call);
    return {
      value: [s.call_oi ?? 0, s.strike],
      itemStyle: {
        color: freshFlowTint(s.fresh_flow_call, withAlpha(colors.accentBlue, 0.55)),
      },
      label: glyph
        ? {
            show: true,
            formatter: glyph,
            position: "insideRight" as const,
            color:
              s.fresh_flow_call! > 0 ? colors.accentGreen : colors.accentRed,
            fontFamily: fonts.mono,
            fontSize: 10,
            fontWeight: 700,
          }
        : { show: false },
    };
  });

  // Put series — negative x, color tinted by fresh_flow_put.
  const putData = data.strikes.map((s) => {
    const glyph = freshFlowGlyph(s.fresh_flow_put);
    return {
      value: [-(s.put_oi ?? 0), s.strike],
      itemStyle: {
        color: freshFlowTint(s.fresh_flow_put, withAlpha(colors.accentAmber, 0.55)),
      },
      label: glyph
        ? {
            show: true,
            formatter: glyph,
            // Put-side bars extend leftward (negative x), so the
            // glyph sits on the inside-left edge to read alongside
            // the bar tip rather than off-canvas.
            position: "insideLeft" as const,
            color:
              s.fresh_flow_put! > 0 ? colors.accentGreen : colors.accentRed,
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
        // sides' microstructure in the tooltip body.
        if (!Array.isArray(params) || params.length === 0) return "";
        const first = params[0] as { data?: { value?: [number, number] } };
        const strike = first?.data?.value?.[1];
        if (typeof strike !== "number") return "";
        const row = data.strikes.find((s) => s.strike === strike);
        if (!row) return "";
        const fmt = (v: number | null, digits = 0): string =>
          v == null ? "—" : v.toFixed(digits);
        return [
          `<div style="font-weight:bold;color:${colors.textBright}">Strike ${strike.toFixed(0)}</div>`,
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
        name: "calls",
        type: "bar",
        data: callData,
        barWidth: "70%",
        // markLine on the first series so the lines render with the
        // chart's axes. Multiple-series markLines stack; one is enough.
        markLine: {
          symbol: "none",
          silent: true,
          data: markLineData as never,
        },
      },
      {
        name: "puts",
        type: "bar",
        data: putData,
        barWidth: "70%",
      },
    ],
  };

  return option;
}
