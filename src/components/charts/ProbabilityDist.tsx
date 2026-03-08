/**
 * Probability distribution histogram at a selectable horizon.
 * Shows the spread of predicted close prices.
 */

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useState } from "react";
import { formatHorizon } from "../../api/format";
import type { PredictionResponse } from "../../api/types";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  prediction: PredictionResponse;
}

export function ProbabilityDist({ prediction }: Props) {
  const { percentiles, horizons, last_close, signal } = prediction;
  // Show only key horizons as buttons, but allow selecting any
  const keyHorizons = [1, 12, 24, 48, 78];
  const displayHorizons = keyHorizons
    .map((h) => ({ h, idx: horizons.indexOf(h) }))
    .filter(({ idx }) => idx >= 0);

  const [selectedIdx, setSelectedIdx] = useState(horizons.length - 1);

  const horizon = horizons[selectedIdx];
  const p10 = percentiles.p10[selectedIdx];
  const p25 = percentiles.p25[selectedIdx];
  const p50 = percentiles.p50[selectedIdx];
  const p75 = percentiles.p75[selectedIdx];
  const p90 = percentiles.p90[selectedIdx];

  // Approximate a distribution from percentiles using interpolation
  const points = [
    { pct: 5, val: p10 - (p25 - p10) * 0.5 },
    { pct: 10, val: p10 },
    { pct: 25, val: p25 },
    { pct: 50, val: p50 },
    { pct: 75, val: p75 },
    { pct: 90, val: p90 },
    { pct: 95, val: p90 + (p90 - p75) * 0.5 },
  ];

  const barColor =
    signal.direction === "LONG"
      ? "#10b981"
      : signal.direction === "SHORT"
        ? "#ef4444"
        : "#3b82f6";

  // Create histogram bins from the percentile approximation
  const bins = points.map((p) => ({
    label: `P${p.pct}`,
    value: p.val,
    delta: ((p.val - last_close) / last_close * 100).toFixed(2),
  }));

  const option: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      formatter: (params: unknown) => {
        const p = (params as { name: string; value: number }[])[0];
        if (!p) return "";
        const delta = ((p.value - last_close) / last_close * 100).toFixed(2);
        return `${p.name}<br/>Price: ${p.value.toFixed(2)}<br/>Change: ${delta}%`;
      },
    },
    grid: { left: 50, right: 10, top: 10, bottom: 30 },
    xAxis: {
      type: "category",
      data: bins.map((b) => b.label),
      axisLabel: { color: "#94a3b8", fontSize: 10 },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: {
        color: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        formatter: (v: number) => v.toFixed(0),
      },
      splitLine: { lineStyle: { color: "#1e293b" } },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    series: [
      {
        type: "bar",
        data: bins.map((b) => ({
          value: b.value,
          itemStyle: {
            color: b.value >= last_close ? "#10b981" : "#ef4444",
            borderRadius: [3, 3, 0, 0],
          },
        })),
        barWidth: "60%",
      },
    ],
  };

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">Distribution @ {formatHorizon(horizon)}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {displayHorizons.map(({ h, idx }) => (
            <button
              key={h}
              onClick={() => setSelectedIdx(idx)}
              className={`horizon-btn ${idx === selectedIdx ? "active" : ""}`}
              style={{
                background: idx === selectedIdx ? barColor : "#1e293b",
                color: idx === selectedIdx ? "#fff" : "#94a3b8",
                border: "1px solid #334155",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 10,
                cursor: "pointer",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {formatHorizon(h)}
            </button>
          ))}
        </div>
      </div>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: "calc(100% - 30px)", width: "100%" }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
