/**
 * FanChart — centerpiece visualization.
 *
 * Shows recent candles (history) + forecast percentile bands.
 * Gradient bands: P10-P90 (outer), P25-P75 (inner), bold P50 median.
 * Color tint shifts green/red based on signal direction.
 * Supports multiple timeframes via candle aggregation + forecast subsampling.
 */

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart, CandlestickChart, CustomChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatHorizon } from "../../api/format";
import type { HindcastPrediction, PredictionResponse } from "../../api/types";
import type { Timeframe } from "../../api/timeframe";
import { getContextCandles, subsampleForecast } from "../../api/timeframe";
import { findBestMatchPaths } from "../../api/pathMatch";

echarts.use([
  LineChart,
  CandlestickChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export type ChartType = "line" | "candlestick" | "ohlc";
export type ForecastStyle = "bands" | "spaghetti";

interface Props {
  prediction: PredictionResponse;
  chartType?: ChartType;
  forecastStyle?: ForecastStyle;
  timeframe?: Timeframe;
  hindcast?: HindcastPrediction[];
  showHindcast?: boolean;
}

export function FanChart({
  prediction,
  chartType = "line",
  forecastStyle = "bands",
  timeframe = "5m",
  hindcast,
  showHindcast = false,
}: Props) {
  const { last_close, signal } = prediction;

  // ── Timeframe transformation ──
  const rawCandles = prediction.context_candles ?? [];
  // Aggregate context candles to the selected timeframe
  const candles = getContextCandles(rawCandles, timeframe);
  // Subsample forecast data to match timeframe resolution
  const { horizons, percentiles, samplePaths: sample_paths } = subsampleForecast(prediction, timeframe);
  // Last raw 5m bar time — used for delay calculation independent of timeframe
  const lastRawBarTime = rawCandles.length ? rawCandles[rawCandles.length - 1].time : 0;

  const isLong = signal.direction === "LONG";
  const isShort = signal.direction === "SHORT";

  // Color scheme based on direction
  const bandColor = isLong
    ? "rgba(16, 185, 129, "
    : isShort
      ? "rgba(239, 68, 68, "
      : "rgba(59, 130, 246, ";
  const medianColor = isLong ? "#10b981" : isShort ? "#ef4444" : "#3b82f6";

  // Build time axis: context candles + forecast horizons
  const contextTimes: string[] = candles.map((c) => {
    const d = new Date(c.time * 1000);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  });

  // Forecast times (offset from last context bar, 5 min per original bar)
  const lastTime = candles.length
    ? candles[candles.length - 1].time
    : Math.floor(Date.now() / 1000);

  const forecastTimes = horizons.map((h) => {
    const d = new Date((lastTime + h * 300) * 1000);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  });

  const allTimes = [...contextTimes, ...forecastTimes];
  const ctxLen = contextTimes.length;

  // Context price data (all OHLC for candlestick/ohlc modes)
  const contextCloses: (number | null)[] = candles.map((c) => c.close);
  // Candlestick data: [open, close, low, high]
  const contextOHLC = candles.map((c) => [c.open, c.close, c.low, c.high]);
  // Pad context for forecast-only series
  const ctxPad: null[] = new Array(ctxLen).fill(null);

  // Forecast series data — each percentile line needs ctx padding + values
  const makeForcastSeries = (key: keyof typeof percentiles) => [
    ...ctxPad,
    ...percentiles[key],
  ];

  // Compute explicit y-axis bounds from all visible data
  const allPrices: number[] = [];
  candles.forEach((c) => { allPrices.push(c.high, c.low); });
  percentiles.p10.forEach((v) => allPrices.push(v));
  percentiles.p90.forEach((v) => allPrices.push(v));
  // Include sample paths in bounds to prevent axis jumps when toggling spaghetti
  if (forecastStyle === "spaghetti" && sample_paths?.length) {
    for (const path of sample_paths) {
      for (const v of path) {
        allPrices.push(v);
      }
    }
  }
  const yMin = Math.min(...allPrices);
  const yMax = Math.max(...allPrices);
  const yPad = (yMax - yMin) * 0.05 || 5;

  const option: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293be8",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      axisPointer: {
        type: "cross",
        crossStyle: { color: "#94a3b8", width: 1, type: "dashed" },
        lineStyle: { color: "#94a3b8", width: 1, type: "dashed" },
        label: {
          backgroundColor: "#1e293b",
          borderColor: "#334155",
          color: "#e2e8f0",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
          formatter: (params: { axisDimension: string; value: string | number }) => {
            if (params.axisDimension === "y") {
              return Number(params.value).toFixed(2);
            }
            return String(params.value);
          },
        },
      },
      formatter: (params: unknown) => {
        const items = params as { seriesName: string; value: number | null; axisValue: string; dataIndex: number }[];
        if (!items?.length) return "";
        const time = items[0].axisValue;
        const dataIndex = items[0].dataIndex;
        const inContext = dataIndex >= 0 && dataIndex < ctxLen;
        const price = inContext ? items.find(i => i.seriesName === "Price" && i.value !== null) : null;
        const median = items.find(i => i.seriesName === "Median" && i.value !== null);

        if (inContext && price?.value != null) {
          // For candlestick/ohlc, look up full OHLC from context
          if (dataIndex >= 0 && dataIndex < candles.length && chartType !== "line") {
            const c = candles[dataIndex];
            const chg = c.close - c.open;
            const chgPct = ((chg / c.open) * 100).toFixed(2);
            const chgColor = chg >= 0 ? "#10b981" : "#ef4444";
            return [
              `<b>${time}</b>`,
              `O: ${c.open.toFixed(2)}`,
              `H: ${c.high.toFixed(2)}`,
              `L: ${c.low.toFixed(2)}`,
              `C: ${c.close.toFixed(2)}`,
              `<span style="color:${chgColor}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${chgPct}%)</span>`,
            ].join("<br/>");
          }
          return `<b>${time}</b><br/>Price: ${(typeof price.value === "number" ? price.value : 0).toFixed(2)}`;
        }
        if (median?.value) {
          // Use dataIndex to compute forecast index deterministically
          const forecastIdx = dataIndex - ctxLen;
          if (forecastIdx >= 0 && forecastIdx < horizons.length) {
            const p10 = percentiles.p10[forecastIdx];
            const p25 = percentiles.p25[forecastIdx];
            const p50 = percentiles.p50[forecastIdx];
            const p75 = percentiles.p75[forecastIdx];
            const p90 = percentiles.p90[forecastIdx];
            const delta = ((p50 - last_close) / last_close * 100).toFixed(2);
            return [
              `<b>${time}</b> (+${formatHorizon(horizons[forecastIdx])})`,
              `<span style="color:#64748b">P90:</span> ${p90.toFixed(2)}`,
              `<span style="color:#94a3b8">P75:</span> ${p75.toFixed(2)}`,
              `<b>P50: ${p50.toFixed(2)}</b> <span style="color:#64748b">(${delta}%)</span>`,
              `<span style="color:#94a3b8">P25:</span> ${p25.toFixed(2)}`,
              `<span style="color:#64748b">P10:</span> ${p10.toFixed(2)}`,
              `<span style="color:#475569">Spread: ${(p90 - p10).toFixed(1)} pts</span>`,
            ].join("<br/>");
          }
        }
        return `<b>${time}</b>`;
      },
    },
    grid: {
      left: 70,
      right: 20,
      top: 20,
      bottom: 40,
    },
    xAxis: {
      type: "category",
      data: allTimes,
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: {
        color: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        interval: Math.floor(allTimes.length / 8),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      min: Math.floor(yMin - yPad),
      max: Math.ceil(yMax + yPad),
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: {
        color: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
        formatter: (v: number) => v.toFixed(1),
      },
      splitLine: { lineStyle: { color: "#1e293b" } },
      axisPointer: {
        show: true,
        snap: false,
        label: {
          show: true,
          formatter: (params: { value: number }) => params.value.toFixed(2),
          backgroundColor: "#1e293b",
          borderColor: "#334155",
          color: "#e2e8f0",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
        },
      },
    },
    series: [
      // Context price data — varies by chart type
      ...(chartType === "candlestick"
        ? [
            {
              name: "Price",
              type: "candlestick" as const,
              data: [
                ...contextOHLC,
                ...new Array(horizons.length).fill([]),
              ],
              itemStyle: {
                color: "#10b981",
                color0: "#ef4444",
                borderColor: "#10b981",
                borderColor0: "#ef4444",
              },
              barWidth: "60%",
              z: 10,
            },
          ]
        : chartType === "ohlc"
          ? [
              {
                name: "Price",
                type: "custom" as const,
                data: [
                  ...candles.map((c) => [c.open, c.high, c.low, c.close]),
                  ...new Array(horizons.length).fill([]),
                ],
                renderItem: (
                  params: { dataIndex: number; coordSys: { x: number; width: number } },
                  api: {
                    value: (i: number) => number;
                    coord: (v: [number, number]) => [number, number];
                    style: (opts: Record<string, unknown>) => Record<string, unknown>;
                  },
                ) => {
                  const idx = params.dataIndex;
                  if (idx >= ctxLen) return;
                  const open = api.value(0);
                  const high = api.value(1);
                  const low = api.value(2);
                  const close = api.value(3);
                  const bullish = close >= open;
                  const color = bullish ? "#10b981" : "#ef4444";
                  const highPt = api.coord([idx, high]);
                  const lowPt = api.coord([idx, low]);
                  const openPt = api.coord([idx, open]);
                  const closePt = api.coord([idx, close]);
                  const tickW = 4;
                  return {
                    type: "group" as const,
                    children: [
                      {
                        type: "line" as const,
                        shape: { x1: highPt[0], y1: highPt[1], x2: lowPt[0], y2: lowPt[1] },
                        style: { stroke: color, lineWidth: 1 },
                      },
                      {
                        type: "line" as const,
                        shape: { x1: openPt[0] - tickW, y1: openPt[1], x2: openPt[0], y2: openPt[1] },
                        style: { stroke: color, lineWidth: 1.5 },
                      },
                      {
                        type: "line" as const,
                        shape: { x1: closePt[0], y1: closePt[1], x2: closePt[0] + tickW, y2: closePt[1] },
                        style: { stroke: color, lineWidth: 1.5 },
                      },
                    ],
                  };
                },
                encode: { x: -1, y: [0, 1, 2, 3] },
                z: 10,
              },
            ]
          : [
              {
                name: "Price",
                type: "line" as const,
                data: [...contextCloses, ...new Array(horizons.length).fill(null)],
                lineStyle: { color: "#e2e8f0", width: 1.5 },
                symbol: "none",
                z: 10,
              },
            ]),
      // Last close → first forecast connection
      {
        name: "Bridge",
        type: "line",
        data: (() => {
          const d: (number | null)[] = new Array(allTimes.length).fill(null);
          if (ctxLen > 0) d[ctxLen - 1] = last_close;
          if (ctxLen < allTimes.length) d[ctxLen] = percentiles.p50[0];
          return d;
        })(),
        lineStyle: { color: medianColor, width: 2, type: "dashed" },
        symbol: "none",
        z: 10,
      },
      // Forecast visualization — bands or spaghetti
      ...(forecastStyle === "spaghetti" && sample_paths?.length
        ? [
            // Individual sample trajectories
            ...(sample_paths).map((path, si) => ({
              name: si === 0 ? "Sample" : "",
              type: "line" as const,
              data: [...ctxPad, ...path],
              lineStyle: { color: bandColor + "0.2)", width: 0.8 },
              symbol: "none" as const,
              smooth: 0.3,
              z: 1,
              silent: true,
            })),
            // P50 median line on top of spaghetti
            {
              name: "Median",
              type: "line" as const,
              data: makeForcastSeries("p50"),
              lineStyle: { color: medianColor, width: 2.5 },
              symbol: "none" as const,
              smooth: 0.3,
              z: 5,
            },
          ]
        : [
            // P10 (lower bound for outer band)
            {
              name: "P10",
              type: "line" as const,
              data: makeForcastSeries("p10"),
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: "outer",
              areaStyle: { color: "transparent" },
              z: 1,
            },
            // P90 - P10 fill (outer band)
            {
              name: "P90",
              type: "line" as const,
              data: makeForcastSeries("p90").map((v, i) => {
                const p10 = makeForcastSeries("p10")[i];
                if (v === null || p10 === null) return null;
                return v - p10;
              }),
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: "outer",
              areaStyle: { color: bandColor + "0.12)" },
              z: 1,
            },
            // P25 (lower bound for inner band)
            {
              name: "P25",
              type: "line" as const,
              data: makeForcastSeries("p25"),
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: "inner",
              areaStyle: { color: "transparent" },
              z: 2,
            },
            // P75 - P25 fill (inner band)
            {
              name: "P75",
              type: "line" as const,
              data: makeForcastSeries("p75").map((v, i) => {
                const p25 = makeForcastSeries("p25")[i];
                if (v === null || p25 === null) return null;
                return v - p25;
              }),
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: "inner",
              areaStyle: { color: bandColor + "0.25)" },
              z: 2,
            },
            // P50 median line (bold)
            {
              name: "Median",
              type: "line" as const,
              data: makeForcastSeries("p50"),
              lineStyle: { color: medianColor, width: 2.5 },
              symbol: "none" as const,
              z: 5,
            },
          ]),
      // Vertical "now" line with delay indicator
      (() => {
        // Use raw 5m bar time for delay — aggregated bars have older start-of-period timestamps
        const delaySec = lastRawBarTime ? Math.floor(Date.now() / 1000 - lastRawBarTime) : 0;
        const barTime = lastRawBarTime
          ? new Date(lastRawBarTime * 1000).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : "NOW";
        let nowLabel: string;
        let nowColor: string;
        let lineColor: string;
        if (!lastRawBarTime || delaySec < 120) {
          nowLabel = barTime;
          nowColor = "#94a3b8";
          lineColor = "#475569";
        } else if (delaySec <= 1200) {
          const delayMin = Math.round(delaySec / 60);
          nowLabel = `${barTime} (~${delayMin}m delay)`;
          nowColor = "#f59e0b";
          lineColor = "#f59e0b";
        } else {
          nowLabel = `${barTime} (STALE)`;
          nowColor = "#ef4444";
          lineColor = "#ef4444";
        }
        return {
          name: "Now",
          type: "line" as const,
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: lineColor, width: 1, type: "dashed" as const },
            data: [{ xAxis: ctxLen - 1 }],
            label: {
              formatter: nowLabel,
              color: nowColor,
              fontSize: 10,
              fontFamily: "Inter, sans-serif",
            },
          },
          data: [],
        };
      })(),
      // ── Ghost fan overlay: past prediction bands + realized price lines ──
      ...(showHindcast && hindcast?.length
        ? hindcast.flatMap((hc, hci) => {
            // Map hindcast prediction time onto context x-axis
            const predTs = new Date(hc.timestamp).getTime() / 1000;
            // Find the context bar index closest to this prediction's time
            let anchorIdx = -1;
            for (let i = candles.length - 1; i >= 0; i--) {
              if (candles[i].time <= predTs) {
                anchorIdx = i;
                break;
              }
            }
            // Skip if prediction is outside the visible context window
            if (anchorIdx < 0) return [];

            // Build series data aligned to the chart x-axis
            const totalLen = allTimes.length;
            const ghostSeries: Record<string, unknown>[] = [];

            // P25-P75 ghost band (faded gray)
            const ghostP25: (number | null)[] = new Array(totalLen).fill(null);
            const ghostSpread: (number | null)[] = new Array(totalLen).fill(null);
            for (let hi = 0; hi < hc.horizons.length; hi++) {
              const xIdx = anchorIdx + hc.horizons[hi];
              if (xIdx >= 0 && xIdx < totalLen) {
                ghostP25[xIdx] = hc.percentiles.p25[hi];
                ghostSpread[xIdx] = hc.percentiles.p75[hi] - hc.percentiles.p25[hi];
              }
            }

            ghostSeries.push(
              {
                name: "",
                type: "line" as const,
                data: ghostP25,
                lineStyle: { width: 0 },
                symbol: "none" as const,
                stack: `ghost-${hci}`,
                areaStyle: { color: "transparent" },
                z: 0,
                silent: true,
              },
              {
                name: "",
                type: "line" as const,
                data: ghostSpread,
                lineStyle: { width: 0 },
                symbol: "none" as const,
                stack: `ghost-${hci}`,
                areaStyle: { color: "rgba(148, 163, 184, 0.10)" },
                z: 0,
                silent: true,
              },
            );

            // Realized price line — color-coded by accuracy
            const realizedData: (number | null)[] = new Array(totalLen).fill(null);
            let inP25P75 = 0;
            let inP10P90 = 0;
            let totalRealized = 0;
            for (let hi = 0; hi < hc.horizons.length; hi++) {
              const rp = hc.realized_prices[hi];
              if (rp == null) continue;
              const xIdx = anchorIdx + hc.horizons[hi];
              if (xIdx >= 0 && xIdx < totalLen) {
                realizedData[xIdx] = rp;
                totalRealized++;
                if (rp >= hc.percentiles.p25[hi] && rp <= hc.percentiles.p75[hi]) {
                  inP25P75++;
                  inP10P90++;
                } else if (rp >= hc.percentiles.p10[hi] && rp <= hc.percentiles.p90[hi]) {
                  inP10P90++;
                }
              }
            }

            // Color: green if mostly in P25-P75, amber if in P10-P90, red if outside
            let realizedColor = "#ef4444"; // red
            if (totalRealized > 0) {
              const p2575Frac = inP25P75 / totalRealized;
              const p1090Frac = inP10P90 / totalRealized;
              if (p2575Frac >= 0.5) realizedColor = "#10b981"; // green
              else if (p1090Frac >= 0.5) realizedColor = "#f59e0b"; // amber
            }

            if (totalRealized > 0) {
              ghostSeries.push({
                name: "",
                type: "line" as const,
                data: realizedData,
                lineStyle: { color: realizedColor, width: 1.5, type: "dotted" as const },
                symbol: "circle" as const,
                symbolSize: 3,
                itemStyle: { color: realizedColor },
                z: 3,
                silent: true,
              });
            }

            return ghostSeries;
          })
        : []),
      // ── Best-match path highlighting in spaghetti mode ──
      ...(forecastStyle === "spaghetti" && sample_paths?.length && hindcast?.length
        ? (() => {
            // Find the most recent hindcast for the current prediction
            const currentHc = hindcast[hindcast.length - 1];
            if (!currentHc) return [];
            const realizedValues = currentHc.realized_prices.filter(
              (v): v is number => v != null,
            );
            if (realizedValues.length < 3) return []; // Need at least 3 realized points

            const matches = findBestMatchPaths(sample_paths, currentHc.realized_prices);
            if (!matches.length) return [];

            return matches.map((m, mi) => ({
              name: mi === 0 ? `Top ${matches.length} matches` : "",
              type: "line" as const,
              data: [...ctxPad, ...sample_paths[m.index]],
              lineStyle: { color: medianColor, width: 2, opacity: 0.7 },
              symbol: "none" as const,
              smooth: 0.3,
              z: 4,
              silent: true,
            }));
          })()
        : []),
    ],
  };

  // ── Calibration badge computation ──
  let calibrationBadge: { pct: number; n: number; color: string } | null = null;
  if (showHindcast && hindcast?.length) {
    let totalPts = 0;
    let inBand = 0;
    for (const hc of hindcast) {
      for (let hi = 0; hi < hc.horizons.length; hi++) {
        const rp = hc.realized_prices[hi];
        if (rp == null) continue;
        totalPts++;
        if (rp >= hc.percentiles.p10[hi] && rp <= hc.percentiles.p90[hi]) {
          inBand++;
        }
      }
    }
    if (totalPts > 0) {
      const pct = Math.round((inBand / totalPts) * 100);
      let color = "#f59e0b"; // amber by default
      if (pct >= 70 && pct <= 90) color = "#10b981"; // green — well calibrated
      else if (pct < 50 || pct > 95) color = "#ef4444"; // red — badly calibrated
      calibrationBadge = { pct, n: hindcast.length, color };
    }
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {calibrationBadge && (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 24,
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
            color: calibrationBadge.color,
            background: "#0f172acc",
            padding: "2px 6px",
            borderRadius: 3,
            zIndex: 10,
          }}
          title="Percentage of realized prices within P10-P90 bands across recent predictions"
        >
          Cal: {calibrationBadge.pct}% in-band (n={calibrationBadge.n})
        </div>
      )}
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: "100%", width: "100%" }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
