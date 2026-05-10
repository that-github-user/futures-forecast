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
import type { OverlayState, Timeframe } from "./chartTypes";

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
  // Active price-lines indexed by stable key — allows incremental
  // create/remove on overlay-toggle changes without rebuilding the
  // whole chart.
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  // Tooltip state.
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
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
        // Reserve generous horizontal width for the level chips
        // to render fully. The widest chip is e.g.
        // "PDH 5912.50" — at the chart's default ~12px font that's
        // ~95px including chip padding. A previous floor of 80
        // wasn't enough and the user reported labels still being
        // cut off on a 360px-wide phone. 110 gives comfortable
        // headroom for any of POC/VAH/VAL/PDH/PDL/PDC/SET plus
        // their 2-decimal price values, plus the price-axis tick
        // labels (e.g. "5910.0") that share the same scale.
        minimumWidth: 110,
        // autoScale: true (the default) — price scale auto-fits
        // the visible time-range's price extents on every pan/zoom.
        // Pinned explicitly here so a future maintainer reading
        // the option block sees the contract documented.
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

    // Auto-resize on container size change (orientation flip,
    // browser-zoom, sidebar collapse).
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    });
    ro.observe(container);

    // Capture priceLinesRef in a local so the cleanup doesn't read
    // a stale ref that may have changed by unmount time (lint:
    // react-hooks/exhaustive-deps).
    const priceLinesAtMount = priceLinesRef.current;
    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      sessionVwapSeriesRef.current = null;
      priceLinesAtMount.clear();
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

// ── Helpers (replicated from TerminalChartCanvas to avoid risking
// the desktop file with a cross-component refactor; consolidate to a
// shared module in PR 2) ────────────────────────────────────────────

function aggregateBars(
  bars: TerminalIntradayBar[],
  minutes: number,
): TerminalIntradayBar[] {
  if (minutes <= 1 || bars.length === 0) return bars;
  const intervalMs = minutes * 60_000;
  const buckets = new Map<number, TerminalIntradayBar[]>();
  for (const b of bars) {
    const t = Date.parse(b.time);
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / intervalMs) * intervalMs;
    let group = buckets.get(key);
    if (!group) {
      group = [];
      buckets.set(key, group);
    }
    group.push(b);
  }
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
  const out: TerminalIntradayBar[] = [];
  for (const key of sortedKeys) {
    const group = buckets.get(key)!;
    if (group.length === 0) continue;
    const time = new Date(key).toISOString().replace(/\.\d{3}Z$/, "Z");
    let high = group[0].high;
    let low = group[0].low;
    let volume = 0;
    for (const b of group) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume;
    }
    out.push({
      time,
      open: group[0].open,
      high,
      low,
      close: group[group.length - 1].close,
      volume,
    });
  }
  return out;
}

function resolveLumenPalette() {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const cs = root ? getComputedStyle(root) : null;
  const tok = (name: string, fallback: string): string => {
    const v = cs?.getPropertyValue(name).trim();
    return v && v.length > 0 ? v : fallback;
  };
  return {
    posCream: tok("--pos-cream", "#10b981"),
    negPersimmon: tok("--neg-persimmon", "#ef4444"),
    paperDeep: tok("--paper-deep", "#0f172a"),
    ink100: tok("--ink-100", "#f8fafc"),
    ink80: tok("--ink-80", "#e2e8f0"),
    ink60: tok("--ink-60", "#94a3b8"),
    ink40: tok("--ink-40", "#475569"),
    ink20: tok("--ink-20", "#1e293b"),
  };
}

export default MobileChartCanvas;
