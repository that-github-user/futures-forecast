/**
 * MobileChartCanvas — touch-native price chart for ≤768px viewports.
 *
 * Replaces the desktop's ECharts implementation
 * (`TerminalChartCanvas.tsx`) on mobile only. The desktop chart's
 * ECharts default touch behavior (cursor-anchored pinch-zoom,
 * momentum-less drag-pan, scroll/pan gesture conflicts with the
 * page) made the chart "impossible to work with" on mobile per
 * user report. TradingView Lightweight Charts is touch-native:
 * inertial drag-pan, two-finger pinch-zoom, gesture isolation
 * from page scroll.
 *
 * PR 1 scope (this file):
 *   - Candlesticks (native CandlestickSeries)
 *   - Session VWAP line (native LineSeries)
 *   - Level lines: POC, VAH, VAL, PDH/PDL/PDC, SET (createPriceLine)
 *   - Day-changeover x-axis tick markers (DD on midnight crossings
 *     + Friday→Sunday reopen)
 *   - Tooltip on touch via subscribeCrosshairMove (custom HTML
 *     overlay positioned via the chart's coordinate API)
 *   - 12h-visible default zoom (mirrors desktop intent)
 *
 * PR 2 scope (deferred):
 *   - ETH session shading (custom canvas primitive)
 *   - 9-line AVWAP overlay (Week/Daily/RTH × VWAP/±1σ/±2σ)
 *   - Opening Range bands (1m/5m/15m windows)
 *
 * PR 3 scope (deferred):
 *   - Collision-aware right-gutter chip labels (when 5+ levels
 *     cluster within a 5-pt range, native price-line labels overlap;
 *     replicate the desktop's pixel-space cluster-merge from
 *     `TerminalChartCanvas.tsx:1110-1151`).
 *
 * Reused from desktop:
 *   - `fetchTerminalIntradayBars()` polling (30s cadence)
 *   - `OverlayState` type (drives which level lines render)
 *   - `aggregateBars`, `isRthBar` helpers (re-implemented here to
 *     avoid risking the desktop file with cross-component refactor;
 *     refactor to shared helpers in PR 2 alongside ETH plugin work)
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
  type LineSeriesPartialOptions,
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
  // Short label for the active timezone (e.g. "PT", "PDT").
  // Suffixed onto the tooltip header.
  tzLabel: string;
}

export function MobileChartCanvas({
  snapshot,
  overlays,
  timeframe,
  formatBarTime,
  formatBarDay,
  tzLabel,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const sessionVwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  // AVWAP series — 9 line series indexed by anchor key + variant
  // ("week.vwap" / "week.upper1" / "week.lower1" / etc.). Created
  // once at chart-init and persisted; overlay toggles flip their
  // data between [filled] and [] without create/remove churn.
  const avwapSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // ETH shading + OR band overlay div. HTML overlay layer is
  // simpler than Lightweight Charts' custom-primitive plugin API
  // for these rectangle shapes; sync via subscribe-on-time-range
  // change.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // Active price-lines indexed by stable key — allows incremental
  // create/remove on overlay-toggle changes without rebuilding the
  // whole chart.
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  // Tooltip state.
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // Pan/zoom tick — bumps on every visible-time-range change so the
  // ETH/OR HTML overlay re-renders with fresh pixel coordinates.
  // Lightweight Charts emits the event but we react via React state
  // so the rectangles re-mount in DOM (no manual style mutation).
  const [overlayTick, setOverlayTick] = useState(0);
  // Bar buffer.
  const [bars, setBars] = useState<TerminalIntradayBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ── Chart initialization ─────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
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
        // Generous horizontal width for the level chips and the
        // price-axis tick labels. Iterated through 80 → 110 → 130
        // → 160 based on user feedback ("only see first 3 digits
        // of 5xxx"). 160 should be ample for 4-digit prices with
        // 2 decimals (~95px) plus chip-padding overhead. If 160
        // STILL clips, the issue is internal to lightweight-charts'
        // label rendering, not container sizing — and the right
        // fix is the custom HTML chip overlay (PR 3 of the planned
        // mobile-chart series, brought forward as needed).
        minimumWidth: 160,
        // autoScale: true (the default) — price scale auto-fits
        // the visible time-range's price extents on every pan/zoom.
        autoScale: true,
      },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
      },
    });

    chartRef.current = chart;

    // Belt-and-suspenders: re-apply the price-scale `minimumWidth`
    // after chart creation. A user report that the price-axis
    // labels still showed only "7xxx" first digit despite the
    // minimumWidth being set in createChart options suggests
    // lightweight-charts may not always honor the initial-options
    // value during the initial layout pass; calling
    // applyOptions explicitly forces a re-layout.
    chart.priceScale("right").applyOptions({ minimumWidth: 160 });

    const candleOpts: CandlestickSeriesPartialOptions = {
      upColor: palette.posCream,
      downColor: palette.negPersimmon,
      wickUpColor: palette.posCream,
      wickDownColor: palette.negPersimmon,
      borderVisible: false,
    };
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, candleOpts);

    const vwapOpts: LineSeriesPartialOptions = {
      color: palette.ink80,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    };
    sessionVwapSeriesRef.current = chart.addSeries(LineSeries, vwapOpts);

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
        const sessionVwapValue = sessionVwapSeriesRef.current
          ? (param.seriesData.get(sessionVwapSeriesRef.current) as LineData)?.value
          : undefined;
        setTooltip({
          x: point.x,
          y: point.y,
          timeMs: typeof param.time === "number" ? (param.time as number) * 1000 : 0,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          sessionVwap: sessionVwapValue ?? null,
        });
      };
    chart.subscribeCrosshairMove(onCrosshairMove);

    // Pan/zoom subscription — bumps `overlayTick` so the ETH/OR
    // HTML overlay re-renders its rectangles with fresh pixel
    // coordinates (timeToCoordinate / priceToCoordinate change as
    // the visible range scrolls).
    const onTimeRangeChange = () => setOverlayTick((t) => t + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(onTimeRangeChange);

    // Auto-resize on container size change (orientation flip,
    // browser-zoom, sidebar collapse).
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        chart.applyOptions({ width: w, height: h });
        // Resize also invalidates overlay coords (priceScale width
        // shifts when the canvas width changes).
        setOverlayTick((t) => t + 1);
      }
    });
    ro.observe(container);

    // Capture priceLinesRef + avwapSeriesRef in locals so the cleanup
    // doesn't read stale refs that may have changed by unmount time
    // (lint: react-hooks/exhaustive-deps).
    const priceLinesAtMount = priceLinesRef.current;
    const avwapSeriesAtMount = avwapSeriesRef.current;
    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onTimeRangeChange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      sessionVwapSeriesRef.current = null;
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
  // (formatBarTime / formatBarDay change when the user flips the
  // timezone selector). Avoids a chart-rebuild on every TZ change.
  const formatBarTimeRef = useRef(formatBarTime);
  const formatBarDayRef = useRef(formatBarDay);
  formatBarTimeRef.current = formatBarTime;
  formatBarDayRef.current = formatBarDay;

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

  // ── Session VWAP overlay ──────────────────────────────────────────
  useEffect(() => {
    if (!aggregatedBars || !sessionVwapSeriesRef.current) return;
    const sessionVwap = snapshot?.vwap?.session_vwap;
    if (sessionVwap == null) {
      sessionVwapSeriesRef.current.setData([]);
      return;
    }
    // Render the session VWAP as a flat line at the snapshot's
    // session_vwap value across all visible bars. The backend
    // computes this server-side so the frontend doesn't need to
    // re-walk volume; we just surface the latest value.
    //
    // TODO(PR2): replace with a per-bar running VWAP curve. The
    // desktop chart renders the actual VWAP trajectory by
    // accumulating typical-price × volume per RTH bar — that
    // computation should move to a shared helper module alongside
    // the AVWAP machinery and be reused here.
    const lineData: LineData[] = aggregatedBars.map((bar) => ({
      time: (Math.floor(Date.parse(bar.time) / 1000) as UTCTimestamp),
      value: sessionVwap,
    }));
    sessionVwapSeriesRef.current.setData(lineData);
  }, [aggregatedBars, snapshot?.vwap?.session_vwap]);

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

    // Spec for each level: which overlay-state gate enables it,
    // its display label, color, and line style.
    const targetLines: Array<{
      key: string;
      enabled: boolean;
      value: number | null | undefined;
      label: string;
      color: string;
      style: LineStyle;
      width: 1 | 2;
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
      // Prior-day HLC — gated by overlays.priorHlc
      {
        key: "PDH", enabled: overlays.priorHlc, value: levels?.pd_high,
        label: "PDH", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      {
        key: "PDL", enabled: overlays.priorHlc, value: levels?.pd_low,
        label: "PDL", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      {
        key: "PDC", enabled: overlays.priorHlc, value: levels?.pd_close,
        label: "PDC", color: palette.ink60, style: LineStyle.Dotted, width: 1,
      },
      // SET — settlement; rendered when distinguishable from PDC
      // (≥0.25 pt apart, mirroring the desktop suppression at
      // TerminalChartCanvas.tsx:1037-1051).
      {
        key: "SET",
        enabled:
          overlays.priorHlc
          && snapshot?.gap_fill?.settlement_price != null
          && (levels?.pd_close == null
              || Math.abs(snapshot.gap_fill.settlement_price - levels.pd_close) >= 0.25),
        value: snapshot?.gap_fill?.settlement_price,
        label: "SET", color: palette.ink60, style: LineStyle.Dashed, width: 1,
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
        axisLabelVisible: true,
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
  }, [snapshot?.levels, snapshot?.gap_fill?.settlement_price, overlays.pocVa, overlays.priorHlc, palette]);

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
  // Recompute on every overlayTick (pan/zoom/resize), bars change,
  // or overlay-state change. Returns a list of {top, left, width,
  // height, fill} rectangles to render via absolutely-positioned
  // divs. The chart's canvas-internal coordinate API
  // (timeToCoordinate / priceToCoordinate) gives pixel positions
  // relative to the chart container, so the divs sit cleanly atop
  // the chart canvas.
  const overlayRectangles = useMemo<OverlayRect[]>(() => {
    if (!aggregatedBars || aggregatedBars.length === 0) return [];
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const container = containerRef.current;
    if (!chart || !candleSeries || !container) return [];
    const timeframeMin = TIMEFRAME_MINUTES[timeframe];
    const containerH = container.clientHeight;
    const out: OverlayRect[] = [];

    // ETH shading: one rect per contiguous ETH run, full plot
    // height, ink-100 @ 8% alpha (mirrors desktop's tint).
    const ethRanges = buildEthShadeRanges(aggregatedBars, timeframeMin);
    for (const [s, e] of ethRanges) {
      const t1 = (Math.floor(Date.parse(aggregatedBars[s].time) / 1000) as UTCTimestamp);
      const t2 = (Math.floor(Date.parse(aggregatedBars[e].time) / 1000) as UTCTimestamp);
      const x1 = chart.timeScale().timeToCoordinate(t1);
      const x2 = chart.timeScale().timeToCoordinate(t2);
      if (x1 == null || x2 == null) continue;
      // Clip rectangle to visible plot area: x1 may be negative
      // (off-left), x2 may exceed plot width (off-right).
      const left = Math.max(0, Math.min(x1, x2));
      const right = Math.max(x1, x2);
      const width = right - left;
      if (width <= 0) continue;
      out.push({
        kind: "eth",
        left,
        top: 0,
        width,
        height: containerH,
        fill: hexToRgba(palette.ink100, 0.08),
        label: null,
      });
    }

    // OR bands: one rect per active window, bounded LEFT to today's
    // RTH-open bar, RIGHT to chart's right edge (pinned at the
    // visible-range tail). vol=4% per band, additive when stacked.
    const latestRth = buildLatestRthRange(aggregatedBars, timeframeMin);
    if (latestRth && snapshot?.levels) {
      const lv = snapshot.levels;
      const orBands: { key: string; label: string; low: number | null; high: number | null }[] = [
        { key: "m1", label: "1m", low: lv.or_1m_low, high: lv.or_1m_high },
        { key: "m5", label: "5m", low: lv.or_5m_low, high: lv.or_5m_high },
        { key: "m15", label: "15m", low: lv.or_15m_low, high: lv.or_15m_high },
      ];
      const t1 = (Math.floor(Date.parse(aggregatedBars[latestRth[0]].time) / 1000) as UTCTimestamp);
      const x1 = chart.timeScale().timeToCoordinate(t1);
      // Right edge: use the last visible bar's coordinate, or the
      // container width if that's null.
      const lastBarT = (Math.floor(
        Date.parse(aggregatedBars[aggregatedBars.length - 1].time) / 1000,
      ) as UTCTimestamp);
      const xRight = chart.timeScale().timeToCoordinate(lastBarT) ?? container.clientWidth;
      for (const band of orBands) {
        const enabled = overlays.openingRange[band.key as "m1" | "m5" | "m15"];
        if (!enabled || band.low == null || band.high == null) continue;
        const yHigh = candleSeries.priceToCoordinate(band.high);
        const yLow = candleSeries.priceToCoordinate(band.low);
        if (x1 == null || yHigh == null || yLow == null) continue;
        const top = Math.min(yHigh, yLow);
        const height = Math.abs(yLow - yHigh);
        const left = Math.max(0, x1);
        const width = xRight - left;
        if (width <= 0 || height <= 0) continue;
        out.push({
          kind: "or",
          left,
          top,
          width,
          height,
          fill: hexToRgba(palette.ink100, 0.04),
          label: `OR ${band.label}`,
        });
      }
    }

    return out;
  }, [
    aggregatedBars,
    overlays.openingRange,
    snapshot?.levels,
    timeframe,
    overlayTick,
    palette,
  ]);

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
      {/* ETH-shading + OR-band overlay layer. Sits between the
          chart canvas and the tooltip. pointer-events: none so it
          doesn't block chart-touch interactions. */}
      <div
        ref={overlayRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 2,
        }}
      >
        {overlayRectangles.map((rect, i) => (
          <div
            key={`${rect.kind}-${i}`}
            style={{
              position: "absolute",
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              background: rect.fill,
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "var(--ink-60)",
              padding: rect.label ? "1px 4px" : 0,
              boxSizing: "border-box",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {rect.label}
          </div>
        ))}
      </div>
      {tooltip && (
        <ChartTooltip tooltip={tooltip} tzLabel={tzLabel} formatBarTime={formatBarTime} />
      )}
    </div>
  );
}

interface OverlayRect {
  kind: "eth" | "or";
  left: number;
  top: number;
  width: number;
  height: number;
  fill: string;
  label: string | null;
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
  sessionVwap: number | null;
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
      {tooltip.sessionVwap != null && (
        <div style={{ opacity: 0.7 }}>VWAP {tooltip.sessionVwap.toFixed(2)}</div>
      )}
    </div>
  );
}

// `aggregateBars` and `resolveLumenPalette` moved to `./chartHelpers`
// for sharing with the desktop chart. Imported above.

export default MobileChartCanvas;
