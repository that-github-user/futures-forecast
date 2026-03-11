/**
 * FanChart — centerpiece visualization.
 *
 * Shows recent candles (history) + forecast percentile bands.
 * Gradient bands: P10-P90 (outer), P25-P75 (inner), bold P50 median.
 * Color tint shifts green/red based on signal direction.
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
import type { PredictionResponse } from "../../api/types";

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
}

export function FanChart({ prediction, chartType = "line", forecastStyle = "bands" }: Props) {
  const { percentiles, horizons, last_close, signal, context_candles, sample_paths } =
    prediction;

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
  const contextTimes: string[] = (context_candles ?? []).map((c) => {
    const d = new Date(c.time * 1000);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  });

  // Forecast times (offset from last context bar, 5 min each)
  const lastTime = context_candles?.length
    ? context_candles[context_candles.length - 1].time
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
  const candles = context_candles ?? [];
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

  // For filled bands, ECharts uses areaStyle with stack pairs
  // P10-P90 band, P25-P75 band

  // Compute explicit y-axis bounds from all visible data
  const allPrices: number[] = [];
  candles.forEach((c) => { allPrices.push(c.high, c.low); });
  percentiles.p10.forEach((v) => allPrices.push(v));
  percentiles.p90.forEach((v) => allPrices.push(v));
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
        const items = params as { seriesName: string; value: number | null; axisValue: string }[];
        if (!items?.length) return "";
        const time = items[0].axisValue;
        const price = items.find(i => i.seriesName === "Price" && i.value !== null);
        const median = items.find(i => i.seriesName === "Median" && i.value !== null);

        if (price?.value != null) {
          // For candlestick/ohlc, look up full OHLC from context
          const ctxIdx = contextTimes.indexOf(time);
          if (ctxIdx >= 0 && ctxIdx < candles.length && chartType !== "line") {
            const c = candles[ctxIdx];
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
          // Find p10/p90 from the raw percentiles based on forecast index
          const forecastIdx = items[0].axisValue;
          const hi = forecastTimes.indexOf(forecastIdx);
          if (hi >= 0) {
            const p10 = percentiles.p10[hi];
            const p25 = percentiles.p25[hi];
            const p50 = percentiles.p50[hi];
            const p75 = percentiles.p75[hi];
            const p90 = percentiles.p90[hi];
            const delta = ((p50 - last_close) / last_close * 100).toFixed(2);
            return [
              `<b>${time}</b> (+${formatHorizon(horizons[hi])})`,
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
              lineStyle: { color: bandColor + "0.25)", width: 1 },
              symbol: "none" as const,
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
              z: 5,
            },
          ]
        : [
            // P10-P90 outer band (custom renderItem for filled area between two lines)
            {
              name: "P10-P90",
              type: "custom" as const,
              data: horizons.map((_, i) => [ctxLen + i, percentiles.p10[i], percentiles.p90[i]]),
              renderItem: (
                params: { dataIndex: number; coordSys: { x: number; width: number } },
                api: {
                  value: (i: number) => number;
                  coord: (v: [number, number]) => [number, number];
                },
              ) => {
                const idx = api.value(0);
                const nextIdx = idx + 1;
                const p10Curr = api.coord([idx, api.value(1)]);
                const p90Curr = api.coord([idx, api.value(2)]);
                // Check if there's a next point
                const nextData = params.dataIndex + 1 < horizons.length
                  ? [ctxLen + params.dataIndex + 1, percentiles.p10[params.dataIndex + 1], percentiles.p90[params.dataIndex + 1]]
                  : null;
                if (!nextData) {
                  return { type: "group" as const, children: [] };
                }
                const p10Next = api.coord([nextIdx, nextData[1]]);
                const p90Next = api.coord([nextIdx, nextData[2]]);
                return {
                  type: "polygon" as const,
                  shape: {
                    points: [p90Curr, p90Next, p10Next, p10Curr],
                  },
                  style: { fill: bandColor + "0.12)" },
                  z: 1,
                };
              },
              encode: { x: 0, y: [1, 2] },
              z: 1,
              silent: true,
            },
            // P25-P75 inner band
            {
              name: "P25-P75",
              type: "custom" as const,
              data: horizons.map((_, i) => [ctxLen + i, percentiles.p25[i], percentiles.p75[i]]),
              renderItem: (
                params: { dataIndex: number; coordSys: { x: number; width: number } },
                api: {
                  value: (i: number) => number;
                  coord: (v: [number, number]) => [number, number];
                },
              ) => {
                const idx = api.value(0);
                const nextIdx = idx + 1;
                const p25Curr = api.coord([idx, api.value(1)]);
                const p75Curr = api.coord([idx, api.value(2)]);
                const nextData = params.dataIndex + 1 < horizons.length
                  ? [ctxLen + params.dataIndex + 1, percentiles.p25[params.dataIndex + 1], percentiles.p75[params.dataIndex + 1]]
                  : null;
                if (!nextData) {
                  return { type: "group" as const, children: [] };
                }
                const p25Next = api.coord([nextIdx, nextData[1]]);
                const p75Next = api.coord([nextIdx, nextData[2]]);
                return {
                  type: "polygon" as const,
                  shape: {
                    points: [p75Curr, p75Next, p25Next, p25Curr],
                  },
                  style: { fill: bandColor + "0.25)" },
                  z: 2,
                };
              },
              encode: { x: 0, y: [1, 2] },
              z: 2,
              silent: true,
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
      // Vertical "now" line
      {
        name: "Now",
        type: "line",
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#475569", width: 1, type: "dashed" },
          data: [{ xAxis: ctxLen - 1 }],
          label: {
            formatter: "NOW",
            color: "#94a3b8",
            fontSize: 10,
            fontFamily: "Inter, sans-serif",
          },
        },
        data: [],
      },
    ],
  };

  return (
    <div style={{ width: "100%", height: "100%" }}>
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
