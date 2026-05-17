/**
 * StraddleMapChart — horizontal-bar diverging chart for the
 * `/straddle` page. Strikes on the vertical (category) y-axis, bars
 * emanating left/right from the central x=0 baseline (the y-axis
 * line itself).
 *
 * Layout (per spec):
 *   - x-axis is signed NET OI (call_oi - put_oi), symmetric range
 *     derived from `max(|net|)` padded ~10%. One bar per strike,
 *     extending RIGHT when calls dominate, LEFT when puts dominate.
 *   - y-axis is the strike price as a CATEGORY axis (strings), sorted
 *     descending with `inverse: true` so the highest strike sits at
 *     the TOP of the chart — matching how operators read option
 *     chains (calls/upside above, puts/downside below the ATM line).
 *   - Dashed yAxis `markLine`s at em_upper / em_lower; solid at spot.
 *     Positioned by fractional category index so they interpolate
 *     correctly when the value falls between two rendered strikes.
 *   - Bar color follows hemisphere convention: call-dominant
 *     (right) → accentBlue, put-dominant (left) → accentAmber.
 *   - Net fresh-flow glyph (▲ green opening / ▼ red closing) overlaid
 *     on bars whose |net fresh flow| exceeds a visibility threshold.
 *
 * Chart-lifecycle rules:
 *   - Init once with `[]` dep — the chart instance is held in a ref.
 *   - `setOption(...)` runs in a separate effect with `[data]` so a
 *     polling refresh just updates series; the chart isn't torn down.
 *   - `ResizeObserver` on the container calls `chart.resize()`.
 *   - On unmount we dispose the chart explicitly (echarts holds onto
 *     the canvas otherwise — memory leak in long-running terminals).
 */

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import type { StraddleChainResponse } from "../../api/terminalTypes";
import {
  buildReferenceLineIndices,
  buildStraddleMapOption,
} from "./straddleMapHelpers";

interface Props {
  data: StraddleChainResponse | null;
  height?: number;
}

export function StraddleMapChart({ data, height = 540 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // Hold the most recent data on a ref so the ResizeObserver callback
  // can re-apply reference lines after a resize without rebuilding
  // the whole option object.
  const dataRef = useRef<StraddleChainResponse | null>(null);

  // ── Init once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => {
      chart.resize();
      // Resize invalidates the grid pixel positions used to place
      // the spot/EM lines — recompute against the current data.
      applyReferenceLines(chart, dataRef.current);
    });
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // ── Re-bind options whenever data changes ────────────────────────
  const option = useMemo(() => buildStraddleMapOption(data), [data]);
  useEffect(() => {
    if (!chartRef.current || !option) return;
    // notMerge so removing a series (e.g. strikes shrink) actually
    // clears prior data; clearing on every setOption is overkill.
    chartRef.current.setOption(option, { notMerge: true });
    dataRef.current = data;
    applyReferenceLines(chartRef.current, data);
  }, [option, data]);

  const hasStrikes = !!data && data.strikes.length > 0;

  return (
    <div
      style={{
        position: "relative",
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: 8,
        height,
        width: "100%",
      }}
    >
      <StraddleMapLegend />
      <div
        ref={containerRef}
        role="img"
        aria-label={
          "Net open interest per strike. Bar right = calls dominant, " +
          "left = puts dominant. EM band drawn as dashed horizontal " +
          "lines. Triangle glyphs mark strikes with significant net " +
          "opening (up) or closing (down) flow."
        }
        style={{ width: "100%", height: "100%" }}
      />
      {!hasStrikes && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontFamily: fonts.sans,
            color: colors.textMuted,
            fontSize: 13,
            letterSpacing: "0.04em",
            background: withAlpha(colors.bgPanel, 0.7),
          }}
        >
          No 0DTE chain data yet
        </div>
      )}
    </div>
  );
}

/** Overlay the spot + EM reference lines using ECharts `graphic`
 *  elements positioned by computed pixel y-coordinates. This is the
 *  fix for #321 — `markLine` with a fractional `yAxis` on a
 *  category axis silently rounded to the nearest integer band via
 *  `OrdinalScale.parse`, which mis-aligned the operator's reference
 *  lines by up to ±half a strike interval.
 *
 *  Strategy: `chart.convertToPixel({yAxisIndex: 0}, integerIdx)`
 *  works correctly on category axes — it returns the band-CENTER
 *  pixel for an integer data index. We query two adjacent integer
 *  indices and linearly interpolate to get the pixel position for
 *  any fractional index. Then we draw a line via the `graphic`
 *  component, which lives in pixel-space and bypasses the data-axis
 *  pipeline entirely.
 *
 *  Called from:
 *    - the data-update effect, after every `setOption` call;
 *    - the ResizeObserver, after `chart.resize()` invalidates the
 *      previous grid layout.
 */
function applyReferenceLines(
  chart: echarts.ECharts,
  data: StraddleChainResponse | null,
): void {
  const indices = buildReferenceLineIndices(data);
  if (!data || data.strikes.length === 0) {
    // Clear any leftover graphic elements (e.g. when transitioning
    // from a live snapshot to cold-start).
    chart.setOption({ graphic: [] });
    return;
  }
  const N = data.strikes.length;
  if (N < 2) {
    // Need at least two strikes to interpolate. Single-strike case
    // is degenerate enough to just skip the reference lines.
    chart.setOption({ graphic: [] });
    return;
  }
  // Linear interpolation anchors: pixel y of strike index 0 (top)
  // and strike index N-1 (bottom). `convertToPixel` returns
  // [x, y]; we want the y.
  const topPx = chart.convertToPixel({ yAxisIndex: 0 }, 0);
  const botPx = chart.convertToPixel({ yAxisIndex: 0 }, N - 1);
  if (!Array.isArray(topPx) || !Array.isArray(botPx)) {
    // Chart not laid out yet — bail and the next setOption / resize
    // will retry.
    return;
  }
  const yTop = topPx[1];
  const yBot = botPx[1];
  // x-extent of the plot area: convertToPixel with x=0 gives the
  // axis baseline; we want the full grid width. Read the grid
  // bounds off the chart's coordinate system option instead — they
  // were set as fixed pixel margins (`left: 60, right: 60`) in
  // buildStraddleMapOption.
  const width = chart.getWidth();
  const xLeft = 60;
  const xRight = width - 60;

  function pxForIndex(idx: number | null): number | null {
    if (idx == null) return null;
    if (N === 1) return yTop;
    const frac = idx / (N - 1);
    return yTop + frac * (yBot - yTop);
  }

  type GraphicEl = {
    type: "line" | "text";
    z?: number;
    silent?: boolean;
    shape?: { x1: number; y1: number; x2: number; y2: number };
    style?: Record<string, unknown>;
    position?: [number, number];
  };
  const graphics: GraphicEl[] = [];
  function pushLine(
    y: number,
    cls: "em-upper" | "em-lower" | "spot",
    labelText: string,
  ) {
    const isSpot = cls === "spot";
    graphics.push({
      type: "line",
      z: 50,
      silent: true,
      shape: { x1: xLeft, y1: y, x2: xRight, y2: y },
      style: {
        stroke: isSpot ? colors.textBright : colors.accentAmber,
        lineWidth: isSpot ? 1.6 : 1.2,
        lineDash: isSpot ? undefined : [4, 3],
      },
    });
    graphics.push({
      type: "text",
      z: 51,
      silent: true,
      position: [xRight - 6, y + (cls === "em-lower" ? 4 : -14)],
      style: {
        text: labelText,
        fill: isSpot ? colors.textBright : colors.accentAmber,
        font: `${isSpot ? "bold " : ""}${isSpot ? 11 : 10}px ${fonts.mono}`,
        textAlign: "right",
      },
    });
  }

  const yUp = pxForIndex(indices.emUpper);
  const yLow = pxForIndex(indices.emLower);
  const ySpot = pxForIndex(indices.spot);
  if (yUp != null && data.em_upper != null) {
    pushLine(yUp, "em-upper", `EM+ ${data.em_upper.toFixed(0)}`);
  }
  if (yLow != null && data.em_lower != null) {
    pushLine(yLow, "em-lower", `EM- ${data.em_lower.toFixed(0)}`);
  }
  if (ySpot != null && data.spot != null) {
    pushLine(ySpot, "spot", `SPOT ${data.spot.toFixed(2)}`);
  }
  // `replaceMerge: ["graphic"]` so a shrinking strike set or cold-
  // start path correctly clears stale lines instead of layering.
  chart.setOption(
    { graphic: graphics },
    { replaceMerge: ["graphic"] },
  );
}

/** Compact single-row legend overlaid in the chart's top-left corner.
 *  Covers the four symbols the chart uses under the single-bar net-OI
 *  layout:
 *    - Calls dominant (blue square) — bar extends right
 *    - Puts dominant (amber square) — bar extends left
 *    - Net opening flow (▲ green glyph)
 *    - Net closing flow (▼ red glyph)
 *  Positioned absolutely so it doesn't push the chart canvas down. */
function StraddleMapLegend() {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 14,
        zIndex: 2,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        fontFamily: fonts.sans,
        fontSize: 10,
        letterSpacing: "0.04em",
        color: colors.textSecondary,
        pointerEvents: "none",
      }}
    >
      <LegendSwatch
        color={withAlpha(colors.accentBlue, 0.55)}
        label="Calls dominant"
      />
      <LegendSwatch
        color={withAlpha(colors.accentAmber, 0.55)}
        label="Puts dominant"
      />
      <LegendGlyph
        glyph="▲"
        color={colors.accentGreen}
        label="Net opening flow"
      />
      <LegendGlyph
        glyph="▼"
        color={withAlpha(colors.accentRed, 0.85)}
        label="Net closing flow"
      />
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          background: color,
          borderRadius: 2,
        }}
      />
      <span>{label}</span>
    </span>
  );
}

function LegendGlyph({
  glyph,
  color,
  label,
}: {
  glyph: string;
  color: string;
  label: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color,
          lineHeight: 1,
        }}
        aria-hidden
      >
        {glyph}
      </span>
      <span>{label}</span>
    </span>
  );
}

