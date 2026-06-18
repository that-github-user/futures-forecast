/**
 * MarkupReviewChart — SPX 1-min candles (lightweight-charts v5) with markup
 * alert markers. Green up-arrows (call → spot UP) below the bar, red
 * down-arrows (put → DOWN) above, MFE-encoded by size, clustered ×N per bar.
 * Hover a bar with alerts → an imperative tooltip (σ / strike / dist-from-ATM /
 * MFE / MAE / status), driven off the crosshair time → alert index.
 *
 * Markers + tooltip derive from the ALREADY-FILTERED alerts the pane passes in,
 * so a filter change is just `setMarkers(...)` — no refetch, no chart rebuild.
 */

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { resolveLumenPalette } from "../terminal/chartHelpers";
import type { LiveCandle } from "../../hooks/liveMarkupHelpers";
import type {
  MarkupReviewAlert,
  TerminalIntradayBar,
} from "../../api/terminalTypes";
import {
  buildMarkers,
  indexByBarTime,
  isoToUtc,
} from "./markupReviewHelpers";

interface Props {
  bars: TerminalIntradayBar[];
  /** Already-filtered alerts; markers + tooltip derive from these. */
  alerts: MarkupReviewAlert[];
  /** Current forming 1-min candle from the live SSE spot stream (today only).
   *  Applied via series.update() for a smooth live bar without a rebuild;
   *  null for past sessions / when no live data. */
  liveBar?: LiveCandle | null;
}

const fmt = (v: number | null, d = 1): string =>
  v == null ? "—" : v.toFixed(d);

const etTime = (iso: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));

/** Build the tooltip HTML. Only enum/number fields are interpolated — no
 *  free-text — so there is no injection surface on the trusted API payload. */
function tooltipHtml(hits: MarkupReviewAlert[]): string {
  const rows = hits
    .map((a) => {
      const dirCls = a.direction === "up" ? "up" : "down";
      const arrow = a.direction === "up" ? "▲" : "▼";
      const dist =
        a.dist_from_atm == null
          ? "—"
          : `${a.dist_from_atm > 0 ? "+" : ""}${a.dist_from_atm}`;
      const outcome =
        a.status === "finalized"
          ? `MFE ${fmt(a.mfe)} · MAE ${fmt(a.mae)} · t→ ${fmt(a.t_mfe_s, 0)}s`
          : a.status;
      return `<div class="mr-tip__row">
        <span class="mr-tip__dir ${dirCls}">${arrow} ${a.side}</span>
        <span class="mr-tip__t">${etTime(a.alert_ts)} ET</span>
        <span>K ${a.strike ?? "—"} · Δatm ${dist} · σ ${fmt(a.spread_z)}</span>
        <span class="mr-tip__out">${outcome}</span>
      </div>`;
    })
    .join("");
  return `<div class="mr-tip__hd">${hits.length} alert${hits.length > 1 ? "s" : ""}</div>${rows}`;
}

export function MarkupReviewChart({ bars, alerts, liveBar }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const indexRef = useRef<Map<number, MarkupReviewAlert[]>>(new Map());
  // Newest bar time on the series (seed or live) — series.update() must never
  // be called with an older time, so live ticks below this are dropped.
  const lastBarTimeRef = useRef<number>(-Infinity);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const p = resolveLumenPalette();
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: p.paperDeep }, textColor: p.ink60 },
      grid: { vertLines: { color: p.ink20 }, horzLines: { color: p.ink20 } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: p.ink20 },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: p.ink20,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: p.posCream,
      downColor: p.negPersimmon,
      wickUpColor: p.posCream,
      wickDownColor: p.negPersimmon,
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

    const onMove = (param: MouseEventParams<Time>) => {
      const tip = tooltipRef.current;
      if (!tip) return;
      // param.time is a UTCTimestamp (number) for this intraday time-scale
      // chart; guard the cast so a non-numeric Time (BusinessDay) can't NaN the
      // Map lookup and silently drop tooltips.
      const hits =
        typeof param.time === "number"
          ? indexRef.current.get(param.time)
          : undefined;
      if (!hits || !hits.length || !param.point) {
        tip.style.display = "none";
        return;
      }
      tip.innerHTML = tooltipHtml(hits);
      tip.style.display = "block";
      const w = el.clientWidth;
      tip.style.left = `${Math.max(8, Math.min(param.point.x + 14, w - 248))}px`;
      tip.style.top = `${Math.max(8, param.point.y + 12)}px`;
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Bars → setData + fit.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const data: CandlestickData[] = bars.map((b) => ({
      time: isoToUtc(b.time),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    series.setData(data);
    lastBarTimeRef.current =
      data.length > 0 ? (data[data.length - 1].time as number) : -Infinity;
    chart.timeScale().fitContent();
  }, [bars]);

  // Live forming candle → incremental series.update() (no rebuild, no fit, so
  // the operator's pan/zoom is preserved). Monotonic guard: never update a bar
  // older than the newest on the series. As the minute rolls, liveBar's later
  // time appends a fresh bar; the prior one persists.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !liveBar) return;
    if (liveBar.time < lastBarTimeRef.current) return;
    series.update({
      time: liveBar.time as UTCTimestamp,
      open: liveBar.open,
      high: liveBar.high,
      low: liveBar.low,
      close: liveBar.close,
    });
    lastBarTimeRef.current = liveBar.time;
  }, [liveBar]);

  // Alerts → markers + crosshair index.
  useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;
    indexRef.current = indexByBarTime(alerts);
    const built = buildMarkers(alerts).map(
      (m): SeriesMarker<Time> => ({
        time: m.time,
        position: m.position,
        color: m.color,
        shape: m.shape,
        size: m.size,
        text: m.text,
      }),
    );
    markers.setMarkers(built);
  }, [alerts]);

  return (
    <div className="markup-review-chart">
      <div ref={containerRef} className="markup-review-chart__canvas" />
      <div ref={tooltipRef} className="markup-review-chart__tooltip mr-tip" />
    </div>
  );
}
