/**
 * FanChart — centerpiece visualization.
 *
 * Shows recent candles (history) + forecast percentile bands.
 * Gradient bands: P10-P90 (outer), P25-P75 (inner), bold P50 median.
 * Color tint shifts green/red based on signal direction.
 */

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
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
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

interface Props {
  prediction: PredictionResponse;
}

export function FanChart({ prediction }: Props) {
  const { percentiles, horizons, last_close, signal, context_candles } =
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

  // Context close prices
  const contextCloses: (number | null)[] = (context_candles ?? []).map(
    (c) => c.close,
  );
  // Pad context for forecast-only series
  const ctxPad: null[] = new Array(ctxLen).fill(null);

  // Forecast series data — each percentile line needs ctx padding + values
  const makeForcastSeries = (key: keyof typeof percentiles) => [
    ...ctxPad,
    ...percentiles[key],
  ];

  // For filled bands, ECharts uses areaStyle with stack pairs
  // P10-P90 band, P25-P75 band

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

        if (price?.value) {
          return `<b>${time}</b><br/>Price: ${price.value.toFixed(2)}`;
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
      // Context close prices
      {
        name: "Price",
        type: "line",
        data: [...contextCloses, ...new Array(horizons.length).fill(null)],
        lineStyle: { color: "#e2e8f0", width: 1.5 },
        symbol: "none",
        z: 10,
      },
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
      // P10 (lower bound for outer band)
      {
        name: "P10",
        type: "line",
        data: makeForcastSeries("p10"),
        lineStyle: { width: 0 },
        symbol: "none",
        stack: "outer",
        areaStyle: { color: "transparent" },
        z: 1,
      },
      // P90 - P10 fill (outer band)
      {
        name: "P90",
        type: "line",
        data: makeForcastSeries("p90").map((v, i) => {
          const p10 = makeForcastSeries("p10")[i];
          if (v === null || p10 === null) return null;
          return v - p10;
        }),
        lineStyle: { width: 0 },
        symbol: "none",
        stack: "outer",
        areaStyle: { color: bandColor + "0.12)" },
        z: 1,
      },
      // P25 (lower bound for inner band)
      {
        name: "P25",
        type: "line",
        data: makeForcastSeries("p25"),
        lineStyle: { width: 0 },
        symbol: "none",
        stack: "inner",
        areaStyle: { color: "transparent" },
        z: 2,
      },
      // P75 - P25 fill (inner band)
      {
        name: "P75",
        type: "line",
        data: makeForcastSeries("p75").map((v, i) => {
          const p25 = makeForcastSeries("p25")[i];
          if (v === null || p25 === null) return null;
          return v - p25;
        }),
        lineStyle: { width: 0 },
        symbol: "none",
        stack: "inner",
        areaStyle: { color: bandColor + "0.25)" },
        z: 2,
      },
      // P50 median line (bold)
      {
        name: "Median",
        type: "line",
        data: makeForcastSeries("p50"),
        lineStyle: { color: medianColor, width: 2.5 },
        symbol: "none",
        z: 5,
      },
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
