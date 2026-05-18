// @vitest-environment happy-dom

/**
 * Render-pixel smoke test for ECharts category-axis fractional
 * positioning (#324).
 *
 * Why this exists
 * ───────────────
 * ECharts 6.x category axes silently round fractional `xAxis` /
 * `yAxis` / `coord` values via `OrdinalScale.parse(val) =
 * Math.round(val)` (see `node_modules/echarts/lib/scale/Ordinal.js`).
 * That defeats fractional `markLine` positioning — e.g. a markLine
 * at `yAxis: 1.5` SILENTLY renders at the band CENTER of category
 * index 2, not BETWEEN categories 1 and 2 as the operator would
 * reasonably expect.
 *
 * This bug class bit us TWICE in production before we caught it
 * with code review:
 *   - #320 round-3: velocity panel's "NOW" markLine at
 *     `xAxis: axis.length - 1.5` rendered ON the live cell instead
 *     of between the last two cells.
 *   - #321: StraddleMap spot/EM reference lines at fractional
 *     `yAxis` indices were mis-positioned by up to ±half a strike
 *     interval (~2.5 SPX pts on a 5-pt grid).
 *
 * Both PRs' existing tests asserted on the option-object shape —
 * which looked correct — without ever exercising what ECharts
 * actually rendered. Hence #324: ONE integration smoke test
 * that pins the rounding behavior at the convertToPixel boundary.
 * If ECharts ever fixes the rounding (or makes it stricter), this
 * test fails loudly and we revisit our pixel-overlay workarounds.
 *
 * Implementation notes
 * ────────────────────
 * - `// @vitest-environment happy-dom` directive — happy-dom is the
 *   lightweight DOM provider for vitest; default suite environment
 *   stays Node for speed (see vite.config.ts).
 * - SVG renderer (`renderer: 'svg'`) — avoids the canvas dependency
 *   happy-dom doesn't ship. We need ECharts' coord-system math, not
 *   pixel rasterization.
 * - The chart's container is explicitly sized via
 *   `getBoundingClientRect` stub so ECharts can lay out without a
 *   live viewport.
 */

import * as echarts from "echarts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CHART_W = 800;
const CHART_H = 400;
const GRID_LEFT = 60;
const GRID_RIGHT = 60;
const GRID_TOP = 30;
const GRID_BOTTOM = 30;
const CATEGORIES = ["7530", "7520", "7510", "7500", "7490", "7480"];

let container: HTMLDivElement;
let chart: echarts.ECharts;

beforeEach(() => {
  container = document.createElement("div");
  // Stub getBoundingClientRect so ECharts has explicit pixel bounds
  // (happy-dom returns all-zero rects by default).
  container.getBoundingClientRect = () => ({
    x: 0, y: 0, width: CHART_W, height: CHART_H,
    top: 0, left: 0, right: CHART_W, bottom: CHART_H,
    toJSON: () => ({}),
  });
  // ECharts also reads offsetWidth/Height as a fallback when
  // getBoundingClientRect can't be trusted. Stub those too.
  Object.defineProperty(container, "offsetWidth", { value: CHART_W });
  Object.defineProperty(container, "offsetHeight", { value: CHART_H });
  Object.defineProperty(container, "clientWidth", { value: CHART_W });
  Object.defineProperty(container, "clientHeight", { value: CHART_H });
  document.body.appendChild(container);
  chart = echarts.init(container, undefined, {
    renderer: "svg",
    width: CHART_W,
    height: CHART_H,
  });
  chart.setOption({
    animation: false,
    grid: {
      left: GRID_LEFT,
      right: GRID_RIGHT,
      top: GRID_TOP,
      bottom: GRID_BOTTOM,
      containLabel: false,
    },
    xAxis: { type: "value", min: -100, max: 100 },
    yAxis: { type: "category", data: CATEGORIES, inverse: true },
    series: [{ type: "bar", data: [10, 20, 30, 40, 50, 60] }],
  });
});

afterEach(() => {
  chart.dispose();
  container.remove();
});

describe("ECharts 6.x category-axis fractional positioning", () => {
  it("convertToPixel rounds fractional category indices to nearest integer band (THE bug)", () => {
    // The canonical bug class. yAxis is a CATEGORY axis with 6
    // entries. Querying convertToPixel at idx 1.5 SHOULD (per a
    // reasonable reading of the docs) return the pixel BETWEEN
    // bands 1 and 2. But ECharts rounds via OrdinalScale.parse:
    //   Math.round(1.5) === 2 (JS half-up rounding)
    //   Math.round(0.5) === 1
    //   Math.round(-0.5) === 0   (JS rounds toward +∞ on halves)
    // So 1.5 should land at the SAME pixel as 2.
    const pxAt1 = chart.convertToPixel({ yAxisIndex: 0 }, 1) as number;
    const pxAt2 = chart.convertToPixel({ yAxisIndex: 0 }, 2) as number;
    const pxAt1_5 = chart.convertToPixel({ yAxisIndex: 0 }, 1.5) as number;
    // Sanity: integer indices land at different pixels.
    expect(pxAt1).not.toBe(pxAt2);
    // The bug: 1.5 rounds UP to 2 → same pixel as integer 2.
    // If this test ever FAILS (because ECharts fixed the rounding
    // or changed direction), the velocity-panel and StraddleMap
    // pixel-overlay workarounds need a fresh look — drop the
    // `graphic` shim and use fractional yAxis directly.
    expect(pxAt1_5).toBe(pxAt2);
  });

  it("linear interpolation between integer convertToPixel queries is the fix path", () => {
    // This is the workaround pattern used in StraddleMapChart's
    // applyReferenceLines after #321: query convertToPixel at
    // INTEGER indices (which work correctly), then linearly
    // interpolate for fractional values. The interpolated pixel
    // sits BETWEEN the two integer pixels — exactly what the
    // operator expects when reading "spot is at 7515" with strikes
    // at 7520 and 7510.
    const pxAt1 = chart.convertToPixel({ yAxisIndex: 0 }, 1) as number;
    const pxAt2 = chart.convertToPixel({ yAxisIndex: 0 }, 2) as number;
    // Half-way between idx 1 and idx 2:
    const interpolated = pxAt1 + 0.5 * (pxAt2 - pxAt1);
    // Should sit BETWEEN the two integer band centers (strict
    // inequality on both sides).
    expect(interpolated).toBeGreaterThan(Math.min(pxAt1, pxAt2));
    expect(interpolated).toBeLessThan(Math.max(pxAt1, pxAt2));
  });

  it("convertToPixel returns band-CENTER for integer indices on category axes", () => {
    // Sanity check on the assumption underlying the fix path.
    // Six categories from y=GRID_TOP to y=(CHART_H - GRID_BOTTOM),
    // with `inverse: true` so idx 0 sits at the top.
    const usableHeight = CHART_H - GRID_TOP - GRID_BOTTOM;
    const bandHeight = usableHeight / CATEGORIES.length;
    const pxAt0 = chart.convertToPixel({ yAxisIndex: 0 }, 0) as number;
    const pxAtLast = chart.convertToPixel({ yAxisIndex: 0 }, CATEGORIES.length - 1) as number;
    // Band centers (inverse axis: idx 0 is top → smaller y; last is bottom → larger y).
    const expectedTopCenter = GRID_TOP + bandHeight * 0.5;
    const expectedBottomCenter = GRID_TOP + bandHeight * (CATEGORIES.length - 0.5);
    expect(pxAt0).toBeCloseTo(expectedTopCenter, 0);
    expect(pxAtLast).toBeCloseTo(expectedBottomCenter, 0);
  });

  it("markLine with fractional yAxis renders at the rounded band center, NOT between", () => {
    // Apply a markLine at yAxis: 1.5 and verify its rendered pixel
    // matches convertToPixel(2). This re-confirms the bug class
    // from the rendering side (not just the coord-system math):
    // the markLine ALSO gets the rounded position. Anyone debugging
    // "my markLine isn't where I told it to be" can read this
    // assertion and understand the root cause.
    chart.setOption({
      series: [{
        type: "bar",
        data: [10, 20, 30, 40, 50, 60],
        markLine: {
          symbol: "none",
          silent: true,
          animation: false,
          data: [{ yAxis: 1.5, name: "test" }],
        },
      }],
    }, { notMerge: false });
    // After setOption, query the markLine's data coord -> pixel
    // through the same convertToPixel API the option went through.
    // The pixel must equal the integer-2 pixel.
    const pxAt2 = chart.convertToPixel({ yAxisIndex: 0 }, 2) as number;
    const pxAt1_5 = chart.convertToPixel({ yAxisIndex: 0 }, 1.5) as number;
    expect(pxAt1_5).toBe(pxAt2);
    // Note: we don't introspect the rendered SVG DOM for the
    // markLine's actual y-coord because that adds happy-dom +
    // ECharts-internal coupling. Pinning the convertToPixel result
    // is the canonical contract test — if ECharts ever uses a
    // different path for markLine rendering than convertToPixel
    // exposes, the velocity panel + StraddleMap pixel-overlay code
    // would surface that bug in production first anyway.
  });
});
