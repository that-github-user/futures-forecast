/**
 * MarkupReviewChart — SPX 1-min candles (lightweight-charts v5) with markup
 * alert markers. Up-arrows (call → spot UP) below the bar, down-arrows (put →
 * DOWN) above, clustered ×N per bar. Styling is CAUSAL — color = at-fire
 * conviction tier, size = ask magnitude, grey circle = CAUTION/trap — never the
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
  /** The live SSE spot window's 1-min candles (today only), ASCENDING by time —
   *  the newest is the forming bar, the ones before it are the window's settled
   *  minutes. Normally applied via series.update() for a smooth live tail
   *  without a rebuild; empty for past sessions / when there's no live data.
   *  Ascending is a contract, not a convenience: it is what lets a late-covered
   *  minute be drawn BEFORE the newer one and keeps the rebuild path (see the
   *  live effect) to the rare out-of-order repair. */
  liveBars?: LiveCandle[];
  /** Identifies the SESSION on screen (`date|tf`). fitContent() runs only when
   *  this changes — see the bars effect — and the retained live candles belong
   *  to it. */
  fitKey: string;
  /** Bumped by the operator's explicit ↻. The manual refresh no longer flashes
   *  the loading state (that is what stops the 60s background poll blanking the
   *  pane), so it no longer remounts the chart either — and the remount was what
   *  used to re-fit. Without this there is no way back to a fitted view once the
   *  session has grown under a zoom set early in the day. */
  refitToken?: number;
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
      const c = conviction({
        clusterSize: g.length,
        maxAskJump: g.reduce((m, h) => Math.max(m, h.ask_jump ?? 0), 0),
        minSinceOpen: minSinceOpenET(g[0].bar_time),
        atmOnly: g.every((h) => h.dist_from_atm === 0),
      });
      const arrow = g[0].direction === "up" ? "▲" : "▼";
      const muted = c.muted ? " · muted" : "";
      return `<span class="mr-tip__conv mr-tip__conv--${c.tier}">${arrow} ${c.tier.toUpperCase()}${muted}</span>`;
    })
    .join("");
  return `<div class="mr-tip__hd">${hits.length} alert${hits.length > 1 ? "s" : ""} ${chips}</div>${rows}`;
}

export function MarkupReviewChart({
  bars,
  alerts,
  liveBars,
  fitKey,
  refitToken = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const indexRef = useRef<Map<number, MarkupReviewAlert[]>>(new Map());
  // Newest bar time on the series (fetched or live) — series.update() cannot
  // reach behind it, so a live candle below this needs a rebuild.
  const lastBarTimeRef = useRef<number>(-Infinity);
  // The last setData payload from `bars` and its newest time. An IBKR bar always
  // outranks the live candle for the same minute: the live one is bucketed from
  // client-visible spot samples only, so its open is the first sample AFTER the
  // minute started and its high/low miss every excursion between samples — on a
  // pane whose job is reading MFE/MAE against bar range, that is the wrong high.
  const fetchedRef = useRef<CandlestickData[]>([]);
  const fetchedTailRef = useRef<number>(-Infinity);
  // Live candles drawn past the fetched tail, keyed by minute. Retained because
  // today's session is re-fetched every 60s and setData() would otherwise wipe
  // every minute the IBKR bars have not reached yet — and a wiped minute that has
  // since aged into the spot window's (suppressed) partial-oldest bucket can
  // never be re-offered, so the wipe would blink a candle out until IBKR catches
  // up.
  const liveDrawnRef = useRef<Map<number, CandlestickData>>(new Map());
  // The session the retained live candles belong to.
  const sessionKeyRef = useRef<string | null>(null);
  // The fit target the time scale was last fitted for — a background refetch of
  // the SAME session must not re-fit (see the bars effect).
  const fittedKeyRef = useRef<string | null>(null);
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
    // bars/liveBars effects (effects fire in declaration order). Guard anyway so
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

  /** The full series content: the fetched bars plus the live minutes past their
   *  tail, ascending. Rebuilding with this is the ONLY way to place a candle
   *  BEHIND the newest one already drawn — series.update() cannot reach back,
   *  and that one-way door is what made the missing 10:47 candle permanent. It
   *  is affordable now that fitContent() is gated on the session: a rebuild no
   *  longer costs the operator's pan/zoom, which was the reason update() was the
   *  only writer. */
  const composeSeries = useCallback((): CandlestickData[] => {
    const live = [...liveDrawnRef.current.values()].sort(
      (a, b) => (a.time as number) - (b.time as number),
    );
    return [...fetchedRef.current, ...live];
  }, []);

  /** Stamp the newest bar on the series — the monotonic-guard reference and the
   *  legend source. Every retained live candle sits past the fetched tail by
   *  construction, so the newest of those IS the series tail whenever any
   *  survive. */
  const syncTail = useCallback(() => {
    let tail: CandlestickData | null = null;
    for (const c of liveDrawnRef.current.values()) {
      if (!tail || (c.time as number) > (tail.time as number)) tail = c;
    }
    if (!tail) {
      const fetched = fetchedRef.current;
      tail = fetched.length > 0 ? fetched[fetched.length - 1] : null;
    }
    lastBarTimeRef.current = tail ? (tail.time as number) : -Infinity;
    lastBarRef.current = tail;
    if (!hoveringRef.current) paintLastBar();
  }, [paintLastBar]);

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
    // The fitted-target ref describes THIS chart instance, not the component: a
    // recreated chart (StrictMode double-invokes every effect in dev) starts
    // with an unfitted time scale, and a ref left stamped by the discarded
    // instance would suppress the fit on the one actually on screen.
    fittedKeyRef.current = null;

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

  // Bars → setData, and fit ONLY on a session change or an explicit ↻. setData
  // still runs on every `bars` change — that is how the authoritative IBKR bar
  // replaces the live approximation — but the session is re-fetched every 60s
  // while viewing today, and fitting on each of those would yank the operator's
  // pan/zoom back to fit once a minute.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    if (sessionKeyRef.current !== fitKey) {
      // Retained live candles are stamped in TODAY's clock; another session must
      // not inherit them.
      sessionKeyRef.current = fitKey;
      liveDrawnRef.current.clear();
    }
    const data: CandlestickData[] = bars.map((b) => ({
      time: isoToUtc(b.time),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    fetchedRef.current = data;
    fetchedTailRef.current =
      data.length > 0 ? (data[data.length - 1].time as number) : -Infinity;
    // Retire the live approximation up to the fetched TAIL. The boundary is the
    // tail, not per-minute membership: composeSeries concatenates `[...fetched,
    // ...live]`, which is only ascending while every retained live minute sits
    // past the tail. So a hole INSIDE the fetched range — a gappy IBKR payload,
    // as opposed to the SSE gap this file exists to heal — retires the live
    // candle that could have filled it and waits for a later payload to carry
    // the bar. Filling it here would mean a real merge-sort with dedup, and
    // setData's ascending assert is stripped from the production bundle, so a
    // mistake there corrupts the series silently.
    for (const t of liveDrawnRef.current.keys()) {
      if (t <= fetchedTailRef.current) liveDrawnRef.current.delete(t);
    }
    series.setData(composeSeries());
    syncTail();
    // Fitting an EMPTY series is a no-op, so stamping the target there would
    // record the session as fitted and skip the fit when the bars actually
    // arrive — the pane renders this chart on alerts alone when the bars are
    // stale, so that is a reachable first payload.
    const fitTarget = `${fitKey}#${refitToken}`;
    if (data.length > 0 && fittedKeyRef.current !== fitTarget) {
      fittedKeyRef.current = fitTarget;
      chart.timeScale().fitContent();
    }
  }, [bars, fitKey, refitToken, composeSeries, syncTail]);

  // Live window candles → incremental series.update(), or a rebuild when one
  // reaches BACK behind the newest drawn bar. Walking the window ASCENDING heals
  // a hole in the same pass — the late-covered minute is applied before the
  // newer one, so update() takes both. The rebuild covers the case that ordering
  // can't: a `spot` event advancing the drawn minute past the hole BEFORE the
  // `state` event carrying the repair arrives (the SSE queue drops states first —
  // spots are ~10x more frequent), which would otherwise leave the hole to the
  // 60s poll.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !liveBars?.length) return;
    let changed = false;
    let rebuild = false;
    for (const lb of liveBars) {
      // An IBKR bar already covers this minute — never overwrite truth with the
      // spot approximation (see fetchedTailRef). This is NOT the clamp
      // liveSessionCandles rejects: that one referenced the last DRAWN bar,
      // which only advances when a bar is drawn and so could freeze the overlay
      // permanently. This reference advances from the API alone, and a hole is
      // by definition PAST it, so healing is unaffected.
      if (lb.time <= fetchedTailRef.current) continue;
      const candle: CandlestickData = {
        time: lb.time as UTCTimestamp,
        open: lb.open,
        high: lb.high,
        low: lb.low,
        close: lb.close,
      };
      const drawn = liveDrawnRef.current.get(lb.time);
      if (
        drawn &&
        drawn.open === candle.open &&
        drawn.high === candle.high &&
        drawn.low === candle.low &&
        drawn.close === candle.close
      ) {
        continue;
      }
      liveDrawnRef.current.set(lb.time, candle);
      changed = true;
      if (lb.time < lastBarTimeRef.current) rebuild = true;
      else series.update(candle);
    }
    if (!changed) return;
    if (rebuild) series.setData(composeSeries());
    syncTail(); // keep the legend on the live bar
  }, [liveBars, composeSeries, syncTail]);

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
