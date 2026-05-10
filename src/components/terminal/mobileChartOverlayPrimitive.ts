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
  ISeriesPrimitiveAxisView,
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
  /** Optional ORH/ORL axis labels — "ORH 5912.50" etc. */
  priceLabels?: PriceAxisLabelSpec[];
}

export interface PriceAxisLabelSpec {
  /** Price coordinate where the label anchors. */
  price: number;
  text: string;
  textColor: string;
  backColor: string;
}

/** Time-axis band height — Lightweight Charts reserves ~28px at the
 *  bottom of the pane for time labels. ETH shading should NOT bleed
 *  into this band (R1 nit on the prior HTML implementation). */
const TIME_AXIS_HEIGHT_PX = 28;

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

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { width: paneW, height: paneH } = scope.mediaSize;
      const plotBottom = Math.max(0, paneH - TIME_AXIS_HEIGHT_PX);

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
            : plotBottom;
        if (yTopRaw == null || yBottomRaw == null) continue;
        // Clip top/bottom to plot area (NOT into the time-axis band).
        const top = Math.max(0, Math.min(yTopRaw, yBottomRaw));
        const bottom = Math.min(plotBottom, Math.max(yTopRaw, yBottomRaw));
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

class PriceAxisLabel implements ISeriesPrimitiveAxisView {
  private readonly spec: PriceAxisLabelSpec;
  private readonly series: ISeriesApi<SeriesType>;
  constructor(
    spec: PriceAxisLabelSpec,
    series: ISeriesApi<SeriesType>,
  ) {
    this.spec = spec;
    this.series = series;
  }

  coordinate(): number {
    const c = this.series.priceToCoordinate(this.spec.price);
    return c ?? -1;
  }

  text(): string {
    return this.spec.text;
  }

  textColor(): string {
    return this.spec.textColor;
  }

  backColor(): string {
    return this.spec.backColor;
  }
}

export class RectangleOverlayPrimitive
  implements ISeriesPrimitive<Time>
{
  private rects: readonly RectangleSpec[] = [];
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  // Cached pane-view + axis-view arrays. Lightweight Charts caches
  // by reference identity — return the same array reference when
  // nothing has changed to avoid forcing redraws.
  private cachedPaneViews: IPrimitivePaneView[] | null = null;
  private cachedAxisViews: ISeriesPrimitiveAxisView[] | null = null;

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
    this.cachedAxisViews = null;
  }

  /** Replace the rectangle set. Triggers a chart redraw via
   *  `requestUpdate`. The renderer recomputes pixel coords on the
   *  next frame — no manual coord recomputation needed here. */
  setRectangles(rects: readonly RectangleSpec[]): void {
    this.rects = rects;
    this.cachedPaneViews = null;
    this.cachedAxisViews = null;
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

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    if (!this.series) return [];
    if (this.cachedAxisViews) return this.cachedAxisViews;
    const out: ISeriesPrimitiveAxisView[] = [];
    for (const r of this.rects) {
      if (!r.priceLabels) continue;
      for (const label of r.priceLabels) {
        out.push(new PriceAxisLabel(label, this.series));
      }
    }
    this.cachedAxisViews = out;
    return this.cachedAxisViews;
  }

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
