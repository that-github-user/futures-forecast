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
 * From sample_paths, compute N percentile layers with density-weighted opacity.
 * Each layer gets an opacity proportional to how much probability mass it contains,
 * computed separately above and below the median. When the distribution is skewed,
 * the denser side gets higher opacity — making asymmetry visible through color.
 */
function computeGradientLayers(
  samplePaths: number[][],
  numLayers: number,
): { lower: number[]; upper: number[]; opacityBelow: number; opacityAbove: number }[] {
  const numHorizons = samplePaths[0]?.length ?? 0;
  const layers: { lower: number[]; upper: number[]; opacityBelow: number; opacityAbove: number }[] = [];

  // Precompute sorted values and median per horizon
  const sortedByH: number[][] = [];
  const medianByH: number[] = [];
  for (let h = 0; h < numHorizons; h++) {
    const vals = samplePaths.map((p) => p[h]).sort((a, b) => a - b);
    sortedByH.push(vals);
    medianByH.push(percentileFromSorted(vals, 0.5));
  }

  for (let i = 0; i < numLayers; i++) {
    const pLow = (5 + i * (45 / numLayers)) / 100;
    const pHigh = 1 - pLow;
    const lower: number[] = [];
    const upper: number[] = [];
    // Track how concentrated each half-band is (narrower = denser = more opaque)
    let totalWidthBelow = 0;
    let totalWidthAbove = 0;

    for (let h = 0; h < numHorizons; h++) {
      const lo = percentileFromSorted(sortedByH[h], pLow);
      const hi = percentileFromSorted(sortedByH[h], pHigh);
      lower.push(lo);
      upper.push(hi);
      totalWidthBelow += Math.abs(medianByH[h] - lo) || 1e-6;
      totalWidthAbove += Math.abs(hi - medianByH[h]) || 1e-6;
    }

    // Inverse width → density: narrower band = higher concentration = more opaque
    const densBelow = 1 / (totalWidthBelow / numHorizons);
    const densAbove = 1 / (totalWidthAbove / numHorizons);
    // Normalize so the denser side gets full opacity allocation
    const maxDens = Math.max(densBelow, densAbove);
    layers.push({
      lower, upper,
      opacityBelow: densBelow / maxDens,
      opacityAbove: densAbove / maxDens,
    });
  }
  return layers;
}

/**
 * Compute kernel density at each horizon for the density heatmap.
 *
 * Uses 0.6x Silverman bandwidth to preserve multimodal/skewed structure
 * that the standard rule oversmooths. Normalization is global across all
 * horizons so the density spreading with horizon is visible. A power-law
 * (sqrt) mapping compresses the dynamic range so low-density tails are
 * visible while peaks aren't saturated.
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

  let globalMax = 0;

  for (let h = 0; h < numHorizons; h++) {
    const vals = samplePaths.map((p) => p[h]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(
      vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length,
    );
    // 0.6x Silverman: narrower kernel preserves skew, bimodality, heavy tails
    const bandwidth = 0.6 * 1.06 * std * Math.pow(vals.length, -0.2);
    const column: { price: number; density: number }[] = [];
    for (let i = 0; i <= gridRes; i++) {
      const price = yMin + i * step;
      let density = 0;
      for (const v of vals) {
        const u = (price - v) / bandwidth;
        density += Math.exp(-0.5 * u * u);
      }
      column.push({ price, density });
      if (density > globalMax) globalMax = density;
    }
    result.push(column);
  }

  // Global normalization + power-law compression (sqrt)
  // Global: density spreading with horizon is visible (near-term is brighter)
  // Sqrt: compresses dynamic range so tails are visible, peaks aren't saturated
  if (globalMax > 0) {
    for (const column of result) {
      for (const cell of column) {
        cell.density = Math.sqrt(cell.density / globalMax);
      }
    }
  }

  return result;
}

interface Props {
  prediction: PredictionResponse;
  chartType?: ChartType;
  forecastStyle?: ForecastStyle;
  timeframe?: Timeframe;
  invalidationLevel?: number | null;
  highlightedPaths?: number[] | null;
  hindcastCandidates?: import("../../api/types").HindcastPrediction[];
  showTracking?: boolean;
}

export function FanChart({
  prediction,
  chartType = "line",
  forecastStyle = "bands",
  timeframe = "5m",
  invalidationLevel,
  highlightedPaths,
  hindcastCandidates = [],
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
  const totalLen = allTimes.length;

  // ── Best Track with Uncertainty Cone (computed from hindcast inside FanChart) ──
  // Tries each candidate oldest-first, picks the first whose anchor fits the visible candles.
  const bestTrack = (() => {
    if (!showTracking || !hindcastCandidates.length) return null;
    for (const hc of hindcastCandidates) {
    const bestPaths = hc.scoring?.best_paths;
    if (!bestPaths?.length || !hc.percentiles || !hc.horizons?.length) continue;

    // Find anchor in aggregated candles
    const predTs = new Date(hc.timestamp).getTime() / 1000;
    let anchorIdx = -1;
    for (let ci = candles.length - 1; ci >= 0; ci--) {
      if (candles[ci].time <= predTs) { anchorIdx = ci; break; }
    }
    if (anchorIdx < 0) continue;

    // Timeframe scaling: hindcast horizons are in 5m bars
    const tfFactor = timeframe === "5m" ? 1 : timeframe === "15m" ? 3 : timeframe === "30m" ? 6 : 12;
    const best = bestPaths[0];
    const hcHorizons = hc.horizons;

    // Map hindcast horizon indices to chart x-indices
    const realizedData: (number | null)[] = new Array(totalLen).fill(null);
    const projectedCenter: (number | null)[] = new Array(totalLen).fill(null);
    const K = Math.min(bestPaths.length, 7);
    const coneUpper: (number | null)[] = new Array(totalLen).fill(null);
    const coneLower: (number | null)[] = new Array(totalLen).fill(null);
    let lastRealizedIdx = -1;

    for (let i = 0; i < hcHorizons.length && i < best.path_values.length; i++) {
      const aggOffset = Math.round(hcHorizons[i] / tfFactor);
      const chartIdx = anchorIdx + aggOffset;
      if (chartIdx < 0 || chartIdx >= totalLen) continue;

      if (chartIdx < ctxLen) {
        // Realized portion — solid best track line
        realizedData[chartIdx] = best.path_values[i];
        lastRealizedIdx = chartIdx;
      } else {
        // Projected portion — center line + cone from top-K
        projectedCenter[chartIdx] = best.path_values[i];
        const vals = bestPaths.slice(0, K)
          .map((p) => p.path_values[i])
          .filter((v): v is number => v != null)
          .sort((a, b) => a - b);
        if (vals.length >= 2) {
          coneLower[chartIdx] = vals[0];
          coneUpper[chartIdx] = vals[vals.length - 1];
        } else if (vals.length === 1) {
          coneLower[chartIdx] = vals[0];
          coneUpper[chartIdx] = vals[0];
        }
      }
    }

    // Bridge: connect last realized point to first projected point
    if (lastRealizedIdx >= 0 && realizedData[lastRealizedIdx] != null) {
      projectedCenter[lastRealizedIdx] = realizedData[lastRealizedIdx];
      coneLower[lastRealizedIdx] = realizedData[lastRealizedIdx];
      coneUpper[lastRealizedIdx] = realizedData[lastRealizedIdx];
    }

    const realizedCount = realizedData.filter((v) => v !== null).length;
    if (realizedCount < 2) continue;

    // Interpolate sparse data to fill every bar — ECharts stacking needs contiguous values
    const interpolateSparse = (arr: (number | null)[]): (number | null)[] => {
      const result = [...arr];
      // Find first and last non-null
      let first = -1, last = -1;
      for (let j = 0; j < result.length; j++) { if (result[j] !== null) { if (first < 0) first = j; last = j; } }
      if (first < 0 || first === last) return result;
      // Linear interpolate between known points
      let prevIdx = first;
      for (let j = first + 1; j <= last; j++) {
        if (result[j] !== null) {
          // Fill gap between prevIdx and j
          for (let k = prevIdx + 1; k < j; k++) {
            const t = (k - prevIdx) / (j - prevIdx);
            result[k] = (result[prevIdx] as number) + t * ((result[j] as number) - (result[prevIdx] as number));
          }
          prevIdx = j;
        }
      }
      return result;
    };

    const realizedInterp = interpolateSparse(realizedData);
    const projInterp = interpolateSparse(projectedCenter);
    const coneUpperInterp = interpolateSparse(coneUpper);
    const coneLowerInterp = interpolateSparse(coneLower);

    const trackMinutes = best.tracking_duration_bars * 5;
    return {
      realizedData: realizedInterp,
      projectedCenter: projInterp,
      coneUpper: coneUpperInterp,
      coneLower: coneLowerInterp,
      rmse: best.rmse_pts,
      pathIndex: best.path_index,
      totalPaths: bestPaths.length,
      trackedH: Math.floor(trackMinutes / 60),
      trackedM: trackMinutes % 60,
    };
    } // end for loop over candidates
    return null;
  })();

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
  // Include best track cone in bounds
  if (bestTrack) {
    for (const v of bestTrack.coneUpper) { if (v != null) allPrices.push(v); }
    for (const v of bestTrack.coneLower) { if (v != null) allPrices.push(v); }
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

        // ── GRADIENT: asymmetry-aware multi-layer fan ──
        // Each layer is split at the median into below/above halves with
        // independent opacity weighted by density. The denser (narrower) side
        // gets higher opacity, making skew visible through color intensity.
        if (forecastStyle === "gradient" && sample_paths?.length) {
          const numLayers = 12;
          const layers = computeGradientLayers(sample_paths, numLayers);
          const p50 = makeForcastSeries("p50");
          const seriesList: Record<string, unknown>[] = [];

          for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            const t = i / (numLayers - 1); // 0 = outermost, 1 = innermost
            const baseOpacity = 0.04 + t * 0.31;

            // Below-median half: lower → p50
            const belowOpacity = baseOpacity * (0.5 + 0.5 * layer.opacityBelow);
            seriesList.push({
              name: "",
              type: "line" as const,
              data: [...ctxPad, ...layer.lower],
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: `grad-lo-${i}`,
              areaStyle: { color: "transparent" },
              smooth: 0.35,
              z: 1,
              silent: true,
            });
            seriesList.push({
              name: "",
              type: "line" as const,
              data: p50.map((v, j) => {
                if (v === null) return null;
                const lo = j < ctxLen ? null : layer.lower[j - ctxLen];
                return lo !== null && lo !== undefined ? v - lo : null;
              }),
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: `grad-lo-${i}`,
              areaStyle: { color: bandColor + `${belowOpacity.toFixed(3)})` },
              smooth: 0.35,
              z: 1,
              silent: true,
            });

            // Above-median half: p50 → upper
            const aboveOpacity = baseOpacity * (0.5 + 0.5 * layer.opacityAbove);
            seriesList.push({
              name: "",
              type: "line" as const,
              data: p50,
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: `grad-hi-${i}`,
              areaStyle: { color: "transparent" },
              smooth: 0.35,
              z: 1,
              silent: true,
            });
            seriesList.push({
              name: "",
              type: "line" as const,
              data: p50.map((v, j) => {
                if (v === null) return null;
                const hi = j < ctxLen ? null : layer.upper[j - ctxLen];
                return hi !== null && hi !== undefined ? hi - v : null;
              }),
              lineStyle: { width: 0 },
              symbol: "none" as const,
              stack: `grad-hi-${i}`,
              areaStyle: { color: bandColor + `${aboveOpacity.toFixed(3)})` },
              smooth: 0.35,
              z: 1,
              silent: true,
            });
          }

          // P50 median — glowing effect via shadow
          seriesList.push({
            name: "Median",
            type: "line" as const,
            data: p50,
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

        // ── RIBBON: skew-aware bands with edge lines + glow ──
        // Gradient center shifts toward the denser side of the distribution.
        // Symmetric distribution → center at 0.5 (equal brightness top/bottom).
        // Skewed → center shifts so the concentrated side is brighter.
        if (forecastStyle === "ribbon") {
          const seriesList: Record<string, unknown>[] = [];

          // Compute average skew from percentiles (where does P50 sit within P10-P90?)
          const p10s = percentiles.p10;
          const p50s = percentiles.p50;
          const p90s = percentiles.p90;
          let skewSum = 0;
          let skewCount = 0;
          for (let i = 0; i < p50s.length; i++) {
            const range = p90s[i] - p10s[i];
            if (range > 0) {
              // 0 = median at P10 (heavy right tail), 1 = median at P90 (heavy left tail)
              skewSum += (p50s[i] - p10s[i]) / range;
              skewCount++;
            }
          }
          // gradCenter: where in the band (0=top, 1=bottom) the dim trough sits
          // When median is closer to P10 (positive skew/right tail), shift dim zone upward
          const medianPos = skewCount > 0 ? skewSum / skewCount : 0.5;
          const gradCenter = Math.max(0.15, Math.min(0.85, medianPos));
          // Opacity: brighter on the denser side
          const outerDense = 0.18;
          const outerSparse = 0.08;
          const innerDense = 0.30;
          const innerSparse = 0.12;
          // Top of band = P90 (offset=0), bottom = P10 (offset=1)
          // gradCenter < 0.5 → top (upside) is denser → top brighter
          const outerTop = medianPos < 0.5 ? outerDense : outerSparse;
          const outerBot = medianPos < 0.5 ? outerSparse : outerDense;
          const innerTop = medianPos < 0.5 ? innerDense : innerSparse;
          const innerBot = medianPos < 0.5 ? innerSparse : innerDense;

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
                { offset: 0, color: bandColor + `${outerTop})` },
                { offset: gradCenter, color: bandColor + "0.03)" },
                { offset: 1, color: bandColor + `${outerBot})` },
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
                { offset: 0, color: bandColor + `${innerTop})` },
                { offset: gradCenter, color: bandColor + "0.05)" },
                { offset: 1, color: bandColor + `${innerBot})` },
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
      // ── Best Track with Uncertainty Cone ──
      ...(bestTrack
        ? [
            // Cone lower bound (invisible baseline for stacking)
            {
              name: "",
              type: "line" as const,
              data: bestTrack.coneLower,
              lineStyle: { color: "rgba(6, 182, 212, 0.25)", width: 0.7, type: "dashed" as const },
              symbol: "none" as const,
              stack: "best-track-cone",
              areaStyle: { color: "transparent" },
              smooth: 0.3,
              z: 6,
              silent: true,
            },
            // Cone fill (upper - lower delta)
            {
              name: "",
              type: "line" as const,
              data: bestTrack.coneLower.map((lo, i) => {
                const hi = bestTrack.coneUpper[i];
                if (lo == null || hi == null) return null;
                return hi - lo;
              }),
              lineStyle: { color: "rgba(6, 182, 212, 0.25)", width: 0.7, type: "dashed" as const },
              symbol: "none" as const,
              stack: "best-track-cone",
              areaStyle: { color: "rgba(6, 182, 212, 0.12)" },
              smooth: 0.3,
              z: 6,
              silent: true,
            },
            // Projected center line (best path's forecast)
            {
              name: "Track Projection",
              type: "line" as const,
              data: bestTrack.projectedCenter,
              lineStyle: { color: "#06b6d4", width: 1.5, opacity: 0.7 },
              symbol: "none" as const,
              smooth: 0.3,
              z: 7,
              silent: true,
            },
            // Realized best track (solid glowing line)
            {
              name: "Best Track",
              type: "line" as const,
              data: bestTrack.realizedData,
              lineStyle: {
                color: "#06b6d4",
                width: 2.5,
                shadowColor: "rgba(6, 182, 212, 0.4)",
                shadowBlur: 6,
              },
              symbol: "none" as const,
              z: 8,
              silent: true,
            },
          ]
        : []),
    ],
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Best track info badge */}
      {bestTrack && (
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
          title={`Best-tracking ensemble member (${bestTrack.totalPaths} candidates) with uncertainty cone`}
        >
          Best track: {bestTrack.rmse.toFixed(1)} pts RMSE | {bestTrack.trackedH}h {bestTrack.trackedM}m tracked
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
