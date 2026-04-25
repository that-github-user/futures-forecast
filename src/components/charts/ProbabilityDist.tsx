/**
 * Probability distribution histogram at a selectable horizon.
 * Uses sample paths for a real histogram when available, falls back to percentile approximation.
 */

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useState } from "react";
import { formatHorizon } from "../../api/format";
import type { PredictionResponse } from "../../api/types";
import { colors, fonts } from "../../styles/tokens";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  prediction: PredictionResponse;
}

export function ProbabilityDist({ prediction }: Props) {
  const { percentiles, horizons, last_close, sample_paths } = prediction;
  // Show only key horizons as buttons
  const keyHorizons = [1, 12, 24, 48, 78];
  const displayHorizons = keyHorizons
    .map((h) => ({ h, idx: horizons.indexOf(h) }))
    .filter(({ idx }) => idx >= 0);

  const [selectedIdx, setSelectedIdx] = useState(horizons.length - 1);

  const hasSamplePaths = sample_paths != null && sample_paths.length > 0;

  // Extract return values from sample paths at selected horizon
  let bins: { label: string; count: number; midReturn: number }[] = [];
  let sampleReturns: number[] = [];
  let pUp = 0;
  let pBigUp = 0;
  let pBigDown = 0;

  if (hasSamplePaths) {
    // Get the return at selected horizon for each sample path
    const clampedIdx = Math.min(selectedIdx, sample_paths![0].length - 1);
    sampleReturns = sample_paths!
      .filter((path) => path.length > 0)
      .map((path) => {
        const price = path[Math.min(clampedIdx, path.length - 1)];
        return ((price - last_close) / last_close) * 100;
      });

    // Compute probabilities
    const n = sampleReturns.length;
    pUp = sampleReturns.filter((r) => r > 0).length / n;
    pBigUp = sampleReturns.filter((r) => r > 0.5).length / n;
    pBigDown = sampleReturns.filter((r) => r < -0.5).length / n;

    // Build histogram bins
    const minRet = Math.min(...sampleReturns);
    const maxRet = Math.max(...sampleReturns);
    const range = maxRet - minRet;
    const numBins = Math.min(15, Math.max(6, Math.ceil(Math.sqrt(n))));
    const binWidth = range / numBins || 0.1;

    bins = [];
    for (let i = 0; i < numBins; i++) {
      const lo = minRet + i * binWidth;
      const hi = lo + binWidth;
      const mid = (lo + hi) / 2;
      const count = sampleReturns.filter((r) => r >= lo && (i === numBins - 1 ? r <= hi : r < hi)).length;
      bins.push({
        label: `${mid >= 0 ? "+" : ""}${mid.toFixed(2)}%`,
        count,
        midReturn: mid,
      });
    }
  } else {
    // Fallback: approximate from percentiles
    const p10 = percentiles.p10[selectedIdx];
    const p25 = percentiles.p25[selectedIdx];
    const p50 = percentiles.p50[selectedIdx];
    const p75 = percentiles.p75[selectedIdx];
    const p90 = percentiles.p90[selectedIdx];

    const points = [
      { pct: 5, val: p10 - (p25 - p10) * 0.5 },
      { pct: 10, val: p10 },
      { pct: 25, val: p25 },
      { pct: 50, val: p50 },
      { pct: 75, val: p75 },
      { pct: 90, val: p90 },
      { pct: 95, val: p90 + (p90 - p75) * 0.5 },
    ];

    bins = points.map((p) => ({
      label: `P${p.pct}`,
      count: 1, // uniform weight for fallback
      midReturn: ((p.val - last_close) / last_close) * 100,
    }));
  }

  const horizon = horizons[selectedIdx];

  const option: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: colors.borderDim,
      borderColor: colors.borderMid,
      textStyle: { color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 11 },
      formatter: (params: unknown) => {
        const p = (params as { name: string; value: number }[])[0];
        if (!p) return "";
        return `${p.name}<br/>Count: ${p.value}`;
      },
    },
    grid: { left: 40, right: 10, top: 10, bottom: 45 },
    xAxis: {
      type: "category",
      data: bins.map((b) => b.label),
      axisLabel: {
        color: colors.textSecondary,
        fontSize: 8,
        rotate: bins.length > 8 ? 45 : 0,
        overflow: "truncate" as const,
        width: 50,
      },
      axisLine: { lineStyle: { color: colors.borderMid } },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: colors.textSecondary,
        fontFamily: fonts.mono,
        fontSize: 10,
      },
      splitLine: { lineStyle: { color: colors.borderDim } },
      axisLine: { lineStyle: { color: colors.borderMid } },
    },
    series: [
      {
        type: "bar",
        data: bins.map((b) => ({
          value: b.count,
          itemStyle: {
            color: b.midReturn >= 0 ? colors.accentGreen : colors.accentRed,
            borderRadius: [3, 3, 0, 0],
          },
        })),
        barWidth: hasSamplePaths ? "80%" : "60%",
      },
    ],
  };

  const barColor = colors.accentBlue;

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-title">Distribution @ {formatHorizon(horizon)}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {displayHorizons.map(({ h, idx }) => (
            <button
              key={h}
              onClick={() => setSelectedIdx(idx)}
              style={{
                background: idx === selectedIdx ? barColor : colors.borderDim,
                color: idx === selectedIdx ? colors.textPrimary : colors.textSecondary,
                border: `1px solid ${colors.borderMid}`,
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 10,
                cursor: "pointer",
                fontFamily: fonts.mono,
              }}
            >
              {formatHorizon(h)}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ height: "100%", width: "100%" }}
          notMerge
          lazyUpdate
        />
      </div>
      {/* Probability callouts */}
      {hasSamplePaths && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            padding: "4px 2px 2px",
            borderTop: `1px solid ${colors.borderDim}`,
            fontFamily: fonts.mono,
            fontSize: 10,
            flexWrap: "wrap",
            gap: 2,
          }}
        >
          <span>
            <span style={{ color: colors.textMuted }}>P(up)</span>{" "}
            <span style={{ color: colors.accentGreen }}>{(pUp * 100).toFixed(0)}%</span>
          </span>
          <span>
            <span style={{ color: colors.textMuted }}>P(&gt;0.5%)</span>{" "}
            <span style={{ color: colors.accentGreen }}>{(pBigUp * 100).toFixed(0)}%</span>
          </span>
          <span>
            <span style={{ color: colors.textMuted }}>P(&lt;-0.5%)</span>{" "}
            <span style={{ color: colors.accentRed }}>{(pBigDown * 100).toFixed(0)}%</span>
          </span>
        </div>
      )}
    </div>
  );
}
