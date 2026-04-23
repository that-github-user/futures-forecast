/**
 * EVRankingPanel — Panel D (static reference at the bottom). Renders
 * the vega-prime EV/margin-day capital-efficiency ranking as a
 * side-by-side table + horizontal bar chart. Static across
 * portfolio size and policy choice — it's reference material, not
 * something the user's inputs change.
 *
 * Imports ReactECharts directly. Together with CompoundingChart.tsx
 * these are the only two files in the tab that do so — a future
 * lazy-load would target these two.
 */

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { colors, fonts } from "../../../styles/tokens";
import type { DCEVRankingRow } from "../../../api/dcTypes";
import { Panel } from "./shared";

export function EVRankingPanel({ rows }: { rows: DCEVRankingRow[] }) {
  // Hooks MUST stay above any early return so React sees a consistent
  // hook count across renders (error #310). If `rows` goes empty → non-empty
  // between renders, the `useMemo` count changing would blow up the tree.
  const maxEv = rows.length > 0 ? Math.max(...rows.map((r) => r.ev_mg_day)) : 0;
  const chartOption = useMemo(
    () => ({
      grid: { left: 90, right: 40, top: 20, bottom: 20 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: colors.bgInset,
        borderColor: colors.borderDim,
        textStyle: { color: colors.textPrimary, fontSize: 11 },
      },
      xAxis: {
        type: "value",
        axisLabel: { color: colors.textMuted, fontSize: 10, formatter: (v: number) => `$${v.toFixed(3)}` },
        splitLine: { lineStyle: { color: colors.borderDim } },
      },
      yAxis: {
        type: "category",
        data: [...rows].reverse().map((r) => r.strategy),
        axisLabel: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.mono },
        axisLine: { lineStyle: { color: colors.borderMid } },
      },
      series: [
        {
          type: "bar",
          data: [...rows].reverse().map((r) => ({
            value: r.ev_mg_day,
            itemStyle: { color: r.ev_mg_day > maxEv / 2 ? colors.accentGreen : colors.accentBlue },
          })),
          barWidth: "65%",
          label: {
            show: true,
            position: "right",
            color: colors.textPrimary,
            fontSize: 10,
            formatter: (p: { value: number }) => `$${p.value.toFixed(4)}`,
          },
        },
      ],
    }),
    [rows, maxEv],
  );

  if (rows.length === 0) {
    return (
      <Panel
        title="Capital Efficiency — EV per Margin-Day"
        subtitle="No ranking data available"
      >
        <div style={{ color: colors.textMuted, fontSize: 12, padding: 20, textAlign: "center" }}>
          EV ranking unavailable — daemon may be offline.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Capital Efficiency — EV per Margin-Day"
      subtitle="Expected dollars of profit per dollar of margin per day held (CAPITAL_ALLOCATION.md §4)"
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.mono, fontSize: 12, color: colors.textPrimary }}>
            <thead>
              <tr style={{ color: colors.textMuted, textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: 4 }}>#</th>
                <th style={{ textAlign: "left", padding: 4 }}>Strategy</th>
                <th style={{ padding: 4 }}>E[P/L]</th>
                <th style={{ padding: 4 }}>Margin</th>
                <th style={{ padding: 4 }}>Hold</th>
                <th style={{ padding: 4 }}>EV/MgDay</th>
                <th style={{ padding: 4 }}>PF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rank} style={{ borderTop: `1px solid ${colors.borderDim}` }}>
                  <td style={{ padding: 4, color: colors.textMuted }}>{r.rank}</td>
                  <td style={{ padding: 4, color: colors.textPrimary }}>{r.strategy}</td>
                  <td style={{ textAlign: "right", padding: 4 }}>${r.e_pl.toFixed(0)}</td>
                  <td style={{ textAlign: "right", padding: 4 }}>${r.margin.toFixed(0)}</td>
                  <td style={{ textAlign: "right", padding: 4 }}>{r.avg_hold.toFixed(1)}d</td>
                  <td style={{ textAlign: "right", padding: 4, color: colors.accentGreen }}>${r.ev_mg_day.toFixed(4)}</td>
                  <td style={{ textAlign: "right", padding: 4 }}>{r.pf.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Bar chart */}
        <div style={{ height: 360 }}>
          <ReactECharts option={chartOption} style={{ height: "100%", width: "100%" }} />
        </div>
      </div>
    </Panel>
  );
}
