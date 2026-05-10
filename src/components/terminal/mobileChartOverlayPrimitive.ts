/**
 * RectangleOverlayPrimitive — draws ETH session shading + Opening
 * Range bands directly onto the Lightweight Charts canvas via the
 * `ISeriesPrimitive` API.
 *
 * Why a primitive (not an HTML overlay): the chart redraws its
 * canvas synchronously on every pan/zoom/resize frame. Primitive
 * `paneViews()` are part of that render pipeline, so the rectangles
 * are computed and drawn IN THE SAME FRAME as the candles below.
 * No React reconciliation lag, no "float around" between the chart
 * and overlay layer (the symptom the user reported with the prior
 * absolutely-positioned-div approach).
 *
 * Coordinates are computed at draw time inside the renderer using
 * the live `chart.timeScale().timeToCoordinate()` and
 * `series.priceToCoordinate()` — guaranteed to match the canvas's
 * current viewport.
 */

import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

/** A rectangle spec in domain (time/price) coordinates. The primitive
 *  translates to pixels at draw time so the rect always snaps to the
 *  current viewport. */
export interface RectangleSpec {
  /** Stable id for React-key-equivalent tracking; not used by the
   *  primitive but useful for external bookkeeping. */
  id: string;
  /** Left edge in chart time. */
  timeFrom: UTCTimestamp;
  /** Right edge in chart time. `null` means "extend to plot's right
   *  edge" (used by OR bands that should run to the price scale). */
  timeTo: UTCTimestamp | null;
  /** Top edge in price units. `null` means "top of plot pane" (used
   *  by ETH shading, which spans full pane height). */
  priceTop: number | null;
  /** Bottom edge in price units. `null` means "bottom of plot pane"
   *  (minus the time-axis band). */
  priceBottom: number | null;
  /** Fill color (rgba string). */
  fill: string;
}

class RectangleRenderer implements IPrimitivePaneRenderer {
  private readonly rects: readonly RectangleSpec[];
  private readonly chart: IChartApi;
  private readonly series: ISeriesApi<SeriesType>;
  constructor(
    rects: readonly RectangleSpec[],
    chart: IChartApi,
    series: ISeriesApi<SeriesType>,
  ) {
    this.rects = rects;
    this.chart = chart;
    this.series = series;
  }

  /** drawBackground is called BEFORE the chart's gridlines + series
   *  are drawn — exactly what we want for "time-area highlighting"
   *  (per the API docs). Putting ETH/OR washes on the background
   *  layer lets gridlines and candles render on top, so the
   *  gridlines remain visible inside the shaded regions (user
   *  reported they were obscured when ETH was drawn via `draw`). */
  drawBackground(target: CanvasRenderingTarget2D): void {
    this.paint(target);
  }

  /** Required by the interface. Empty — all painting happens in
   *  `drawBackground` so washes sit underneath the chart's
   *  gridlines/candles. */
  draw(_target: CanvasRenderingTarget2D): void {
    // intentionally empty
  }

  private paint(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { width: paneW, height: paneH } = scope.mediaSize;
      // Lightweight Charts renders the primitive within the SERIES
      // PANE only — the pane's `mediaSize.height` already excludes
      // the time-axis band. So drawing to y = paneH extends to the
      // top of the time-axis labels (matches TradingView's ETH
      // shading convention). No manual time-axis-height subtraction
      // needed here (the prior 28px subtraction was a misunderstanding
      // of the coord space and left a visible gap at the bottom).

      for (const r of this.rects) {
        const xLeft = this.chart.timeScale().timeToCoordinate(r.timeFrom);
        if (xLeft == null) continue;
        const xRightRaw =
          r.timeTo != null
            ? this.chart.timeScale().timeToCoordinate(r.timeTo)
            : paneW;
        if (xRightRaw == null) continue;
        // Clip to pane.
        const left = Math.max(0, Math.min(xLeft, xRightRaw));
        const right = Math.min(paneW, Math.max(xLeft, xRightRaw));
        const width = right - left;
        if (width <= 0) continue;

        const yTopRaw =
          r.priceTop != null
            ? this.series.priceToCoordinate(r.priceTop)
            : 0;
        const yBottomRaw =
          r.priceBottom != null
            ? this.series.priceToCoordinate(r.priceBottom)
            : paneH;
        if (yTopRaw == null || yBottomRaw == null) continue;
        // Clip top/bottom to pane.
        const top = Math.max(0, Math.min(yTopRaw, yBottomRaw));
        const bottom = Math.min(paneH, Math.max(yTopRaw, yBottomRaw));
        const height = bottom - top;
        if (height <= 0) continue;

        ctx.fillStyle = r.fill;
        ctx.fillRect(left, top, width, height);
      }
    });
  }
}

class RectanglePaneView implements IPrimitivePaneView {
  private readonly rects: readonly RectangleSpec[];
  private readonly chart: IChartApi;
  private readonly series: ISeriesApi<SeriesType>;
  constructor(
    rects: readonly RectangleSpec[],
    chart: IChartApi,
    series: ISeriesApi<SeriesType>,
  ) {
    this.rects = rects;
    this.chart = chart;
    this.series = series;
  }

  zOrder(): "bottom" {
    // Draw BEHIND the candles + lines so the wash sits as
    // background, not on top of price action.
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer {
    return new RectangleRenderer(this.rects, this.chart, this.series);
  }
}

export class RectangleOverlayPrimitive
  implements ISeriesPrimitive<Time>
{
  private rects: readonly RectangleSpec[] = [];
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  // Cached pane-view array. Lightweight Charts caches by reference
  // identity — return the same array reference when nothing has
  // changed to avoid forcing redraws.
  private cachedPaneViews: IPrimitivePaneView[] | null = null;

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.cachedPaneViews = null;
  }

  /** Replace the rectangle set. Triggers a chart redraw via
   *  `requestUpdate`. The renderer recomputes pixel coords on the
   *  next frame — no manual coord recomputation needed here. */
  setRectangles(rects: readonly RectangleSpec[]): void {
    this.rects = rects;
    this.cachedPaneViews = null;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.chart || !this.series) return [];
    if (this.cachedPaneViews) return this.cachedPaneViews;
    this.cachedPaneViews = [
      new RectanglePaneView(this.rects, this.chart, this.series),
    ];
    return this.cachedPaneViews;
  }

  // ORH / ORL labels intentionally NOT rendered via priceAxisViews:
  // those use `ISeriesPrimitiveAxisView` which renders with a
  // different visual style than `series.createPriceLine`'s native
  // chips, so OR labels looked inconsistent next to POC / VAH /
  // PDH / etc and got cut off on the right edge. Mobile-side
  // ORH/ORL labels are now rendered as native priceLines from
  // MobileChartCanvas alongside the level chips — same code path,
  // same visual treatment. The primitive only does the rectangle
  // background.

  /** Lightweight Charts calls this on viewport change. We don't need
   *  to recompute anything here — the renderer reads live coords on
   *  every draw — but invalidating the cache is harmless and keeps
   *  the primitive responsive to chart-internal state changes. */
  updateAllViews(): void {
    // No cache invalidation: rects are domain-coordinate, the
    // renderer re-projects them every frame. Caching only matters
    // when the rect SET changes (handled in setRectangles).
  }
}
