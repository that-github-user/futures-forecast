/**
 * Live equity curve from prediction history.
 * Shows cumulative return of following the model's signals.
 * Supports horizon selector for multi-horizon realized returns.
 */

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useState } from "react";
import { formatHorizon } from "../../api/format";
import type { HistoryEntry } from "../../api/types";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

const EQUITY_HORIZONS = [12, 24, 48, 78];

interface Props {
  history: HistoryEntry[];
}

export function EquityCurve({ history }: Props) {
  const [selectedHorizon, setSelectedHorizon] = useState(78);

  // Check if multi-horizon data is available
  const hasMultiHorizon = history.some((e) => e.realized_returns != null);

  // Compute cumulative equity from realized returns at selected horizon
  let cumReturn = 0;
  const equity = history
    .filter((e) => {
      if (hasMultiHorizon && e.realized_returns) {
        const ret = e.realized_returns[String(selectedHorizon)];
        return ret != null;
      }
      return e.realized_return != null;
    })
    .map((e) => {
      const signalDir =
        e.signal.direction === "LONG" ? 1 : e.signal.direction === "SHORT" ? -1 : 0;

      let ret: number;
      if (hasMultiHorizon && e.realized_returns) {
        ret = e.realized_returns[String(selectedHorizon)] ?? 0;
      } else {
        ret = e.realized_return ?? 0;
      }

      const pnl = signalDir * ret;
      cumReturn += pnl;
      return {
        time: new Date(e.timestamp).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        value: +(cumReturn * 100).toFixed(3),
      };
    });

  const isPositive = cumReturn >= 0;

  const option: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
    },
    grid: { left: 50, right: 10, top: 10, bottom: 30 },
    xAxis: {
      type: "category",
      data: equity.map((e) => e.time),
      axisLabel: { color: "#94a3b8", fontSize: 10, interval: Math.max(0, Math.floor(equity.length / 6)) },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        formatter: (v: number) => `${v.toFixed(2)}%`,
      },
      splitLine: { lineStyle: { color: "#1e293b" } },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    series: [
      {
        type: "line",
        data: equity.map((e) => e.value),
        lineStyle: { color: isPositive ? "#10b981" : "#ef4444", width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: isPositive ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)" },
            { offset: 1, color: "transparent" },
          ]),
        },
        symbol: "none",
        smooth: true,
      },
    ],
  };

  if (equity.length === 0) {
    return (
      <div className="panel" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#64748b" }}>Awaiting realized outcomes...</span>
      </div>
    );
  }

  const lineColor = isPositive ? "#10b981" : "#ef4444";

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">Live Equity</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Horizon selector */}
          <div style={{ display: "flex", gap: 3 }}>
            {EQUITY_HORIZONS.map((h) => (
              <button
                key={h}
                onClick={() => setSelectedHorizon(h)}
                style={{
                  background: h === selectedHorizon ? lineColor : "#1e293b",
                  color: h === selectedHorizon ? "#fff" : "#94a3b8",
                  border: "1px solid #334155",
                  borderRadius: 4,
                  padding: "1px 5px",
                  fontSize: 9,
                  cursor: "pointer",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {formatHorizon(h)}
              </button>
            ))}
          </div>
          <span style={{ color: lineColor, fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>
            {isPositive ? "+" : ""}{(cumReturn * 100).toFixed(3)}%
          </span>
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
