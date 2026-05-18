/**
 * Reference-line overlay logic for the StraddleMap chart.
 *
 * Extracted from StraddleMapChart.tsx so it can be unit-tested
 * without triggering the react-refresh "only export components"
 * rule (and so the regression test for #351 doesn't have to import
 * the chart component).
 *
 * Two responsibilities:
 *   - `applyReferenceLines`: position the spot + EM upper/lower
 *     reference lines as ECharts `graphic` overlays in pixel space,
 *     bypassing the `OrdinalScale.parse` rounding bug for fractional
 *     category-axis values (#321).
 *   - Cache-key guard so the chart's `finished` event re-fires don't
 *     loop: identical graphic positions → no setOption call.
 *
 * The fix for #351 lives in the NaN-pixel / convertToPixel-throws
 * branch: previously the function proceeded with NaN coords, which
 * ECharts silently dropped — visible bug was "EM lines missing
 * despite valid backend data." Post-fix: bail without writing, wait
 * for the next `finished` event from the host component.
 */

import type { MutableRefObject } from "react";
import type * as echarts from "echarts";
import { colors, fonts } from "../../styles/tokens";
import type { StraddleChainResponse } from "../../api/terminalTypes";
import {
  buildReferenceLineIndices,
  STRADDLE_MAP_GRID,
} from "./straddleMapHelpers";

/** Safely wipe overlay graphics. `replaceMerge: ["graphic"]` is
 *  required — a bare `setOption({graphic: []})` is a no-op merge in
 *  ECharts 6.x for the `graphic` component. Try/catch guards against
 *  disposed-chart access (the 'finished' handler can fire mid-dispose
 *  during tab unmount). */
function clearGraphics(chart: echarts.ECharts): void {
  try {
    chart.setOption({ graphic: [] }, { replaceMerge: ["graphic"] });
  } catch {
    // chart disposed — no-op
  }
}

export function applyReferenceLines(
  chart: echarts.ECharts,
  data: StraddleChainResponse | null,
  lastAppliedRef: MutableRefObject<string>,
): void {
  const indices = buildReferenceLineIndices(data);
  if (!data || data.strikes.length === 0) {
    if (lastAppliedRef.current !== "") {
      clearGraphics(chart);
      lastAppliedRef.current = "";
    }
    return;
  }
  const N = data.strikes.length;
  if (N < 2) {
    // Need at least two strikes to interpolate. Single-strike case is
    // degenerate enough to just skip the reference lines.
    if (lastAppliedRef.current !== "") {
      clearGraphics(chart);
      lastAppliedRef.current = "";
    }
    return;
  }
  // Linear interpolation anchors: pixel y of strike index 0 (top) and
  // strike index N-1 (bottom). `convertToPixel` returns [x, y]; we
  // want the y.
  let yTopRaw: number | undefined;
  let yBotRaw: number | undefined;
  try {
    const t = chart.convertToPixel({ yAxisIndex: 0 }, 0);
    const b = chart.convertToPixel({ yAxisIndex: 0 }, N - 1);
    if (Array.isArray(t)) yTopRaw = (t as number[])[1];
    if (Array.isArray(b)) yBotRaw = (b as number[])[1];
  } catch {
    // convertToPixel can throw if the chart's component model is in a
    // partially-initialized OR disposed state (#347 hotfix comment).
    // The next 'finished' event will trigger another call.
  }
  if (
    yTopRaw === undefined ||
    yBotRaw === undefined ||
    !Number.isFinite(yTopRaw) ||
    !Number.isFinite(yBotRaw)
  ) {
    // Chart not laid out yet — convertToPixel returns [NaN, NaN] when
    // the model's been rebuilt by `notMerge: true` but the layout
    // pipeline hasn't run yet, or when the container has zero measured
    // size. Do nothing and wait for the next 'finished' event. The
    // pre-fix version wrote NaN-positioned graphics that ECharts
    // silently dropped — root cause of #351.
    return;
  }
  const yTop = yTopRaw;
  const yBot = yBotRaw;
  const width = chart.getWidth();
  const xLeft = STRADDLE_MAP_GRID.left;
  const xRight = width - STRADDLE_MAP_GRID.right;

  function pxForIndex(idx: number | null): number | null {
    if (idx == null) return null;
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
  // Cache key: serialize positions + label text + plot-area x-extent
  // rounded to 1px so a no-op re-render (same lines at same pixels)
  // doesn't trigger a setOption that would re-fire 'finished' →
  // infinite loop. Same pattern as TentChart's updateGraphic (#347).
  //
  // `W:${xRight}` is included because the line graphics' x1/x2 depend
  // on plot-area width: on a horizontal-only window resize, y-pixels
  // stay the same (height unchanged), and without W in the key the
  // cache would short-circuit, leaving stale lines that don't extend
  // to the new grid edge (R1 round-2 nit on #226).
  const key =
    `W:${Math.round(xRight)}|` +
    graphics
      .map((g) =>
        g.type === "line"
          ? `L:${Math.round(g.shape?.y1 ?? NaN)}`
          : `T:${(g.style?.text as string) ?? ""}@${Math.round(g.position?.[1] ?? NaN)}`,
      )
      .join("|");
  if (key === lastAppliedRef.current) return;
  lastAppliedRef.current = key;
  // `replaceMerge: ["graphic"]` ensures the resize path (which doesn't
  // do a notMerge setOption) replaces the previous frame's graphics
  // rather than merging on top. Try/catch protects against a chart
  // disposed in the same tick as a 'finished' event fire.
  try {
    chart.setOption({ graphic: graphics }, { replaceMerge: ["graphic"] });
  } catch {
    // chart disposed mid-tick — drop the cache so a future remount
    // re-applies cleanly.
    lastAppliedRef.current = "";
  }
}
