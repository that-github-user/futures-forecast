/**
 * MarkupReviewChart — SPX 1-min candles (lightweight-charts v5) with markup
 * alert markers. Up-arrows (call → spot UP) below the bar, down-arrows (put →
 * DOWN) above, clustered ×N per bar. Styling is CAUSAL — color = at-fire
 * conviction tier, size = ask magnitude, hollow circle = CAUTION/trap — never the
 * outcome (see buildMarkers / quotemark docs/signal_arrow_styling.md). Hover a bar
 * with alerts → an imperative tooltip (σ / strike / dist-from-ATM / MFE / MAE /
 * status — the OUTCOME, shown for comparison), off the crosshair time → alert index.
 *
 * Markers + tooltip derive from the ALREADY-FILTERED alerts the pane passes in,
 * so a filter change is just `setMarkers(...)` — no refetch, no chart rebuild.
 */

import { useCallback, useEffect, useRef } from "react";
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
  conviction,
  indexByBarTime,
  isoToUtc,
  minSinceOpenET,
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

// Axis/crosshair times are ET (US market) — Lightweight Charts defaults to UTC
// for UTCTimestamp data, so format explicitly. `sec` is epoch seconds.
const ET_HM = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const etHM = (sec: number): string => ET_HM.format(new Date(sec * 1000));

/** TradingView-style OHLC legend HTML for one bar. The OHLC values are colored
 *  with the SAME palette colors that draw the candles (up/down), so the legend
 *  always matches the bar — colors are passed in from resolveLumenPalette (no
 *  user input, so the inline style is injection-safe). */
function legendHtml(
  bar: CandlestickData,
  sec: number | null,
  upColor: string,
  downColor: string,
): string {
  const color = bar.close >= bar.open ? upColor : downColor;
  const f = (v: number) => v.toFixed(2);
  const t = sec != null ? `<span class="mr-legend__t">${etHM(sec)} ET</span>` : "";
  const v = (label: string, n: number) =>
    `<span class="mr-legend__v" style="color:${color}">${label} ${f(n)}</span>`;
  return `${t}${v("O", bar.open)}${v("H", bar.high)}${v("L", bar.low)}${v("C", bar.close)}`;
}

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
  // Causal conviction tier per direction-cluster — explains the marker styling
  // (color/shape) the viewer is hovering. Computed from at-fire features only.
  const chips = (["up", "down"] as const)
    .map((d) => hits.filter((h) => h.direction === d))
    .filter((g) => g.length > 0)
    .map((g) => {
      const tier = conviction({
        clusterSize: g.length,
        maxAskJump: g.reduce((m, h) => Math.max(m, h.ask_jump ?? 0), 0),
        minSinceOpen: minSinceOpenET(g[0].bar_time),
        atmOnly: g.every((h) => h.dist_from_atm === 0),
      }).tier;
      const arrow = g[0].direction === "up" ? "▲" : "▼";
      return `<span class="mr-tip__conv mr-tip__conv--${tier}">${arrow} ${tier.toUpperCase()}</span>`;
    })
    .join("");
  return `<div class="mr-tip__hd">${hits.length} alert${hits.length > 1 ? "s" : ""} ${chips}</div>${rows}`;
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
  // OHLC legend (top-left): shows the hovered bar, or the latest bar when not
  // hovering (TradingView-style).
  const legendRef = useRef<HTMLDivElement>(null);
  const lastBarRef = useRef<CandlestickData | null>(null);
  const hoveringRef = useRef(false);
  // Candle up/down colors (from the palette) so the legend matches the bars.
  const colorsRef = useRef<{ up: string; down: string }>({ up: "", down: "" });

  /** Paint the legend with the latest bar (used when not hovering). */
  const paintLastBar = useCallback(() => {
    const legend = legendRef.current;
    if (!legend) return;
    // Palette colors are set in the create-chart effect, which runs before the
    // bars/liveBar effects (effects fire in declaration order). Guard anyway so
    // a future reorder can't paint the legend with empty inline colors.
    if (!colorsRef.current.up || !colorsRef.current.down) return;
    const bar = lastBarRef.current;
    legend.innerHTML = bar
      ? legendHtml(
          bar,
          Number.isFinite(lastBarTimeRef.current) ? lastBarTimeRef.current : null,
          colorsRef.current.up,
          colorsRef.current.down,
        )
      : "";
  }, []);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const p = resolveLumenPalette();
    colorsRef.current = { up: p.posCream, down: p.negPersimmon };
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
        // ET axis labels (US market) — default is UTC for UTCTimestamp data.
        tickMarkFormatter: (time: Time): string =>
          typeof time === "number" ? etHM(time) : "",
      },
      // ET crosshair time label (bottom axis).
      localization: {
        timeFormatter: (time: Time): string =>
          typeof time === "number" ? `${etHM(time)} ET` : "",
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
      // OHLC legend: the hovered bar, or revert to the latest when off-data.
      const series = seriesRef.current;
      const bar =
        series && typeof param.time === "number"
          ? (param.seriesData.get(series) as CandlestickData | undefined)
          : undefined;
      if (bar && legendRef.current) {
        hoveringRef.current = true;
        legendRef.current.innerHTML = legendHtml(
          bar,
          param.time as number,
          colorsRef.current.up,
          colorsRef.current.down,
        );
      } else {
        hoveringRef.current = false;
        paintLastBar();
      }

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
      // Keep clear of the top-left OHLC legend on a near-top hover.
      tip.style.top = `${Math.max(28, param.point.y + 12)}px`;
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
    // paintLastBar is a stable useCallback([]) — listed to satisfy
    // exhaustive-deps; the chart is still created exactly once.
  }, [paintLastBar]);

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
    lastBarRef.current = data.length > 0 ? data[data.length - 1] : null;
    if (!hoveringRef.current) paintLastBar();
    chart.timeScale().fitContent();
  }, [bars, paintLastBar]);

  // Live forming candle → incremental series.update() (no rebuild, no fit, so
  // the operator's pan/zoom is preserved). Monotonic guard: never update a bar
  // older than the newest on the series. As the minute rolls, liveBar's later
  // time appends a fresh bar; the prior one persists.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !liveBar) return;
    if (liveBar.time < lastBarTimeRef.current) return;
    const candle: CandlestickData = {
      time: liveBar.time as UTCTimestamp,
      open: liveBar.open,
      high: liveBar.high,
      low: liveBar.low,
      close: liveBar.close,
    };
    series.update(candle);
    lastBarTimeRef.current = liveBar.time;
    lastBarRef.current = candle;
    if (!hoveringRef.current) paintLastBar(); // keep the legend on the live bar
  }, [liveBar, paintLastBar]);

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
      <div
        ref={legendRef}
        className="markup-review-chart__legend mr-legend"
        aria-hidden="true"
      />
      <div ref={tooltipRef} className="markup-review-chart__tooltip mr-tip" />
    </div>
  );
}
