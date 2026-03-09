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

export interface TradingSummary {
  config_label: string;
  horizon: number;
  threshold: number;
  aggregate: {
    total_folds: number;
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

// ── Components ──

interface Props {
  data: BacktestData;
}

export function BacktestResults({ data }: Props) {
  const { probabilistic } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ProbabilisticSection prob={probabilistic} />
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
    const p1090h = p1090?.by_horizon[hk];
    const p2575h = p2575?.by_horizon[hk];
    return {
      horizon: h,
      p1090_cov: (p1090h?.coverage || 0) * 100,
      p1090_width: p1090h?.width_pts || 0,
      p1090_cov_recal: ((p1090h as Record<string, number>)?.coverage_recal || 0) * 100,
      p2575_cov: (p2575h?.coverage || 0) * 100,
      p2575_width: p2575h?.width_pts || 0,
      p2575_cov_recal: ((p2575h as Record<string, number>)?.coverage_recal || 0) * 100,
    };
  });
  const hasRecal = calData.some((d) => d.p1090_cov_recal > 0);

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
        const lines = [
          `<b>${formatHorizon(d.horizon)}</b>`,
          `P10-P90 raw: ${d.p1090_cov.toFixed(1)}% (target 80%) | ${d.p1090_width.toFixed(1)}pts`,
        ];
        if (d.p1090_cov_recal > 0) lines.push(`P10-P90 recal: ${d.p1090_cov_recal.toFixed(1)}%`);
        lines.push(`P25-P75 raw: ${d.p2575_cov.toFixed(1)}% (target 50%) | ${d.p2575_width.toFixed(1)}pts`);
        return [
          ...lines,
        ].join("<br/>");
      },
    },
    legend: {
      data: hasRecal
        ? ["P10-P90 Raw", "P10-P90 Recalibrated", "P25-P75 Raw"]
        : ["P10-P90 Coverage", "P25-P75 Coverage"],
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
        name: hasRecal ? "P10-P90 Raw" : "P10-P90 Coverage",
        type: "line",
        data: calData.map((d) => d.p1090_cov),
        lineStyle: { color: "#3b82f6", width: 2, type: hasRecal ? "dashed" : "solid" },
        symbol: "circle",
        symbolSize: 5,
        itemStyle: { color: "#3b82f6" },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#3b82f680", width: 1, type: "dashed" },
          data: [{ yAxis: 80 }],
          label: { formatter: "80% target", color: "#3b82f6", fontSize: 9 },
        },
      },
      ...(hasRecal
        ? [
            {
              name: "P10-P90 Recalibrated",
              type: "line" as const,
              data: calData.map((d) => d.p1090_cov_recal),
              lineStyle: { color: "#10b981", width: 2.5 },
              symbol: "diamond" as const,
              symbolSize: 7,
              itemStyle: { color: "#10b981" },
            },
          ]
        : []),
      {
        name: hasRecal ? "P25-P75 Raw" : "P25-P75 Coverage",
        type: "line",
        data: calData.map((d) => d.p2575_cov),
        lineStyle: { color: "#8b5cf6", width: 2 },
        symbol: "circle",
        symbolSize: 5,
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
  const h78CalAny = h78Cal as Record<string, number> | undefined;
  const h78Width = h78Cal?.width_pts || 0;
  const h78CovRaw = (h78Cal?.coverage || 0) * 100;
  const h78CovRecal = (h78CalAny?.coverage_recal || 0) * 100;
  const h78Cov = h78CovRecal > 0 ? h78CovRecal : h78CovRaw;
  const h78WidthRecal = h78CalAny?.width_pts_recal || h78Width;

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
            label={h78CovRecal > 0 ? "P10-P90 Coverage (recal) @ 6.5hr" : "P10-P90 Coverage @ 6.5hr"}
            value={`${h78Cov.toFixed(0)}%`}
            target="80%"
            color={Math.abs(h78Cov - 80) < 5 ? "#10b981" : "#f59e0b"}
            detail={`Band width: ${h78WidthRecal.toFixed(0)} pts${h78CovRecal > 0 ? ` (raw: ${h78CovRaw.toFixed(0)}%)` : ""}`}
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
            detail={
              h78CovRecal > 0
                ? `Quantile recalibration applied (raw: ${h78CovRaw.toFixed(0)}%)`
                : h78Cov < 75
                  ? "Bands too narrow - ACI recalibration needed"
                  : "Bands well-sized"
            }
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

