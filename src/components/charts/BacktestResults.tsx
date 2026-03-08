/**
 * Walk-forward backtest results display.
 * Shows per-fold PF, aggregate equity curve, and statistical significance.
 * Reads from a static JSON file that gets updated after walk-forward completes.
 */

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export interface FoldResult {
  fold: number;
  test_period: string;
  train_period: string;
  num_trades: number;
  num_long: number;
  num_short: number;
  profit_factor: number;
  win_rate: number;
  total_pnl: number;
  mean_pnl: number;
}

export interface BacktestSummary {
  config_label: string;
  horizon: number;
  threshold: number;
  folds: FoldResult[];
  aggregate: {
    total_trades: number;
    profit_factor: number;
    win_rate: number;
    total_pnl: number;
    bootstrap_pf_95ci: [number, number];
    folds_profitable: number;
    total_folds: number;
    binom_p: number;
    ttest_p: number;
  };
}

interface Props {
  results: BacktestSummary[];
}

export function BacktestResults({ results }: Props) {
  if (results.length === 0) {
    return (
      <div className="panel" style={{ padding: 24, textAlign: "center" }}>
        <span style={{ color: "#64748b" }}>
          Walk-forward results will appear here once validation completes.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {results.map((r) => (
        <ConfigResult key={r.config_label} result={r} />
      ))}
    </div>
  );
}

function ConfigResult({ result }: { result: BacktestSummary }) {
  const { config_label, folds, aggregate } = result;

  const foldColors = folds.map((f) =>
    f.profit_factor >= 1.0 ? "#10b981" : "#ef4444",
  );

  // Per-fold PF bar chart
  const pfOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "#334155",
      textStyle: {
        color: "#e2e8f0",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 11,
      },
      formatter: (params: unknown) => {
        const p = (params as { name: string; value: number; dataIndex: number }[])[0];
        if (!p) return "";
        const fold = folds[p.dataIndex];
        return [
          `<b>${fold.test_period}</b>`,
          `PF: ${fold.profit_factor.toFixed(2)}`,
          `Trades: ${fold.num_trades} (${fold.num_long}L/${fold.num_short}S)`,
          `WR: ${(fold.win_rate * 100).toFixed(1)}%`,
          `PnL: ${fold.total_pnl.toFixed(0)} pts`,
        ].join("<br/>");
      },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: "category",
      data: folds.map((f) => f.test_period.split(" to ")[0].slice(0, 7)),
      axisLabel: { color: "#94a3b8", fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: {
      type: "value",
      name: "Profit Factor",
      nameTextStyle: { color: "#64748b", fontSize: 10 },
      axisLabel: {
        color: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
      },
      splitLine: { lineStyle: { color: "#1e293b" } },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    series: [
      {
        type: "bar",
        data: folds.map((f, i) => ({
          value: f.profit_factor,
          itemStyle: {
            color: foldColors[i],
            borderRadius: [3, 3, 0, 0],
          },
        })),
        barWidth: "50%",
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#f59e0b", width: 1, type: "dashed" },
          data: [{ yAxis: 1.0 }],
          label: {
            formatter: "PF=1.0",
            color: "#f59e0b",
            fontSize: 10,
          },
        },
      },
    ],
  };

  // Cumulative PnL across folds
  let cumPnl = 0;
  const equityData = folds.map((f) => {
    cumPnl += f.total_pnl;
    return { period: f.test_period.split(" to ")[0].slice(0, 7), value: cumPnl };
  });

  const equityOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "#334155",
      textStyle: {
        color: "#e2e8f0",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 11,
      },
    },
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: "category",
      data: equityData.map((e) => e.period),
      axisLabel: { color: "#94a3b8", fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: {
      type: "value",
      name: "Cumulative PnL (pts)",
      nameTextStyle: { color: "#64748b", fontSize: 10 },
      axisLabel: {
        color: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
      },
      splitLine: { lineStyle: { color: "#1e293b" } },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    series: [
      {
        type: "line",
        data: equityData.map((e) => e.value),
        lineStyle: { color: cumPnl >= 0 ? "#10b981" : "#ef4444", width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            {
              offset: 0,
              color:
                cumPnl >= 0
                  ? "rgba(16,185,129,0.25)"
                  : "rgba(239,68,68,0.25)",
            },
            { offset: 1, color: "transparent" },
          ]),
        },
        symbol: "circle",
        symbolSize: 6,
        smooth: true,
      },
    ],
  };

  const pfColor =
    aggregate.profit_factor >= 1.2
      ? "#10b981"
      : aggregate.profit_factor >= 1.0
        ? "#f59e0b"
        : "#ef4444";

  const sigStars =
    aggregate.ttest_p < 0.001
      ? "***"
      : aggregate.ttest_p < 0.01
        ? "**"
        : aggregate.ttest_p < 0.05
          ? "*"
          : "n.s.";

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontFamily: "JetBrains Mono, monospace",
              color: "#e2e8f0",
            }}
          >
            {config_label}
          </h3>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            H={result.horizon} T={result.threshold} | {aggregate.total_trades}{" "}
            trades across {aggregate.total_folds} folds
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              fontFamily: "JetBrains Mono, monospace",
              color: pfColor,
            }}
          >
            PF {aggregate.profit_factor.toFixed(2)}
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            95% CI: [{aggregate.bootstrap_pf_95ci[0].toFixed(2)},{" "}
            {aggregate.bootstrap_pf_95ci[1].toFixed(2)}] | p={aggregate.ttest_p.toFixed(4)}{" "}
            {sigStars}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 16,
          padding: "10px 0",
          borderTop: "1px solid #1e293b",
          borderBottom: "1px solid #1e293b",
        }}
      >
        <MiniStat label="Win Rate" value={`${(aggregate.win_rate * 100).toFixed(1)}%`} />
        <MiniStat label="Total PnL" value={`${aggregate.total_pnl.toFixed(0)}`} unit="pts" />
        <MiniStat
          label="Folds > 1.0"
          value={`${aggregate.folds_profitable}/${aggregate.total_folds}`}
        />
        <MiniStat label="Trades/yr" value={`${Math.round(aggregate.total_trades / aggregate.total_folds)}`} />
        <MiniStat label="Binomial p" value={aggregate.binom_p.toFixed(4)} />
      </div>

      {/* Charts side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div className="panel-title" style={{ marginBottom: 4 }}>
            Per-Fold Profit Factor
          </div>
          <ReactEChartsCore
            echarts={echarts}
            option={pfOption}
            style={{ height: 200, width: "100%" }}
            notMerge
            lazyUpdate
          />
        </div>
        <div>
          <div className="panel-title" style={{ marginBottom: 4 }}>
            Cumulative PnL
          </div>
          <ReactEChartsCore
            echarts={echarts}
            option={equityOption}
            style={{ height: 200, width: "100%" }}
            notMerge
            lazyUpdate
          />
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 14,
          fontWeight: 600,
          color: "#e2e8f0",
        }}
      >
        {value}
        {unit && (
          <span style={{ fontSize: 10, color: "#64748b", marginLeft: 2 }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
