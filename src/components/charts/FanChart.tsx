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
import type { PredictionResponse } from "../../api/types";
import type { Timeframe } from "../../api/timeframe";
import { getContextCandles, subsampleForecast } from "../../api/timeframe";

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
export type ForecastStyle = "bands" | "spaghetti" | "gradient" | "density" | "ribbon";

// ── Helpers for advanced forecast styles ──

/** Compute a percentile value from a sorted array at a given fraction (0–1) */
function percentileFromSorted(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * From sample_paths, compute N symmetric percentile layers.
 * Returns array of { lower, upper } arrays (one value per horizon).
 * Layers go from outermost (widest) to innermost (narrowest).
 */
function computeGradientLayers(
  samplePaths: number[][],
  numLayers: number,
): { lower: number[]; upper: number[] }[] {
  const numHorizons = samplePaths[0]?.length ?? 0;
  // Percentile pairs: e.g. 10 layers → P5/P95, P10/P90, ..., P45/P55
  const layers: { lower: number[]; upper: number[] }[] = [];
  for (let i = 0; i < numLayers; i++) {
    const pLow = (5 + i * (45 / numLayers)) / 100;
    const pHigh = 1 - pLow;
    const lower: number[] = [];
    const upper: number[] = [];
    for (let h = 0; h < numHorizons; h++) {
      const vals = samplePaths.map((p) => p[h]).sort((a, b) => a - b);
      lower.push(percentileFromSorted(vals, pLow));
      upper.push(percentileFromSorted(vals, pHigh));
    }
    layers.push({ lower, upper });
  }
  return layers;
}

/**
 * Compute kernel density at each horizon for the density heatmap.
 * Returns: for each horizon, an array of { price, density } sorted by price.
 */
function computeDensityGrid(
  samplePaths: number[][],
  yMin: number,
  yMax: number,
  gridRes: number = 60,
): { price: number; density: number }[][] {
  const numHorizons = samplePaths[0]?.length ?? 0;
  const result: { price: number; density: number }[][] = [];
  const step = (yMax - yMin) / gridRes;

  for (let h = 0; h < numHorizons; h++) {
    const vals = samplePaths.map((p) => p[h]);
    const std = Math.sqrt(
      vals.reduce((s, v) => s + (v - vals.reduce((a, b) => a + b, 0) / vals.length) ** 2, 0) /
        vals.length,
    );
    const bandwidth = 1.06 * std * Math.pow(vals.length, -0.2); // Silverman's rule
    const column: { price: number; density: number }[] = [];
    for (let i = 0; i <= gridRes; i++) {
      const price = yMin + i * step;
      let density = 0;
      for (const v of vals) {
        const u = (price - v) / bandwidth;
        density += Math.exp(-0.5 * u * u); // Gaussian kernel (unnormalized)
      }
      column.push({ price, density });
    }
    // Normalize to [0, 1]
    const maxD = Math.max(...column.map((c) => c.density));
    if (maxD > 0) column.forEach((c) => (c.density /= maxD));
    result.push(column);
  }
  return result;
}

export interface TrackingPath {
  realizedPrices: number[];   // price values at realized horizon points
  realizedOffsets: number[];  // bar offsets from anchor for each realized price
  projectedPrices: number[];  // price values in forecast region
  projectedOffsets: number[]; // horizon offsets for projected prices (relative to forecast start)
  anchorIndex: number;        // x-axis index in context candles where prediction was made
  rmse: number;
  pathIndex: number;
  totalPaths: number;
}

interface Props {
  prediction: PredictionResponse;
  chartType?: ChartType;
  forecastStyle?: ForecastStyle;
  timeframe?: Timeframe;
  invalidationLevel?: number | null;
  highlightedPaths?: number[] | null;
  trackingPath?: TrackingPath | null;
  showTracking?: boolean;
}

export function FanChart({
  prediction,
  chartType = "line",
  forecastStyle = "bands",
  timeframe = "5m",
  invalidationLevel,
  highlightedPaths,
  trackingPath,
  showTracking = false,
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
  // Include sample paths in bounds only for spaghetti (all paths visible).
  // Gradient/density/ribbon derive visuals from path distribution — p10/p90
  // already covers the meaningful range; outlier paths just bloat the y-axis.
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
      // Forecast visualization — style-dependent rendering
      ...(() => {
        // ── SPAGHETTI: individual sample trajectories ──
        if (forecastStyle === "spaghetti" && sample_paths?.length) {
          return [
            ...(sample_paths).map((path, si) => {
              const isHighlighted = highlightedPaths?.includes(si);
              const hasSomeHighlighted = highlightedPaths != null && highlightedPaths.length > 0;
              const opacity = hasSomeHighlighted
                ? (isHighlighted ? 0.7 : 0.08)
                : 0.2;
              const width = hasSomeHighlighted && isHighlighted ? 1.5 : 0.8;
              return {
                name: si === 0 ? "Sample" : "",
                type: "line" as const,
                data: [...ctxPad, ...path],
                lineStyle: { color: bandColor + `${opacity})`, width },
                symbol: "none" as const,
                smooth: 0.3,
                z: isHighlighted ? 4 : 1,
                silent: true,
              };
            }),
            {
              name: "Median",
              type: "line" as const,
              data: makeForcastSeries("p50"),
              lineStyle: { color: medianColor, width: 2.5 },
              symbol: "none" as const,
              smooth: 0.3,
              z: 5,
            },
          ];
        }

        // ── GRADIENT: smooth multi-layer fan from sample paths ──
        if (forecastStyle === "gradient" && sample_paths?.length) {
          const numLayers = 12;
          const layers = computeGradientLayers(sample_paths, numLayers);
          const seriesList: Record<string, unknown>[] = [];

          for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            // Opacity ramps from ~0.04 (outermost) to ~0.35 (innermost)
            const t = i / (numLayers - 1); // 0 = outermost, 1 = innermost
            const opacity = 0.04 + t * 0.31;
            const stackId = `grad-${i}`;

            // Lower bound (invisible baseline)
            seriesList.push({
              name: "",
              type: "line" as const,
              data: [...ctxPad, ...layer.lower],
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: stackId,
              areaStyle: { color: "transparent" },
              smooth: 0.35,
              z: 1,
              silent: true,
            });
            // Upper - lower delta (filled band)
            seriesList.push({
              name: "",
              type: "line" as const,
              data: [...ctxPad, ...layer.upper.map((v, j) => v - layer.lower[j])],
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: stackId,
              areaStyle: { color: bandColor + `${opacity})` },
              smooth: 0.35,
              z: 1,
              silent: true,
            });
          }

          // P50 median — glowing effect via shadow
          seriesList.push({
            name: "Median",
            type: "line" as const,
            data: makeForcastSeries("p50"),
            lineStyle: {
              color: medianColor,
              width: 3,
              shadowColor: medianColor,
              shadowBlur: 8,
            },
            symbol: "none" as const,
            smooth: 0.35,
            z: 5,
          });

          return seriesList;
        }

        // ── DENSITY: heatmap-style probability density ──
        if (forecastStyle === "density" && sample_paths?.length) {
          const densityGrid = computeDensityGrid(sample_paths, yMin, yMax, 80);
          const seriesList: Record<string, unknown>[] = [];

          // Render density as custom series — vertical rect strips per horizon
          seriesList.push({
            name: "Density",
            type: "custom" as const,
            renderItem: (
              _params: { dataIndex: number; coordSys: { x: number; y: number; width: number; height: number } },
              api: {
                value: (i: number) => number;
                coord: (v: [number, number]) => [number, number];
                size: (v: [number, number]) => [number, number];
              },
            ) => {
              const dataIdx = api.value(0); // horizon index
              const hIdx = Math.round(dataIdx);
              if (hIdx < 0 || hIdx >= densityGrid.length) return;
              const column = densityGrid[hIdx];
              const xIdx = ctxLen + hIdx;
              const cellSize = api.size([1, 0]);
              const cellW = Math.max(cellSize[0], 2);

              const children: Record<string, unknown>[] = [];
              for (let ci = 0; ci < column.length - 1; ci++) {
                const d = column[ci].density;
                if (d < 0.02) continue; // skip near-zero density
                const priceLo = column[ci].price;
                const priceHi = column[ci + 1].price;
                const topLeft = api.coord([xIdx, priceHi]);
                const bottomRight = api.coord([xIdx, priceLo]);
                const h = Math.abs(bottomRight[1] - topLeft[1]);

                children.push({
                  type: "rect" as const,
                  shape: {
                    x: topLeft[0] - cellW / 2,
                    y: topLeft[1],
                    width: cellW,
                    height: Math.max(h, 1),
                  },
                  style: {
                    fill: bandColor + `${(d * 0.55).toFixed(3)})`,
                  },
                });
              }
              return { type: "group" as const, children };
            },
            data: densityGrid.map((_, i) => [i]),
            encode: { x: -1 },
            z: 1,
            silent: true,
          });

          // Thin percentile edge lines for reference
          for (const { key, opacity: lineOpacity } of [
            { key: "p10" as const, opacity: 0.25 },
            { key: "p90" as const, opacity: 0.25 },
            { key: "p25" as const, opacity: 0.4 },
            { key: "p75" as const, opacity: 0.4 },
          ]) {
            seriesList.push({
              name: "",
              type: "line" as const,
              data: makeForcastSeries(key),
              lineStyle: { color: bandColor + `${lineOpacity})`, width: 0.8, type: "dotted" as const },
              symbol: "none" as const,
              smooth: 0.3,
              z: 3,
              silent: true,
            });
          }

          // P50 median — bold glow
          seriesList.push({
            name: "Median",
            type: "line" as const,
            data: makeForcastSeries("p50"),
            lineStyle: {
              color: medianColor,
              width: 2.5,
              shadowColor: medianColor,
              shadowBlur: 10,
            },
            symbol: "none" as const,
            smooth: 0.3,
            z: 5,
          });

          return seriesList;
        }

        // ── RIBBON: refined bands with edge lines + glow ──
        if (forecastStyle === "ribbon") {
          const seriesList: Record<string, unknown>[] = [];

          // Outer band P10-P90
          seriesList.push({
            name: "P10",
            type: "line" as const,
            data: makeForcastSeries("p10"),
            lineStyle: { color: bandColor + "0.3)", width: 0.7 },
            symbol: "none" as const,
            stack: "outer",
            areaStyle: { color: "transparent" },
            smooth: 0.35,
            z: 1,
          });
          seriesList.push({
            name: "P90",
            type: "line" as const,
            data: makeForcastSeries("p90").map((v, i) => {
              const p10 = makeForcastSeries("p10")[i];
              if (v === null || p10 === null) return null;
              return v - p10;
            }),
            lineStyle: { color: bandColor + "0.3)", width: 0.7 },
            symbol: "none" as const,
            stack: "outer",
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: bandColor + "0.15)" },
                { offset: 0.5, color: bandColor + "0.04)" },
                { offset: 1, color: bandColor + "0.15)" },
              ]),
            },
            smooth: 0.35,
            z: 1,
          });

          // Inner band P25-P75
          seriesList.push({
            name: "P25",
            type: "line" as const,
            data: makeForcastSeries("p25"),
            lineStyle: { color: bandColor + "0.5)", width: 0.8 },
            symbol: "none" as const,
            stack: "inner",
            areaStyle: { color: "transparent" },
            smooth: 0.35,
            z: 2,
          });
          seriesList.push({
            name: "P75",
            type: "line" as const,
            data: makeForcastSeries("p75").map((v, i) => {
              const p25 = makeForcastSeries("p25")[i];
              if (v === null || p25 === null) return null;
              return v - p25;
            }),
            lineStyle: { color: bandColor + "0.5)", width: 0.8 },
            symbol: "none" as const,
            stack: "inner",
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: bandColor + "0.25)" },
                { offset: 0.5, color: bandColor + "0.08)" },
                { offset: 1, color: bandColor + "0.25)" },
              ]),
            },
            smooth: 0.35,
            z: 2,
          });

          // P50 median — thick glowing line
          seriesList.push({
            name: "Median",
            type: "line" as const,
            data: makeForcastSeries("p50"),
            lineStyle: {
              color: medianColor,
              width: 3,
              shadowColor: bandColor + "0.6)",
              shadowBlur: 12,
              shadowOffsetY: 0,
            },
            symbol: "none" as const,
            smooth: 0.35,
            z: 5,
          });

          return seriesList;
        }

        // ── BANDS: original 2-layer approach (default fallback) ──
        return [
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
          {
            name: "Median",
            type: "line" as const,
            data: makeForcastSeries("p50"),
            lineStyle: { color: medianColor, width: 2.5 },
            symbol: "none" as const,
            z: 5,
          },
        ];
      })(),
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
      // ── Invalidation level markLine ──
      ...(invalidationLevel != null
        ? [
            {
              name: "Invalidation",
              type: "line" as const,
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { color: "#ef4444", width: 1, type: "dashed" as const, opacity: 0.5 },
                data: [{ yAxis: invalidationLevel }],
                label: {
                  formatter: `INVALIDATION ${invalidationLevel.toFixed(2)}`,
                  color: "#ef4444",
                  fontSize: 9,
                  fontFamily: "Inter, sans-serif",
                  position: "insideEndTop" as const,
                },
              },
              data: [],
            },
          ]
        : []),
      // ── Tracking path: best-match ensemble member from most recent evaluated prediction ──
      ...(showTracking && trackingPath
        ? (() => {
            const tp = trackingPath;
            const totalLen = allTimes.length;
            // Realized portion: solid teal line through context candles at correct horizon offsets
            const realizedData: (number | null)[] = new Array(totalLen).fill(null);
            for (let i = 0; i < Math.min(tp.realizedPrices.length, tp.realizedOffsets.length); i++) {
              const idx = tp.anchorIndex + tp.realizedOffsets[i];
              if (idx >= 0 && idx < ctxLen) {
                realizedData[idx] = tp.realizedPrices[i];
              }
            }
            // Projected portion: dashed teal line through forecast region
            const projectedData: (number | null)[] = new Array(totalLen).fill(null);
            // Connect at the last realized point (bridge to projected)
            if (tp.realizedPrices.length > 0 && tp.realizedOffsets.length > 0) {
              const lastIdx = tp.anchorIndex + tp.realizedOffsets[tp.realizedOffsets.length - 1];
              if (lastIdx >= 0 && lastIdx < totalLen) {
                projectedData[lastIdx] = tp.realizedPrices[tp.realizedPrices.length - 1];
              }
            }
            for (let i = 0; i < Math.min(tp.projectedPrices.length, tp.projectedOffsets.length); i++) {
              const idx = ctxLen + tp.projectedOffsets[i];
              if (idx < totalLen) {
                projectedData[idx] = tp.projectedPrices[i];
              }
            }
            return [
              {
                name: "Tracking",
                type: "line" as const,
                data: realizedData,
                lineStyle: { color: "#06b6d4", width: 2 },
                symbol: "none" as const,
                z: 8,
                silent: true,
              },
              {
                name: "",
                type: "line" as const,
                data: projectedData,
                lineStyle: { color: "#06b6d4", width: 1.5, type: "dashed" as const, opacity: 0.4 },
                symbol: "none" as const,
                z: 7,
                silent: true,
              },
            ];
          })()
        : []),
    ],
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Tracking path info badge */}
      {showTracking && trackingPath && (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 24,
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
            color: "#06b6d4",
            background: "#0f172acc",
            padding: "2px 8px",
            borderRadius: 3,
            zIndex: 10,
          }}
          title="Best-matching ensemble member tracking realized price"
        >
          Path {trackingPath.pathIndex}/{trackingPath.totalPaths} | RMSE: {trackingPath.rmse.toFixed(1)} pts
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
