/**
 * Walk-forward backtest results display.
 * Shows probabilistic evaluation (calibration, CRPS skill) and trading results.
 * Reads from a static JSON file that gets updated after walk-forward completes.
 */

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatHorizon } from "../../api/format";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

// ── Types ──

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

export interface TradingSummary {
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

interface CalibrationBand {
  expected: number;
  by_horizon: Record<string, { coverage: number; width_pts: number }>;
}

interface ProbFold {
  fold: number;
  test_period: string;
  windows: number;
  calibration: Record<string, CalibrationBand>;
  crps: Record<string, number>;
  rw_crps: Record<string, number>;
  band_width_h78: number;
}

export interface ProbabilisticResults {
  total_windows: number;
  total_folds: number;
  horizons: number[];
  crps: Record<string, number>;
  rw_crps: Record<string, number>;
  crps_skill: Record<string, number>;
  calibration: Record<string, CalibrationBand>;
  per_fold: ProbFold[];
}

export interface BacktestData {
  trading: TradingSummary[];
  probabilistic: ProbabilisticResults;
}

// Legacy support
export type BacktestSummary = TradingSummary;

// ── Components ──

interface Props {
  data: BacktestData;
}

export function BacktestResults({ data }: Props) {
  const { trading, probabilistic } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Probabilistic evaluation */}
      <ProbabilisticSection prob={probabilistic} />

      {/* Trading results */}
      <div style={{ marginTop: 8 }}>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 700,
            fontFamily: "Inter, sans-serif",
            color: "#94a3b8",
            marginBottom: 12,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          Signal-Based Trading Evaluation
        </h2>
        <p style={{ fontSize: 11, color: "#64748b", marginBottom: 16, lineHeight: 1.5 }}>
          Threshold-based long/short signals with D'Alembert position sizing. Hold-until-flip.
          These results depend on signal extraction — the underlying distribution quality above is the
          fundamental measure of model performance.
        </p>
        {trading.map((r) => (
          <TradingConfigResult key={r.config_label} result={r} />
        ))}
      </div>
    </div>
  );
}

// ── Probabilistic Section ──

function ProbabilisticSection({ prob }: { prob: ProbabilisticResults }) {
  const horizons = prob.horizons;

  // CRPS Skill chart
  const skillData = horizons.map((h) => ({
    horizon: h,
    skill: (prob.crps_skill[String(h)] || 0) * 100,
    crps: prob.crps[String(h)] || 0,
    rw: prob.rw_crps[String(h)] || 0,
  }));

  const skillOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      formatter: (params: unknown) => {
        const ps = params as { name: string; value: number; dataIndex: number }[];
        const p = ps[0];
        if (!p) return "";
        const d = skillData[p.dataIndex];
        return [
          `<b>${formatHorizon(d.horizon)}</b>`,
          `CRPS Skill: +${d.skill.toFixed(1)}%`,
          `Model: ${d.crps.toFixed(6)}`,
          `Random Walk: ${d.rw.toFixed(6)}`,
        ].join("<br/>");
      },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: "category",
      data: horizons.map((h) => formatHorizon(h)),
      axisLabel: { color: "#94a3b8", fontSize: 10 },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: {
      type: "value",
      name: "CRPS Skill (%)",
      nameTextStyle: { color: "#64748b", fontSize: 10 },
      axisLabel: {
        color: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        formatter: "{value}%",
      },
      splitLine: { lineStyle: { color: "#1e293b" } },
      axisLine: { lineStyle: { color: "#334155" } },
      min: 0,
    },
    series: [
      {
        type: "bar",
        data: skillData.map((d) => ({
          value: d.skill,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#3b82f6" },
              { offset: 1, color: "#1e40af" },
            ]),
            borderRadius: [3, 3, 0, 0],
          },
        })),
        barWidth: "50%",
      },
    ],
  };

  // Calibration chart — coverage vs expected
  const p1090 = prob.calibration["P10-P90"];
  const p2575 = prob.calibration["P25-P75"];

  const calData = horizons.map((h) => {
    const hk = String(h);
    return {
      horizon: h,
      p1090_cov: (p1090?.by_horizon[hk]?.coverage || 0) * 100,
      p1090_width: p1090?.by_horizon[hk]?.width_pts || 0,
      p2575_cov: (p2575?.by_horizon[hk]?.coverage || 0) * 100,
      p2575_width: p2575?.by_horizon[hk]?.width_pts || 0,
    };
  });

  const calOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      formatter: (params: unknown) => {
        const ps = params as { seriesName: string; value: number; dataIndex: number }[];
        if (!ps.length) return "";
        const d = calData[ps[0].dataIndex];
        return [
          `<b>${formatHorizon(d.horizon)}</b>`,
          `P10-P90: ${d.p1090_cov.toFixed(1)}% (target 80%) | ${d.p1090_width.toFixed(1)}pts`,
          `P25-P75: ${d.p2575_cov.toFixed(1)}% (target 50%) | ${d.p2575_width.toFixed(1)}pts`,
        ].join("<br/>");
      },
    },
    legend: {
      data: ["P10-P90 Coverage", "P25-P75 Coverage"],
      textStyle: { color: "#94a3b8", fontSize: 10 },
      top: 0,
    },
    grid: { left: 50, right: 20, top: 30, bottom: 30 },
    xAxis: {
      type: "category",
      data: horizons.map((h) => formatHorizon(h)),
      axisLabel: { color: "#94a3b8", fontSize: 10 },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: {
      type: "value",
      name: "Coverage (%)",
      nameTextStyle: { color: "#64748b", fontSize: 10 },
      axisLabel: {
        color: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        formatter: "{value}%",
      },
      splitLine: { lineStyle: { color: "#1e293b" } },
      axisLine: { lineStyle: { color: "#334155" } },
      min: 0,
      max: 100,
    },
    series: [
      {
        name: "P10-P90 Coverage",
        type: "line",
        data: calData.map((d) => d.p1090_cov),
        lineStyle: { color: "#3b82f6", width: 2 },
        symbol: "circle",
        symbolSize: 6,
        itemStyle: { color: "#3b82f6" },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#3b82f680", width: 1, type: "dashed" },
          data: [{ yAxis: 80 }],
          label: { formatter: "80% target", color: "#3b82f6", fontSize: 9 },
        },
      },
      {
        name: "P25-P75 Coverage",
        type: "line",
        data: calData.map((d) => d.p2575_cov),
        lineStyle: { color: "#8b5cf6", width: 2 },
        symbol: "circle",
        symbolSize: 6,
        itemStyle: { color: "#8b5cf6" },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#8b5cf680", width: 1, type: "dashed" },
          data: [{ yAxis: 50 }],
          label: { formatter: "50% target", color: "#8b5cf6", fontSize: 9 },
        },
      },
    ],
  };

  // Per-fold calibration chart
  const foldCalData = prob.per_fold.map((fp) => {
    const cov = fp.calibration?.["P10-P90"]?.by_horizon?.["78"]?.coverage || 0;
    return {
      fold: fp.fold,
      period: fp.test_period.split(" to ")[0].slice(0, 7),
      coverage: cov * 100,
      width: fp.band_width_h78,
      windows: fp.windows,
    };
  });

  const foldCalOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      formatter: (params: unknown) => {
        const ps = params as { value: number; dataIndex: number }[];
        if (!ps.length) return "";
        const d = foldCalData[ps[0].dataIndex];
        return [
          `<b>${prob.per_fold[d.fold].test_period}</b>`,
          `P10-P90 Coverage: ${d.coverage.toFixed(1)}%`,
          `Band Width: ${d.width.toFixed(1)} pts`,
          `Windows: ${d.windows}`,
        ].join("<br/>");
      },
    },
    grid: { left: 50, right: 40, top: 20, bottom: 30 },
    xAxis: {
      type: "category",
      data: foldCalData.map((d) => d.period),
      axisLabel: { color: "#94a3b8", fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: [
      {
        type: "value",
        name: "Coverage (%)",
        nameTextStyle: { color: "#64748b", fontSize: 10 },
        axisLabel: { color: "#94a3b8", fontSize: 10, formatter: "{value}%" },
        splitLine: { lineStyle: { color: "#1e293b" } },
        min: 0,
        max: 100,
      },
      {
        type: "value",
        name: "Width (pts)",
        nameTextStyle: { color: "#64748b", fontSize: 10 },
        axisLabel: { color: "#94a3b8", fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        type: "bar",
        data: foldCalData.map((d) => ({
          value: d.coverage,
          itemStyle: {
            color:
              Math.abs(d.coverage - 80) < 5
                ? "#10b981"
                : d.coverage > 85
                  ? "#f59e0b"
                  : "#ef4444",
            borderRadius: [3, 3, 0, 0],
          },
        })),
        barWidth: "40%",
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#3b82f680", width: 1, type: "dashed" },
          data: [{ yAxis: 80 }],
          label: { formatter: "80%", color: "#3b82f6", fontSize: 9 },
        },
      },
      {
        type: "line",
        yAxisIndex: 1,
        data: foldCalData.map((d) => d.width),
        lineStyle: { color: "#f59e0b", width: 2 },
        symbol: "circle",
        symbolSize: 5,
        itemStyle: { color: "#f59e0b" },
      },
    ],
  };

  // Aggregate stats
  const meanSkill = Object.values(prob.crps_skill).reduce((a, b) => a + b, 0) / Object.values(prob.crps_skill).length;
  const h78Cal = p1090?.by_horizon["78"];
  const h78Width = h78Cal?.width_pts || 0;
  const h78Cov = (h78Cal?.coverage || 0) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary stats */}
      <div className="panel fade-in" style={{ padding: 16 }}>
        <div className="panel-header">
          <span className="panel-title">Model Quality Summary</span>
          <span style={{ fontSize: 10, color: "#64748b" }}>
            {prob.total_windows.toLocaleString()} windows | {prob.total_folds} folds | 7.5 years OOS
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
            marginTop: 12,
          }}
        >
          <BigStat
            label="CRPS Skill vs Random Walk"
            value={`+${(meanSkill * 100).toFixed(1)}%`}
            color="#3b82f6"
            detail="Lower CRPS = better probabilistic forecasts"
          />
          <BigStat
            label="P10-P90 Coverage @ 6.5hr"
            value={`${h78Cov.toFixed(0)}%`}
            target="80%"
            color={Math.abs(h78Cov - 80) < 5 ? "#10b981" : "#f59e0b"}
            detail={`Band width: ${h78Width.toFixed(0)} pts`}
          />
          <BigStat
            label="Forecast Windows"
            value={prob.total_windows.toLocaleString()}
            color="#e2e8f0"
            detail="Stride-12 across 8 annual test periods"
          />
          <BigStat
            label="Calibration Status"
            value={h78Cov < 75 ? "Underdispersed" : h78Cov > 85 ? "Overdispersed" : "Calibrated"}
            color={h78Cov < 75 ? "#f59e0b" : h78Cov > 85 ? "#f59e0b" : "#10b981"}
            detail={h78Cov < 75 ? "Bands too narrow — ACI recalibration needed" : "Bands well-sized"}
          />
        </div>
      </div>

      {/* Charts row 1: CRPS Skill + Calibration by horizon */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="panel fade-in" style={{ padding: 16 }}>
          <div className="panel-title" style={{ marginBottom: 8 }}>
            CRPS Skill vs Random Walk by Horizon
          </div>
          <p style={{ fontSize: 10, color: "#64748b", marginBottom: 8 }}>
            Higher = model's probability distribution is more accurate than random walk
          </p>
          <ReactEChartsCore
            echarts={echarts}
            option={skillOption}
            style={{ height: 220, width: "100%" }}
            notMerge
            lazyUpdate
          />
        </div>

        <div className="panel fade-in" style={{ padding: 16 }}>
          <div className="panel-title" style={{ marginBottom: 8 }}>
            Prediction Band Coverage by Horizon
          </div>
          <p style={{ fontSize: 10, color: "#64748b", marginBottom: 8 }}>
            Dashed lines = target coverage. Gap = underdispersion (bands too narrow)
          </p>
          <ReactEChartsCore
            echarts={echarts}
            option={calOption}
            style={{ height: 220, width: "100%" }}
            notMerge
            lazyUpdate
          />
        </div>
      </div>

      {/* Chart row 2: Per-fold calibration */}
      <div className="panel fade-in" style={{ padding: 16 }}>
        <div className="panel-title" style={{ marginBottom: 8 }}>
          Per-Fold P10-P90 Coverage @ 6.5hr (bars) + Band Width (line)
        </div>
        <p style={{ fontSize: 10, color: "#64748b", marginBottom: 8 }}>
          Green = well-calibrated (&plusmn;5% of 80%), red = underdispersed, amber = overdispersed.
          Band width adapts to market regime (wider in volatile periods).
        </p>
        <ReactEChartsCore
          echarts={echarts}
          option={foldCalOption}
          style={{ height: 240, width: "100%" }}
          notMerge
          lazyUpdate
        />
      </div>
    </div>
  );
}

// ── Trading Config Result (existing, refined) ──

function TradingConfigResult({ result }: { result: TradingSummary }) {
  const { config_label, folds, aggregate } = result;

  const foldColors = folds.map((f) =>
    f.profit_factor >= 1.0 ? "#10b981" : "#ef4444",
  );

  const pfOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1e293b",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
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
      axisLabel: { color: "#94a3b8", fontFamily: "JetBrains Mono, monospace", fontSize: 10 },
      splitLine: { lineStyle: { color: "#1e293b" } },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    series: [
      {
        type: "bar",
        data: folds.map((f, i) => ({
          value: f.profit_factor,
          itemStyle: { color: foldColors[i], borderRadius: [3, 3, 0, 0] },
        })),
        barWidth: "50%",
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#f59e0b", width: 1, type: "dashed" },
          data: [{ yAxis: 1.0 }],
          label: { formatter: "PF=1.0", color: "#f59e0b", fontSize: 10 },
        },
      },
    ],
  };

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
      textStyle: { color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
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
      axisLabel: { color: "#94a3b8", fontFamily: "JetBrains Mono, monospace", fontSize: 10 },
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
            { offset: 0, color: cumPnl >= 0 ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)" },
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
    <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
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
            Horizon={formatHorizon(result.horizon)} Threshold={result.threshold} |{" "}
            {aggregate.total_trades} trades across {aggregate.total_folds} folds
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
        <MiniStat
          label="Trades/yr"
          value={`${Math.round(aggregate.total_trades / aggregate.total_folds)}`}
        />
        <MiniStat label="Binomial p" value={aggregate.binom_p.toFixed(4)} />
      </div>

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

// ── Shared Components ──

function BigStat({
  label,
  value,
  color,
  detail,
  target,
}: {
  label: string;
  value: string;
  color: string;
  detail?: string;
  target?: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "12px 8px",
        background: "#0f172a",
        borderRadius: 8,
        border: "1px solid #1e293b",
      }}
    >
      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 22,
          fontWeight: 700,
          color,
        }}
      >
        {value}
      </div>
      {target && (
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>target: {target}</div>
      )}
      {detail && (
        <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>{detail}</div>
      )}
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
      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>{label}</div>
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
          <span style={{ fontSize: 10, color: "#64748b", marginLeft: 2 }}>{unit}</span>
        )}
      </div>
    </div>
  );
}
