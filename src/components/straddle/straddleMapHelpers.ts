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
  // Use `String(s.strike)` rather than `.toFixed(0)` so fractional
  // strikes (e.g., 5180.5 from a future weekly SPX widening or SPY
  // chain) round-trip cleanly through the tooltip's `Number(label)`
  // lookup. The previous `.toFixed(0)` rendered 5180.5 as "5181",
  // which the tooltip parsed back to 5181 → no matching strike row →
  // silent empty tooltip. Integer SPX strikes are unaffected
  // (`String(5180) === "5180"`).
  const strikeCategories: string[] = sortedRows.map((s) => String(s.strike));

  // x-axis symmetric range: max(|net_oi|) across strikes, padded ~10%.
  let maxAbsNet = 0;
  for (const row of sortedRows) {
    const net = netOi(row.call_oi, row.put_oi);
    if (Math.abs(net) > maxAbsNet) maxAbsNet = Math.abs(net);
  }
  const xExtent = Math.max(1, Math.ceil(maxAbsNet * 1.1));

  // Single net-OI series. Each bar's value sign drives length (positive
  // right, negative left) and tint (blue / amber). Net fresh-flow glyph
  // is overlaid on bars whose |net flow| exceeds the threshold; glyph
  // color reflects the SIGN of net flow (green opening / red closing),
  // independent of which hemisphere the bar lives in.
  //
  // Under preview_mode (PR-A backend served the next-session rollover
  // snapshot), suppress the glyph entirely. The rollover row has no
  // valid baseline yet — tomorrow's EOD baseline is captured at
  // tomorrow's 16:14 ET — so the backend nulls out fresh_flow on every
  // strike. The frontend just respects that and skips the overlay.
  const previewMode = data.preview_mode === true;
  const netData = sortedRows.map((s) => {
    const net = netOi(s.call_oi, s.put_oi);
    const netFlow = previewMode
      ? 0
      : netFreshFlow(s.fresh_flow_call, s.fresh_flow_put);
    const glyph = previewMode ? "" : netFreshFlowGlyph(netFlow);
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

  // Spot + EM reference lines are NOT drawn as `markLine` entries
  // here (#321). ECharts 6.x's `OrdinalScale.parse` does
  // `Math.round(val)` on numeric input, so a `yAxis: <fractional
  // index>` on a CATEGORY axis snaps to the nearest integer band —
  // the line then renders ON a strike row instead of between two
  // strikes (verified against `node_modules/echarts/lib/scale/
  // Ordinal.js`). Operator was seeing spot/EM mis-aligned by up to
  // ±half a strike interval. Same bug class as #320 round-3 B1.
  //
  // The component overlays `graphic` line elements as a post-render
  // step using `chart.convertToPixel` for precise placement — see
  // `applyReferenceLines` in StraddleMapChart.tsx. The fractional
  // indices computed here are surfaced separately so the component
  // can interpolate pixel positions.

  const option: EChartsOption = {
    backgroundColor: "transparent",
    animation: false,
    grid: {
      // Sourced from STRADDLE_MAP_GRID so the component-side
      // applyReferenceLines stays in pixel-lockstep without
      // hardcoding the same numbers in two places (#321 R1+R2 nit).
      ...STRADDLE_MAP_GRID,
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
        // Color the NET flow value by sign so the operator can read
        // direction without parsing the +/- prefix. Three-way split
        // (positive / negative / tie → muted) mirrors the NET OI
        // header's tie treatment two lines above; intentionally
        // differs from the bar's ▲/▼ glyph helper which uses `>= 0`
        // (green wins ties) to keep glyphs binary on the bar.
        const flowColor =
          netFlow > 0
            ? colors.accentGreen
            : netFlow < 0
              ? colors.accentRed
              : colors.textMuted;
        // Spot proximity (#333): operationally relevant for "is this
        // strike near where the action is sitting right now?". Sign is
        // strike-relative-to-spot — positive = strike is above spot.
        // Null spot (cold-start) suppresses the line entirely.
        const spotProximityLine =
          data.spot == null
            ? ""
            : `<div style="margin-top:2px;color:${colors.textMuted};font-size:10px">` +
              `spot ${data.spot.toFixed(2)} · ` +
              `<span style="color:${colors.textPrimary}">strike ${strike >= data.spot ? "+" : ""}${(strike - data.spot).toFixed(2)}</span>` +
              `</div>`;
        // Within-EM badge — computed inline from the snapshot's
        // em_lower/em_upper bounds (StraddleStrikeRow doesn't carry a
        // per-row within_em flag; that lives on PinCandidate only).
        // Useful when scanning a wide chart: this strike's flow is
        // inside today's expected move, so it's more likely to matter
        // for the close. Hidden during cold-start (any EM null).
        //
        // Inclusive on both ends to match the snapshotter contract
        // ("[em_lower, em_upper]" per terminalTypes.PinCandidate
        // docstring at terminalTypes.ts:302).
        //
        // Styling deliberately mirrors PinCandidatesPanel's "EM" badge
        // (green-tinted background) so the operator sees the same
        // visual convention for the same concept across both panels
        // — flagged as a cross-panel consistency win in #333 review.
        const withinEm =
          data.em_lower != null &&
          data.em_upper != null &&
          strike >= data.em_lower &&
          strike <= data.em_upper;
        const emBadge = withinEm
          ? `<span style="margin-left:6px;padding:1px 5px;color:${colors.accentGreen};background:${withAlpha(colors.accentGreen, 0.09)};border:1px solid ${withAlpha(colors.accentGreen, 0.3)};border-radius:2px;font-size:9px;letter-spacing:0.06em">EM</span>`
          : "";
        // Under preview_mode, the tooltip omits the NET-flow value
        // and the per-side `flow N` field — same rationale as the
        // bar glyphs: no valid baseline, the backend nulls fresh-
        // flow on every strike, rendering "+0" would be misleading.
        const netLine = previewMode
          ? `<div style="margin-top:4px;color:${netColor}">NET OI ${net >= 0 ? "+" : ""}${net.toFixed(0)}</div>`
          : `<div style="margin-top:4px;color:${netColor}">NET OI ${net >= 0 ? "+" : ""}${net.toFixed(0)} · <span style="color:${flowColor}">NET flow ${netFlow >= 0 ? "+" : ""}${netFlow.toFixed(0)}</span></div>`;
        const callFlowField = previewMode
          ? ""
          : ` · flow ${fmt(row.fresh_flow_call)}`;
        const putFlowField = previewMode
          ? ""
          : ` · flow ${fmt(row.fresh_flow_put)}`;
        return [
          `<div style="font-weight:bold;color:${colors.textBright}">Strike ${strike.toFixed(0)}${emBadge}</div>`,
          spotProximityLine,
          netLine,
          `<div style="margin-top:4px;">`,
          `<span style="color:${colors.accentBlue}">CALL</span> `,
          `OI ${fmt(row.call_oi)} · Vol ${fmt(row.call_volume)} · `,
          `IV ${fmt(row.call_iv, 3)} · Δ ${fmt(row.call_delta, 2)}`,
          callFlowField,
          `</div>`,
          `<div>`,
          `<span style="color:${colors.accentAmber}">PUT </span> `,
          `OI ${fmt(row.put_oi)} · Vol ${fmt(row.put_volume)} · `,
          `IV ${fmt(row.put_iv, 3)} · Δ ${fmt(row.put_delta, 2)}`,
          putFlowField,
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
      // ECharts category yAxis default places data[0] at the BOTTOM
      // (axis index 0 = origin = bottom for cartesian2d). Our
      // `strikeCategories` is sorted DESCENDING (highest strike first),
      // so without `inverse: true` we'd render 7585 at the bottom and
      // 7405 at the top — the opposite of the operator's option-chain
      // mental model (calls/upside ABOVE the ATM line, puts/downside
      // BELOW). `inverse: true` flips the axis so data[0] sits at the
      // TOP, putting the highest strike there.
      inverse: true,
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
        // markLine intentionally absent — reference lines are drawn
        // as `graphic` overlays in StraddleMapChart's
        // `applyReferenceLines`, fed by `buildReferenceLineIndices`
        // (#321).
      },
    ],
  };

  return option;
}

/** Plot-area inset margins for the chart's `grid` config. Exported so
 *  `StraddleMapChart.applyReferenceLines` consumes the same numbers
 *  when computing pixel x-bounds for the spot/EM overlay lines —
 *  otherwise a future change to grid margins here would silently
 *  render the lines outside the data area (#321 R1+R2 nit 2). */
export const STRADDLE_MAP_GRID = { left: 60, right: 60, top: 36, bottom: 36 };

/** Fractional category indices for the spot + EM lines, computed
 *  off the strike list inside `buildStraddleMapOption`. Exposed for
 *  the component-side `applyReferenceLines` post-render step which
 *  converts these to pixel y-coords via `chart.convertToPixel`
 *  between integer indices (avoids the ECharts `OrdinalScale.parse`
 *  rounding bug — see #321). Returns null entries when the headline
 *  field is null (cold-start) so the caller skips that line. */
export interface ReferenceLineIndices {
  spot: number | null;
  emUpper: number | null;
  emLower: number | null;
}

export function buildReferenceLineIndices(
  data: StraddleChainResponse | null,
): ReferenceLineIndices {
  if (!data || data.strikes.length === 0) {
    return { spot: null, emUpper: null, emLower: null };
  }
  const sorted = [...data.strikes].sort((a, b) => b.strike - a.strike);
  const top = sorted[0].strike;
  const bottom = sorted[sorted.length - 1].strike;
  function idx(value: number | null): number | null {
    if (value == null || sorted.length === 0) return null;
    if (value >= top) return 0;
    if (value <= bottom) return sorted.length - 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const hi = sorted[i].strike;
      const lo = sorted[i + 1].strike;
      if (value <= hi && value >= lo) {
        const span = hi - lo;
        if (span === 0) return i;
        return i + (hi - value) / span;
      }
    }
    return null;
  }
  return {
    spot: idx(data.spot),
    emUpper: idx(data.em_upper),
    emLower: idx(data.em_lower),
  };
}
