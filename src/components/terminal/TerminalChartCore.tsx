/**
 * TerminalChartCore — universal price chart used on both desktop and
 * mobile via the `TerminalChartCanvas` wrapper.
 *
 * Built on TradingView Lightweight Charts. Originally introduced as
 * a mobile-only implementation (PRs #151 / #158 / #159 / #160) to
 * fix touch-interaction issues with the prior ECharts desktop
 * chart. After the mobile chart reached feature parity AND received
 * user feedback that its smoothness was preferable to the desktop's
 * ECharts incumbent, the desktop ECharts implementation was deleted
 * and this component became the single chart for both surfaces.
 *
 * Features:
 *   - Candlesticks (native CandlestickSeries)
 *   - 9-line AVWAP overlay: Week / Daily / RTH × {VWAP, ±1σ, ±2σ}.
 *     RTH anchor (9:30 ET cash open) doubles as session VWAP;
 *     RTH-anchor in-scope gating produces honest gaps during ETH bars.
 *   - Level price-lines: POC / VAH / VAL / PDH / PDL / PDC / SET
 *     plus ORH / ORL chips for each enabled OR window
 *   - ETH session shading + Opening Range bands rendered via a
 *     custom seriesPrimitive (`RectangleOverlayPrimitive`) so they
 *     paint on the chart canvas synchronously with pan/zoom
 *   - Day-changeover x-axis tick markers (DD on midnight + Fri→Sun
 *     reopen, HH:MM otherwise) via `tickMarkType`
 *   - Tooltip on hover (mouse) AND on touch (tap-and-drag), via
 *     `subscribeCrosshairMove` → custom HTML overlay
 *   - Right-anchored wheel zoom (desktop convention preserved from
 *     the ECharts predecessor): zooming with the mouse wheel keeps
 *     the latest bar pinned at the right edge
 *   - touch-action: pan-y for vertical-scroll passthrough on mobile
 *
 * Reuses chartHelpers (aggregateBars, isRthBar, vwapWithBandsSeries,
 * etc.) — pure functions formerly shared with the now-deleted
 * desktop ECharts implementation.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
  type UTCTimestamp,
  type CandlestickData,
  type LineData,
  type CandlestickSeriesPartialOptions,
} from "lightweight-charts";

import { fetchTerminalIntradayBars } from "../../api/terminalClient";
import type {
  TerminalIntradayBar,
  TerminalSnapshot,
} from "../../api/terminalTypes";
import {
  type OverlayState,
  type Timeframe,
  type VwapAnchorKey,
  VWAP_ANCHORS,
} from "./chartTypes";
import {
  aggregateBars,
  buildEthShadeRanges,
  buildLatestRthRange,
  findAnchorIdx,
  hexToRgba,
  isRthBar,
  resolveLumenPalette,
  vwapWithBandsSeries,
  VWAP_STYLES,
} from "./chartHelpers";
import {
  RectangleOverlayPrimitive,
  type RectangleSpec,
} from "./terminalChartOverlayPrimitive";

const POLL_INTERVAL_MS = 30_000;

const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
};

// Default visible-window for first paint. 12h matches the desktop
// chart's `computeDefaultZoomStart` intent — operator sees the most
// recent half-day on first load, can pan back through the buffer
// without reloading.
const DEFAULT_VISIBLE_HOURS = 12;

/** Format a data-age in seconds as a human-readable badge suffix.
 *  Under a minute reads as "Xs", under an hour as "Xm", and longer
 *  as "Xh Ym". Returns null when the backend hasn't recorded any
 *  successful fetch yet (cold-start) so the badge can show just
 *  "STALE" without a misleading "0s" reading. */
function formatStaleAge(seconds: number | null): string | null {
  if (seconds == null) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Component ──────────────────────────────────────────────────────

interface Props {
  snapshot: TerminalSnapshot | null;
  overlays: OverlayState;
  timeframe: Timeframe;
  // Bar-time formatter from parent's useTimezone hook. Threaded in
  // (not invoked per-component) so the parent's selector and chart
  // share a single hook instance / storage-key state.
  formatBarTime: (iso: string, withSeconds?: boolean) => string;
  // Day-of-month formatter (returns "DD"). Used by the time-axis
  // tickMarkFormatter — bars whose day differs from the prior bar
  // get "DD" instead of "HH:MM" — mirrors the desktop x-axis label
  // convention.
  formatBarDay: (iso: string) => string;
  // "DD MMM HH:MM" formatter for the bottom-axis crosshair label
  // (#336). Separate from `formatBarDay` because the latter is also
  // consumed by the day-changeover tickMarkFormatter where bare
  // "DD" is intentional.
  formatBarCrosshair: (iso: string) => string;
  // Short label for the active timezone (e.g. "PT", "PDT").
  // Suffixed onto the tooltip header.
  tzLabel: string;
}

export function TerminalChartCore({
  snapshot,
  overlays,
  timeframe,
  formatBarTime,
  formatBarDay,
  formatBarCrosshair,
  tzLabel,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // AVWAP series — 9 line series indexed by anchor key + variant
  // ("week.vwap" / "week.upper1" / "week.lower1" / etc.). Created
  // once at chart-init and persisted; overlay toggles flip their
  // data between [filled] and [] without create/remove churn.
  const avwapSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // ETH shading + OR band overlay drawn via Lightweight Charts'
  // ISeriesPrimitive API — rectangles render on the chart's canvas
  // synchronously with pan/zoom (no React render cycle, no float-
  // around lag). The prior HTML-overlay approach (PR #158) produced
  // visible lag; primitive draws on the same frame as the candles.
  const overlayPrimitiveRef = useRef<RectangleOverlayPrimitive | null>(null);
  // Active price-lines indexed by stable key — allows incremental
  // create/remove on overlay-toggle changes without rebuilding the
  // whole chart.
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  // Tooltip state.
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // Bar buffer.
  const [bars, setBars] = useState<TerminalIntradayBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Staleness flags from the bars endpoint (backend task #294).
  // `stale=true` flips the chart's STALE badge on so a customer
  // doesn't mistake yesterday's cached bars for live data during an
  // IBKR outage. `dataAgeSeconds` formats the badge with the actual
  // age — distinguishes "stale by 30s" from "stale by 6 hours."
  const [stale, setStale] = useState(false);
  const [dataAgeSeconds, setDataAgeSeconds] = useState<number | null>(null);

  const palette = useMemo(() => resolveLumenPalette(), []);

  const aggregatedBars = useMemo(
    () => (bars ? aggregateBars(bars, TIMEFRAME_MINUTES[timeframe]) : null),
    [bars, timeframe],
  );

  // ── Bar-fetch polling (mirrors desktop) ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchTerminalIntradayBars();
        if (!cancelled) {
          setBars(data.bars);
          // Default both to "fresh" when older payloads omit the
          // fields (graceful degradation during cross-repo deploy
          // ordering — older backend keeps `stale`/`data_age_seconds`
          // undefined, frontend treats that as "no signal of stale").
          setStale(data.stale === true);
          setDataAgeSeconds(data.data_age_seconds ?? null);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to fetch bars");
        }
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);

    // Background tabs throttle setInterval (Chrome: ≥1/min, frozen tabs
    // suspend entirely), so a returning viewer would stare at a gapped
    // chart for up to a full throttled interval. Refetch the moment the
    // tab becomes visible / regains focus / reconnects — the endpoint
    // returns the full session window and setBars() is a full replace,
    // so one successful fetch heals the whole gap. Same idiom as
    // useTerminalSnapshot.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    window.addEventListener("online", tick);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", tick);
    };
  }, []);

  // ── Chart initialization ─────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Pass explicit width/height to createChart instead of letting
    // Lightweight Charts infer them from the container. Reading
    // clientWidth/Height in the effect (post-DOM-commit) and
    // passing them through makes the timing explicit. We rely on
    // the CSS layout (`.terminal-chart-canvas { max-width: 100% }`
    // at mobile breakpoints) to constrain the container so we
    // don't need a JS-side viewport clamp.
    const initialWidth = Math.max(0, container.clientWidth);
    const initialHeight = Math.max(0, container.clientHeight);

    const chart = createChart(container, {
      width: initialWidth,
      height: initialHeight,
      layout: {
        background: { color: palette.paperDeep },
        textColor: palette.ink60,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: palette.ink20 },
        horzLines: { color: palette.ink20 },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: palette.ink40,
        rightOffset: 5,
        // tickMarkFormatter — Lightweight Charts passes the tick's
        // category via `tickMarkType` so we don't need to reconstruct
        // day-changeovers ourselves. Day boundaries get the bold "DD"
        // formatter; everything else (regular intraday ticks) gets
        // the user's selected-TZ HH:MM formatter. This decouples the
        // formatter from any tick-iteration order assumption (R1+R2
        // both flagged the prior cache-based approach as
        // order-dependent and incorrect under pan/zoom redraw).
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType): string => {
          if (typeof time !== "number") return "";
          const iso = new Date((time as number) * 1000).toISOString();
          // DayOfMonth ticks at midnight crossings + Friday→Sunday
          // reopen render the bold day marker.
          if (
            tickMarkType === TickMarkType.DayOfMonth
            || tickMarkType === TickMarkType.Month
            || tickMarkType === TickMarkType.Year
          ) {
            return formatBarDayRef.current(iso);
          }
          return formatBarTimeRef.current(iso, false);
        },
      },
      rightPriceScale: {
        visible: true,
        borderColor: palette.ink40,
        scaleMargins: { top: 0.05, bottom: 0.08 },
        // No `minimumWidth` floor — Lightweight Charts auto-fits
        // the gutter to the widest visible label. This works
        // correctly now that .terminal-chart and its flex children
        // have `min-width: 0` at the mobile breakpoint, preventing
        // the chart container from being stretched past viewport
        // by sibling rows. Earlier PRs (#155, #157, #166) added
        // progressively larger floors to compensate for an over-
        // wide container; with the structural CSS fix, no floor is
        // needed.
        //
        // Known trade-off: the gutter width breathes slightly when
        // level chips (POC/VAH/PDH/etc.) pan out of / into the
        // visible price range — auto-fit measures only currently-
        // visible labels, so a chart panned to a region with no
        // chips visible has a ~60px gutter, and panning back into a
        // region with chips re-expands to ~95-100px. Acceptable in
        // practice. If this becomes distracting, the lightest-touch
        // fix is `minimumWidth: ~96` (sized to the widest default-
        // overlay chip), which stabilizes the gutter at the same
        // width auto-fit produces when chips are visible.
        //
        // autoScale: true (default) auto-fits the visible price
        // extents on every pan/zoom.
        autoScale: true,
      },
      // MagnetOHLC (v5.2): snaps the crosshair to the nearest of
      // O/H/L/C on the candle at the cursor's X, not just the close
      // (the prior `Magnet` mode always snapped to close, which
      // operators found unhelpful when reading H/L levels off a
      // candle's wick). #336.
      crosshair: { mode: CrosshairMode.MagnetOHLC },
      localization: {
        // Override the bottom-axis crosshair time label so it follows
        // the user's selected TZ. Uses a dedicated "DD MMM HH:MM"
        // formatter (not formatBarDay+formatBarTime composed) because
        // formatBarDay returns bare "DD" — the day-changeover
        // tickMarkFormatter intentionally needs that bare form. The
        // ref pattern (formatBarCrosshairRef.current) means a TZ flip
        // doesn't require a chart rebuild. Without this entire block,
        // lightweight-charts falls back to its UTC default and the
        // crosshair label disagrees with the tooltip's local-TZ time.
        // #336.
        timeFormatter: (time: Time): string => {
          if (typeof time !== "number") return "";
          const iso = new Date((time as number) * 1000).toISOString();
          return formatBarCrosshairRef.current(iso);
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: {
        // Disable Lightweight Charts' built-in mouse-wheel zoom —
        // it's cursor-anchored, but the desktop ECharts predecessor
        // had a right-anchored wheel zoom (latest bar pinned at the
        // right edge) that operators are accustomed to. We
        // implement that ourselves below via a custom wheel
        // listener. Pinch-zoom on touch stays default
        // (cursor/pinch-center anchored, which is what touch
        // operators expect).
        mouseWheel: false,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
      },
    });

    chartRef.current = chart;

    const candleOpts: CandlestickSeriesPartialOptions = {
      upColor: palette.posCream,
      downColor: palette.negPersimmon,
      wickUpColor: palette.posCream,
      wickDownColor: palette.negPersimmon,
      borderVisible: false,
    };
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, candleOpts);

    // Attach the ETH/OR rectangle primitive to the candle series.
    // The primitive's renderer reads live coords on every chart
    // frame, so rectangles snap exactly to candles during pan/zoom
    // without React state churn. setRectangles() below in the
    // overlay-recompute effect supplies the actual rect specs.
    const overlayPrimitive = new RectangleOverlayPrimitive();
    candleSeriesRef.current.attachPrimitive(overlayPrimitive);
    overlayPrimitiveRef.current = overlayPrimitive;

    // ── AVWAP series creation (9 lines = 3 anchors × 3 variants) ─
    // Each anchor (Week / Daily / RTH) gets a VWAP line plus four
    // ±σ band lines (which collapse to two visible bands when both
    // upper and lower are toggled on). We always create all 9
    // series at chart-init so overlay toggles only flip
    // setData([fill]) / setData([]) — no create/remove churn during
    // user interaction. Chart-init is the only place that knows
    // about Lightweight Charts' addSeries lifecycle.
    for (const { key } of VWAP_ANCHORS) {
      const style = VWAP_STYLES[key];
      const color = palette[style.color];
      const vwapLine = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      avwapSeriesRef.current.set(`${key}.vwap`, vwapLine);
      for (const variant of ["upper1", "lower1", "upper2", "lower2"] as const) {
        const bandLine = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: style.dashBand ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        avwapSeriesRef.current.set(`${key}.${variant}`, bandLine);
      }
    }

    // ── Tooltip — driven by crosshair-move events ────────────────
    const onCrosshairMove: Parameters<IChartApi["subscribeCrosshairMove"]>[0] =
      (param) => {
        if (!param || !param.time || !candleSeriesRef.current) {
          setTooltip(null);
          return;
        }
        const bar = param.seriesData.get(candleSeriesRef.current) as
          | CandlestickData
          | undefined;
        if (!bar) {
          setTooltip(null);
          return;
        }
        const point = param.point;
        if (!point) {
          setTooltip(null);
          return;
        }
        setTooltip({
          x: point.x,
          y: point.y,
          timeMs: typeof param.time === "number" ? (param.time as number) * 1000 : 0,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        });
      };
    chart.subscribeCrosshairMove(onCrosshairMove);

    // ── Right-anchored wheel zoom ────────────────────────────────
    // Replaces Lightweight Charts' default (cursor-anchored) wheel
    // zoom with the right-anchored convention the prior desktop
    // ECharts predecessor implemented. Logic: shrink/grow the
    // visible logical range so its RIGHT edge stays pinned;
    // only the LEFT edge moves outward (zoom out) or inward (zoom
    // in). The "right edge" is the right edge of the CURRENT
    // viewport — not necessarily the latest bar — so a user who
    // panned into history and then zooms keeps their right-edge
    // bar fixed in place. Operators get a consistent "the bar I'm
    // looking at on the right stays put" mental model.
    //
    // Touch users: preserved as Lightweight Charts' default pinch
    // behavior (cursor / pinch-center anchored), which is what
    // touch operators actually expect.
    const onWheel = (ev: WheelEvent) => {
      if (ev.ctrlKey || ev.metaKey) return; // browser zoom
      if (ev.deltaY === 0) return; // pure horizontal wheel — let it pass
      ev.preventDefault();
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (range == null) return;
      // ev.deltaY > 0 → wheel scrolled down → zoom out (more bars
      // visible). ev.deltaY < 0 → zoom in. Step size 10% per wheel
      // notch, capped to keep at least ~10 bars visible at max
      // zoom-in.
      const span = range.to - range.from;
      const factor = ev.deltaY > 0 ? 1.10 : 0.90;
      const newSpan = Math.max(10, span * factor);
      ts.setVisibleLogicalRange({
        from: range.to - newSpan,
        to: range.to,
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    // No subscribeVisibleTimeRangeChange / overlayTick state needed:
    // the primitive's renderer reads live coords inside its draw()
    // method, which the chart calls on every pan/zoom/resize frame
    // automatically. The HTML-overlay approach (PR #158) needed
    // React state to trigger DOM re-render; the primitive sidesteps
    // React entirely for the per-frame redraw.

    // Auto-resize on container size change (orientation flip,
    // browser-zoom, sidebar collapse).
    const ro = new ResizeObserver(() => {
      const w = Math.max(0, container.clientWidth);
      const h = Math.max(0, container.clientHeight);
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    });
    ro.observe(container);

    // Capture priceLinesRef + avwapSeriesRef in locals so the cleanup
    // doesn't read stale refs that may have changed by unmount time
    // (lint: react-hooks/exhaustive-deps).
    const priceLinesAtMount = priceLinesRef.current;
    const avwapSeriesAtMount = avwapSeriesRef.current;
    return () => {
      ro.disconnect();
      // Symmetry with addEventListener above. `chart.remove()`
      // tears down the canvas but the wheel listener is on the
      // outer container div (React-managed), so it survives
      // chart teardown. Without this removal, StrictMode's
      // double-invoke of the effect in dev (and HMR refreshes)
      // stacks listeners — both fire on every wheel event and the
      // zoom factor compounds (0.90 × 0.90 = 0.81 per notch
      // instead of 0.90). Benign in prod (no double-invoke), but
      // the symmetry is correctness.
      container.removeEventListener("wheel", onWheel);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      // Detach the overlay primitive before chart.remove() — chart
      // teardown should release it, but explicit detach is the
      // documented pattern and matches the createPriceLine /
      // removePriceLine symmetry.
      if (
        overlayPrimitiveRef.current
        && candleSeriesRef.current
      ) {
        candleSeriesRef.current.detachPrimitive(overlayPrimitiveRef.current);
      }
      overlayPrimitiveRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      priceLinesAtMount.clear();
      avwapSeriesAtMount.clear();
    };
    // Palette is stable across the chart's lifetime; tickFormatterClosure
    // closes over the latest formatBarTime/formatBarDay via the
    // `tickFormatterRef` below so we don't need to re-init on prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ref-backed formatter pointers so the tickMarkFormatter installed
  // on the chart at init-time always calls the LATEST prop versions
  // (formatBarTime / formatBarDay / formatBarCrosshair change when the
  // user flips the timezone selector). Avoids a chart-rebuild on every
  // TZ change.
  const formatBarTimeRef = useRef(formatBarTime);
  const formatBarDayRef = useRef(formatBarDay);
  const formatBarCrosshairRef = useRef(formatBarCrosshair);
  formatBarTimeRef.current = formatBarTime;
  formatBarDayRef.current = formatBarDay;
  formatBarCrosshairRef.current = formatBarCrosshair;

  // First-paint anchor flag — re-trigger on timeframe change so the
  // visible window re-anchors when the user flips 1m → 1h (otherwise
  // a previously-pinned ~12h-of-1m-bars zoom shows only a sliver of
  // the 1h timeframe). R2 nit.
  const initialFitRef = useRef(true);
  useEffect(() => {
    initialFitRef.current = true;
  }, [timeframe]);

  // ── Bar data → chart series ──────────────────────────────────────
  useEffect(() => {
    if (!aggregatedBars || !candleSeriesRef.current) return;
    const candleData: CandlestickData[] = [];
    for (const bar of aggregatedBars) {
      const t = Date.parse(bar.time);
      if (!Number.isFinite(t)) continue;
      candleData.push({
        time: (Math.floor(t / 1000) as UTCTimestamp),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
    }
    candleSeriesRef.current.setData(candleData);

    // First paint (and after a timeframe change): anchor the visible
    // window to the most recent ~12h. Subsequent setData calls
    // preserve user's pan/zoom.
    if (initialFitRef.current && chartRef.current && candleData.length > 1) {
      initialFitRef.current = false;
      const lastT = candleData[candleData.length - 1].time as number;
      const fromT = lastT - DEFAULT_VISIBLE_HOURS * 3600;
      chartRef.current.timeScale().setVisibleRange({
        from: fromT as UTCTimestamp,
        to: lastT as UTCTimestamp,
      });
    }
  }, [aggregatedBars]);

  // ── AVWAP multi-anchor overlay (9 line series) ───────────────────
  // For each anchor (Week / Daily / RTH), find the anchor index in
  // the bar buffer, compute cumulative VWAP + stddev from that
  // anchor onward (with RTH-only gating for the RTH anchor), then
  // populate or clear the 5 series (vwap + ±1σ + ±2σ) per anchor
  // based on the user's overlay toggles. Reuses
  // `findAnchorIdx` / `vwapWithBandsSeries` / `isRthBar` from
  // chartHelpers — same code path as the desktop chart.
  useEffect(() => {
    if (!aggregatedBars) return;
    const timeframeMin = TIMEFRAME_MINUTES[timeframe];
    for (const { key } of VWAP_ANCHORS) {
      const state = overlays.vwap[key];
      const anyOn = state.vwap || state.band1 || state.band2;
      const vwapLine = avwapSeriesRef.current.get(`${key}.vwap`);
      const upper1 = avwapSeriesRef.current.get(`${key}.upper1`);
      const lower1 = avwapSeriesRef.current.get(`${key}.lower1`);
      const upper2 = avwapSeriesRef.current.get(`${key}.upper2`);
      const lower2 = avwapSeriesRef.current.get(`${key}.lower2`);
      if (!vwapLine || !upper1 || !lower1 || !upper2 || !lower2) continue;

      if (!anyOn) {
        vwapLine.setData([]);
        upper1.setData([]);
        lower1.setData([]);
        upper2.setData([]);
        lower2.setData([]);
        continue;
      }

      const anchorIdx = findAnchorIdx(key as VwapAnchorKey, aggregatedBars);
      if (anchorIdx < 0) {
        vwapLine.setData([]);
        upper1.setData([]);
        lower1.setData([]);
        upper2.setData([]);
        lower2.setData([]);
        continue;
      }
      const inScope =
        key === "rth"
          ? (b: TerminalIntradayBar) => isRthBar(b, timeframeMin)
          : undefined;
      const series = vwapWithBandsSeries(aggregatedBars, anchorIdx, inScope);

      // Build per-bar LineData arrays. Lightweight Charts treats
      // missing time entries as gaps (we just don't push them).
      // RTH-anchor's null-gating during ETH bars produces honest
      // gaps in the line.
      const vwapData: LineData[] = [];
      const upper1Data: LineData[] = [];
      const lower1Data: LineData[] = [];
      const upper2Data: LineData[] = [];
      const lower2Data: LineData[] = [];
      for (let i = 0; i < aggregatedBars.length; i++) {
        const s = series[i];
        if (s == null) continue;
        const t = (Math.floor(Date.parse(aggregatedBars[i].time) / 1000) as UTCTimestamp);
        if (state.vwap) vwapData.push({ time: t, value: s.vwap });
        if (state.band1) {
          upper1Data.push({ time: t, value: s.vwap + s.stddev });
          lower1Data.push({ time: t, value: s.vwap - s.stddev });
        }
        if (state.band2) {
          upper2Data.push({ time: t, value: s.vwap + 2 * s.stddev });
          lower2Data.push({ time: t, value: s.vwap - 2 * s.stddev });
        }
      }
      vwapLine.setData(vwapData);
      upper1.setData(upper1Data);
      lower1.setData(lower1Data);
      upper2.setData(upper2Data);
      lower2.setData(lower2Data);
    }
  }, [aggregatedBars, overlays.vwap, timeframe]);

  // ── Level price-lines (POC/VAH/VAL/PDH/PDL/PDC/SET) ──────────────
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    const levels = snapshot?.levels;
    const priceLines = priceLinesRef.current;

    // Axis-label proximity threshold for prev-PDH/L/C (#306). When
    // prev_pd_* is within this many ES points of its current
    // counterpart, the right-axis price chip would render two
    // visually-identical numbers stacked on each other — operators
    // can't tell which chip is current vs prev. Suppress the prev
    // chip in that case; the in-chart line title ("PDH (-1)") plus
    // the dashed line style still differentiate the layers visually
    // mid-plot. $1.00 ≈ noise floor for ES at current price levels.
    const PREV_AXIS_OVERLAP_THRESHOLD = 1.0;
    const isPrevHighOverlap =
      levels?.pd_high != null && levels?.prev_pd_high != null
      && Math.abs(levels.pd_high - levels.prev_pd_high) <= PREV_AXIS_OVERLAP_THRESHOLD;
    const isPrevLowOverlap =
      levels?.pd_low != null && levels?.prev_pd_low != null
      && Math.abs(levels.pd_low - levels.prev_pd_low) <= PREV_AXIS_OVERLAP_THRESHOLD;
    const isPrevCloseOverlap =
      levels?.pd_close != null && levels?.prev_pd_close != null
      && Math.abs(levels.pd_close - levels.prev_pd_close) <= PREV_AXIS_OVERLAP_THRESHOLD;

    // Spec for each level: which overlay-state gate enables it,
    // its display label, color, and line style.
    // `axisLabelVisible` defaults to true; set explicitly only
    // when a line needs to suppress its right-axis chip (#306).
    const targetLines: Array<{
      key: string;
      enabled: boolean;
      value: number | null | undefined;
      label: string;
      color: string;
      style: LineStyle;
      width: 1 | 2;
      axisLabelVisible?: boolean;
    }> = [
      // POC / Value Area — gated by overlays.pocVa
      {
        key: "POC", enabled: overlays.pocVa, value: levels?.poc,
        label: "POC", color: palette.ink80, style: LineStyle.Solid, width: 2,
      },
      {
        key: "VAH", enabled: overlays.pocVa, value: levels?.vah,
        label: "VAH", color: palette.ink60, style: LineStyle.Dashed, width: 1,
      },
      {
        key: "VAL", enabled: overlays.pocVa, value: levels?.val,
        label: "VAL", color: palette.ink60, style: LineStyle.Dashed, width: 1,
      },
      // Prior-day HLC — gated by overlays.priorHlc.current
      {
        key: "PDH", enabled: overlays.priorHlc.current, value: levels?.pd_high,
        label: "PDH", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      {
        key: "PDL", enabled: overlays.priorHlc.current, value: levels?.pd_low,
        label: "PDL", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      {
        key: "PDC", enabled: overlays.priorHlc.current, value: levels?.pd_close,
        label: "PDC", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      // SET — settlement; rendered when distinguishable from PDC
      // (≥0.25 pt apart, mirroring the suppression rule from the
      // since-deleted desktop ECharts implementation). Stays gated
      // on the "current" PDC toggle since SET is conceptually the
      // settlement of the same just-completed session.
      {
        key: "SET",
        enabled:
          overlays.priorHlc.current
          && snapshot?.gap_fill?.settlement_price != null
          && (levels?.pd_close == null
              || Math.abs(snapshot.gap_fill.settlement_price - levels.pd_close) >= 0.25),
        value: snapshot?.gap_fill?.settlement_price,
        label: "SET", color: palette.ink60, style: LineStyle.Dashed, width: 1,
      },
      // Prev prior-session HLC — gated by overlays.priorHlc.previous
      // (the session BEFORE the one carried in pd_*). Differentiated
      // from PDH/PDL/PDC with Dashed line style + "(-1)" label suffix.
      // Color stays at palette.ink60 (matching the current layer) —
      // the existing chart reserves ink40 for borders/structural
      // strokes, never data lines, so double-dimming here would risk
      // making the prev layer hard to see on a busy chart. Dashed +
      // label suffix is already strong differentiation.
      {
        key: "PDH-prev", enabled: overlays.priorHlc.previous, value: levels?.prev_pd_high,
        label: "PDH (-1)", color: palette.ink60, style: LineStyle.Dashed, width: 1,
        // Suppress the right-axis chip when current+prev would render
        // indistinguishable numbers (#306). In-chart label keeps the
        // "(-1)" disambiguation. Only suppress when the CURRENT layer
        // is also on — if the user only has prev enabled, the axis
        // chip is the only place to read the value.
        axisLabelVisible: !(overlays.priorHlc.current && isPrevHighOverlap),
      },
      {
        key: "PDL-prev", enabled: overlays.priorHlc.previous, value: levels?.prev_pd_low,
        label: "PDL (-1)", color: palette.ink60, style: LineStyle.Dashed, width: 1,
        axisLabelVisible: !(overlays.priorHlc.current && isPrevLowOverlap),
      },
      {
        key: "PDC-prev", enabled: overlays.priorHlc.previous, value: levels?.prev_pd_close,
        label: "PDC (-1)", color: palette.ink60, style: LineStyle.Dashed, width: 1,
        axisLabelVisible: !(overlays.priorHlc.current && isPrevCloseOverlap),
      },
      // ORH / ORL chips — one per active OR window (1m / 5m / 15m).
      // Rendered via createPriceLine like the rest of the level
      // chips so they share visual treatment (POC / VAH / VAL /
      // PDH / PDL / PDC / SET). The OR rectangle band itself
      // renders separately via the RectangleOverlayPrimitive.
      {
        key: "ORH-1m", enabled: overlays.openingRange.m1, value: levels?.or_1m_high,
        label: "ORH 1m", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      {
        key: "ORL-1m", enabled: overlays.openingRange.m1, value: levels?.or_1m_low,
        label: "ORL 1m", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      {
        key: "ORH-5m", enabled: overlays.openingRange.m5, value: levels?.or_5m_high,
        label: "ORH 5m", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      {
        key: "ORL-5m", enabled: overlays.openingRange.m5, value: levels?.or_5m_low,
        label: "ORL 5m", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      {
        key: "ORH-15m", enabled: overlays.openingRange.m15, value: levels?.or_15m_high,
        label: "ORH 15m", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      {
        key: "ORL-15m", enabled: overlays.openingRange.m15, value: levels?.or_15m_low,
        label: "ORL 15m", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
    ];

    // Reconcile: create new, update existing, remove stale.
    const seenKeys = new Set<string>();
    for (const spec of targetLines) {
      if (!spec.enabled || spec.value == null) continue;
      seenKeys.add(spec.key);
      const existing = priceLines.get(spec.key);
      const opts = {
        price: spec.value,
        color: spec.color,
        lineWidth: spec.width,
        lineStyle: spec.style,
        // Per-spec override; default true for backward compatibility
        // with every spec that doesn't set it.
        axisLabelVisible: spec.axisLabelVisible ?? true,
        title: spec.label,
      };
      if (existing) {
        existing.applyOptions(opts);
      } else {
        const created = candleSeries.createPriceLine(opts);
        priceLines.set(spec.key, created);
      }
    }
    // Remove any prior price lines no longer in the target set.
    for (const [key, line] of priceLines) {
      if (!seenKeys.has(key)) {
        candleSeries.removePriceLine(line);
        priceLines.delete(key);
      }
    }
  }, [
    snapshot?.levels,
    snapshot?.gap_fill?.settlement_price,
    overlays.pocVa,
    overlays.priorHlc,
    overlays.openingRange,
    palette,
  ]);

  // The chart container ALWAYS renders so that the chart-init
  // useEffect (which has empty deps `[]` and runs once on mount)
  // can attach to a real DOM element. Empty / error / loading
  // states overlay the container as absolutely-positioned children
  // so they don't displace the container or change the ref target.
  //
  // Critical: returning early with a different `<div>` here would
  // mean the chart-init effect runs on a div that never receives
  // the ref (because the ref target was the DIFFERENT div from a
  // later render that the effect never re-runs for). The effect
  // can't re-fire on bars-load because it has empty deps; making
  // bars a dep would re-init the chart on every poll. Always-
  // mount + overlay is the clean pattern.
  const overlayMessage =
    error ? `Chart unavailable: ${error}` :
    bars == null ? "Loading ES bars…" :
    bars.length === 0 ? "No bars available — IBKR may be reconnecting." :
    null;

  // ── ETH shading + OR-band rectangle overlays ─────────────────────
  // Build domain-coordinate (time + price) rect specs and hand them
  // to the RectangleOverlayPrimitive. The primitive's renderer
  // re-projects to pixels on every chart-internal frame, so
  // rectangles snap to candles during pan/zoom without any React
  // state churn or "float-around" lag (the symptom the user
  // reported with the prior HTML-overlay approach).
  // ORH/ORL price labels travel with the rect specs and render as
  // native price-axis chips via the primitive's priceAxisViews().
  useEffect(() => {
    const primitive = overlayPrimitiveRef.current;
    if (!primitive) return;
    if (!aggregatedBars || aggregatedBars.length === 0) {
      primitive.setRectangles([]);
      return;
    }
    const timeframeMin = TIMEFRAME_MINUTES[timeframe];
    const specs: RectangleSpec[] = [];

    // ETH shading: one rect per contiguous ETH run. timeFrom/timeTo
    // are the bucket-start times of the run's first / last bar.
    // priceTop / priceBottom = null → primitive renders full plot
    // height (excluding the time-axis band).
    const ethRanges = buildEthShadeRanges(aggregatedBars, timeframeMin);
    for (let i = 0; i < ethRanges.length; i++) {
      const [s, e] = ethRanges[i];
      const t1 = (Math.floor(Date.parse(aggregatedBars[s].time) / 1000) as UTCTimestamp);
      const t2 = (Math.floor(Date.parse(aggregatedBars[e].time) / 1000) as UTCTimestamp);
      specs.push({
        id: `eth-${i}`,
        timeFrom: t1,
        timeTo: t2,
        priceTop: null,
        priceBottom: null,
        // TradingView's ETH-shading convention: #2962FF (blue) at 8%
        // opacity. The previous white wash (palette.ink100 @ 0.08)
        // was too close in tone to the chart's ink-20 gridlines —
        // the user (colorblind) could not visually distinguish the
        // two even after a sighted check confirmed they were
        // technically different. Blue at 8% sits in a chromatically
        // different region from the achromatic gridline gray and
        // reads cleanly for both color-vision profiles.
        fill: hexToRgba("#2962FF", 0.08),
      });
    }

    // OR bands: one rect per active window, bounded LEFT to today's
    // RTH-open bar, RIGHT to plot edge (timeTo = null → primitive
    // extends to canvas right edge minus price-scale width).
    // ORH / ORL price-axis labels via priceLabels — these surface
    // as native chips on the right axis (the labels the user said
    // were missing in PR #158's HTML approach).
    const latestRth = buildLatestRthRange(aggregatedBars, timeframeMin);
    if (latestRth && snapshot?.levels) {
      const lv = snapshot.levels;
      const orBands: { key: "m1" | "m5" | "m15"; label: string; low: number | null; high: number | null }[] = [
        { key: "m1", label: "1m", low: lv.or_1m_low, high: lv.or_1m_high },
        { key: "m5", label: "5m", low: lv.or_5m_low, high: lv.or_5m_high },
        { key: "m15", label: "15m", low: lv.or_15m_low, high: lv.or_15m_high },
      ];
      const t1 = (Math.floor(Date.parse(aggregatedBars[latestRth[0]].time) / 1000) as UTCTimestamp);
      for (const band of orBands) {
        const enabled = overlays.openingRange[band.key];
        if (!enabled || band.low == null || band.high == null) continue;
        specs.push({
          id: `or-${band.key}`,
          timeFrom: t1,
          timeTo: null,
          priceTop: band.high,
          priceBottom: band.low,
          fill: hexToRgba(palette.ink100, 0.04),
          // ORH/ORL labels are rendered separately as native
          // priceLines in the level-price-lines effect (same code
          // path + visual treatment as POC / VAH / etc), not here.
        });
      }
    }

    primitive.setRectangles(specs);
  }, [
    aggregatedBars,
    overlays.openingRange,
    snapshot?.levels,
    timeframe,
    palette,
  ]);

  // Pre-compute the formatted age once per render so both the badge
  // body and its aria-label can reference the same string.
  const ageStr = formatStaleAge(dataAgeSeconds);

  return (
    <div
      className="terminal-chart-canvas"
      ref={containerRef}
      style={{
        position: "relative",
        // Override the inherited `.terminal-chart-canvas`
        // flex-center display, which would clip the chart's
        // self-sized internal divs to their content height. The
        // chart fills 100% of the container; flex centering was
        // for the empty-state span only, which we now overlay
        // below.
        display: "block",
        width: "100%",
        height: "100%",
        // touch-action: pan-y lets vertical swipes that originate
        // inside the chart pass through to the page's normal
        // scroll behavior. Without this, any touchmove starting
        // on the chart would be captured by Lightweight Charts
        // and the user couldn't scroll past the chart on mobile.
        touchAction: "pan-y",
      }}
    >
      {overlayMessage && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-40)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            letterSpacing: "0.04em",
            background: "var(--paper-deep)",
            // Sit above the chart's canvas while the chart is
            // empty so the message reads cleanly.
            zIndex: 1,
            pointerEvents: "none",
          }}
        >
          <span className="empty">{overlayMessage}</span>
        </div>
      )}
      {/* ETH shading + OR bands now render via the chart's
          ISeriesPrimitive — see overlayPrimitiveRef. The rectangles
          are drawn on the chart's canvas synchronously with every
          pan/zoom frame, so no HTML overlay div is needed here. */}
      {/* Stale-data badge. Flips on when the backend bars endpoint
          flags `stale=true` (intraday_eth slot is in circuit-breaker
          cooldown OR the most recent fetch timed out — backend task
          #294). Styled via `.terminal-chart-stale-badge` in
          TerminalDashboard.css so it follows the project's
          persimmon-red staleness convention and theme tokens.
          Wording "CACHED" (not "STALE") so a touch-only user gets
          the cause without needing the hover tooltip — data is in
          the historical-fetcher cache because the live fetch failed.
          a11y: role=status + aria-live=polite so screen readers get
          a "chart data is delayed" announcement when the badge
          appears, matching DCPositionsTab's stale-banner pattern. */}
      {stale && (
        <div
          className="terminal-chart-stale-badge"
          role="status"
          aria-live="polite"
          aria-label={
            ageStr
              ? `Chart data is cached; last live update ${ageStr} ago`
              : "Chart data is cached; live IBKR fetch unavailable"
          }
          title={
            "Bars served from cache — live IBKR fetch unavailable. "
            + "Chart is showing the most-recent successful data; "
            + "operator should expect resumption when the data feed recovers."
          }
        >
          <span style={{ textTransform: "uppercase" }}>Cached</span>
          {ageStr && <> • {ageStr}</>}
        </div>
      )}
      {tooltip && (
        <ChartTooltip tooltip={tooltip} tzLabel={tzLabel} formatBarTime={formatBarTime} />
      )}
    </div>
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────

interface TooltipState {
  x: number;
  y: number;
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function ChartTooltip({
  tooltip,
  tzLabel,
  formatBarTime,
}: {
  tooltip: TooltipState;
  tzLabel: string;
  formatBarTime: (iso: string, withSeconds?: boolean) => string;
}) {
  const iso = new Date(tooltip.timeMs).toISOString();
  // Position above-left of the cursor by default; flip to below-
  // right when near the top edge so the tooltip stays in view.
  const offsetX = 12;
  const offsetY = tooltip.y < 80 ? 12 : -90;
  return (
    <div
      style={{
        position: "absolute",
        left: tooltip.x + offsetX,
        top: tooltip.y + offsetY,
        background: "rgba(15, 23, 42, 0.92)",
        border: "1px solid var(--ink-40, #475569)",
        color: "var(--ink-100, #f8fafc)",
        font: "11px/1.5 var(--font-mono, ui-monospace, monospace)",
        padding: "6px 8px",
        pointerEvents: "none",
        zIndex: 5,
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ opacity: 0.6, fontSize: 10 }}>
        {formatBarTime(iso, true)} {tzLabel}
      </div>
      <div>O {tooltip.open.toFixed(2)}</div>
      <div>H {tooltip.high.toFixed(2)}</div>
      <div>L {tooltip.low.toFixed(2)}</div>
      <div>C {tooltip.close.toFixed(2)}</div>
    </div>
  );
}

// `aggregateBars` and `resolveLumenPalette` moved to `./chartHelpers`
// for sharing with the desktop chart. Imported above.

export default TerminalChartCore;
