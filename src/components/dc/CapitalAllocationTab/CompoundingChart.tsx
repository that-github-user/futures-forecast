/**
 * CompoundingChart — Panel C. Log-scale equity projection over the
 * policy's horizon: jittered sample paths behind, reference-policy
 * dashed overlays, p5/p95 Monte Carlo bands where documented,
 * solid median, start-line dotted. Plus a row of milestone cards
 * below (1y / 3y / historical-terminal).
 *
 * Two semantic flavors share one chart:
 *   - Compounding policies (policy.backtest set): multiplier curves
 *     scaled by portfolioSize. At $500K start, a 100× multiplier
 *     really means $50M terminal.
 *   - Linear policies (policy.linear_growth set, e.g. static_1ct):
 *     absolute dollar P/L is capital-invariant. 1 contract makes the
 *     same dollar gain whether the user is at $25K or $500K.
 *
 * Imports ReactECharts directly. Together with EVRankingPanel.tsx
 * these are the only two files in the tab that do so — a future
 * lazy-load would target these two.
 */

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { colors, fonts, withAlpha, withAlphaByte } from "../../../styles/tokens";
import type { DCAllocationPolicy, DCCompoundingCurve } from "../../../api/dcTypes";
import { samplePaths, samplePathsLinear } from "../../../lib/dcPathSim";
import { SPX_MULTIPLIER } from "../../../lib/dcSizing";
import { formatCompact, Panel } from "./shared";

const N_SAMPLE_PATHS = 8;

interface ReferenceOverlay {
  policy: DCAllocationPolicy;
  curve: DCCompoundingCurve;
}

export function CompoundingChart({
  curve,
  policy,
  portfolioSize,
  referenceOverlays = [],
}: {
  curve: DCCompoundingCurve;
  policy: DCAllocationPolicy;
  portfolioSize: number;
  referenceOverlays?: ReferenceOverlay[];
}) {
  const option = useMemo(() => {
    const months = curve.months;
    const horizonMonths = months.length - 1;
    const lg = policy.linear_growth;
    // `!= null` (loose) intentionally matches both `null` AND `undefined`.
    // Strict `!== null` would return `true` when the backend omits the
    // field entirely — e.g. a stale dc-api deploy that doesn't yet know
    // about linear_growth — and then the branch below would crash on
    // `lg.monthly_pl`. That crash renders a blank Capital tab.
    const isLinear = lg != null;

    // Two semantic flavors, one chart:
    //
    //   Compounding policies (policy.backtest set): backend emits multiplier
    //   curves. Dollar equity = multiplier × portfolioSize (at $500K start,
    //   a 100× multiplier really does mean $50M terminal — that's the point
    //   of compounding).
    //
    //   Linear policies (policy.linear_growth set, e.g. static_1ct): the
    //   ABSOLUTE dollar P/L from 1 contract per entry is capital-invariant.
    //   A user at $25K and a user at $500K both make ~$87K/yr at 1ct.
    //   Backend emits an EMPTY median_multiplier to signal "don't scale";
    //   frontend builds median = portfolioSize + monthly_pl × t directly,
    //   and sample paths use unscaled monthly_pl / monthly_sigma.
    let median: number[];
    if (lg != null) {
      median = Array.from({ length: horizonMonths + 1 }, (_, t) =>
        Math.max(portfolioSize + lg.monthly_pl * t, 1),
      );
    } else {
      median = curve.median_multiplier.map((m) => Math.max(m * portfolioSize, 1));
    }

    // p5/p95 arrays are empty for policies without documented Monte Carlo
    // (only the `live` policy has MC) or for linear policies. Hide the band
    // in that case rather than showing fabricated data.
    const hasBand =
      !isLinear &&
      curve.p5_multiplier.length === months.length &&
      curve.p95_multiplier.length === months.length;
    const p5 = hasBand ? curve.p5_multiplier.map((m) => Math.max(m * portfolioSize, 1)) : [];
    const p95 = hasBand ? curve.p95_multiplier.map((m) => Math.max(m * portfolioSize, 1)) : [];

    // Client-side illustrative sample paths. Two flavors:
    //   - Compounding: GBM around the exponential median, MaxDD-calibrated.
    //     Generated as multipliers then scaled to dollars.
    //   - Linear: additive Gaussian noise around the straight-line median,
    //     sigma from linear_growth.monthly_sigma (UNSCALED — 1ct P/L
    //     variance is also capital-invariant). Generated directly in dollars.
    let jitteredPaths: number[][] = [];
    if (lg != null) {
      jitteredPaths = samplePathsLinear(policy.key, N_SAMPLE_PATHS, {
        horizonMonths,
        startEquity: portfolioSize,
        monthlyPL: lg.monthly_pl,
        monthlySigma: lg.monthly_sigma,
      });
    } else if (policy.backtest != null) {
      const bt = policy.backtest;
      const terminalMult = bt.terminal_equity / bt.start_equity;
      jitteredPaths = samplePaths(policy.key, N_SAMPLE_PATHS, {
        horizonMonths,
        terminalMultiplier: terminalMult,
        maxDdPct: bt.max_dd_pct,
      }).map((path) => path.map((m) => Math.max(m * portfolioSize, 1)));
    }

    const series: Array<Record<string, unknown>> = [];

    // Jittered sample paths first (lowest z-index — behind the median + bands).
    for (const [idx, path] of jitteredPaths.entries()) {
      series.push({
        name: `Illustrative path ${idx + 1}`,
        type: "line",
        data: path,
        lineStyle: { color: withAlphaByte(colors.accentGreen, 0x28), width: 1 },
        symbol: "none",
        showInLegend: false,
        tooltip: { show: false },
        z: 0,
      });
    }

    // Reference-only policy overlays (dashed, neutral color). Rendered behind
    // the primary median so the user's chosen policy visually dominates, but
    // above the jitter so the comparison is legible.
    for (const { policy: refPolicy, curve: refCurve } of referenceOverlays) {
      if (refCurve.months.length !== months.length) continue;
      series.push({
        name: `${refPolicy.name} (reference)`,
        type: "line",
        data: refCurve.median_multiplier.map((m) => Math.max(m * portfolioSize, 1)),
        lineStyle: { color: colors.textSecondary, width: 1.5, type: "dashed" },
        symbol: "none",
        z: 1,
      });
    }

    series.push(
      {
        name: "Median",
        type: "line",
        data: median,
        lineStyle: { color: colors.accentGreen, width: 2 },
        symbol: "none",
        z: 3,
      },
      {
        name: "Start",
        type: "line",
        data: months.map(() => portfolioSize),
        lineStyle: { color: colors.textDim, type: "dotted", width: 1 },
        symbol: "none",
        z: 0,
      },
    );
    if (hasBand) {
      series.push(
        {
          name: "p95",
          type: "line",
          data: p95,
          lineStyle: { color: withAlpha(colors.accentGreen, 0.375), type: "dashed", width: 1 },
          symbol: "none",
          z: 2,
        },
        {
          name: "p5",
          type: "line",
          data: p5,
          lineStyle: { color: withAlpha(colors.accentGreen, 0.375), type: "dashed", width: 1 },
          symbol: "none",
          z: 2,
        },
      );
    }

    return {
      grid: { left: 70, right: 40, top: 30, bottom: 40 },
      tooltip: {
        trigger: "axis",
        backgroundColor: colors.bgInset,
        borderColor: colors.borderDim,
        textStyle: { color: colors.textPrimary, fontSize: 11 },
        formatter: (params: Array<{ axisValue: number; seriesName: string; value: number }> | { axisValue: number; seriesName: string; value: number }) => {
          const arr = Array.isArray(params) ? params : [params];
          if (!arr.length) return "";
          // Skip the "Illustrative path N" series in the tooltip — there are 8
          // of them and they'd swamp the real signal (Median / p5 / p95).
          const filtered = arr.filter((p) => !p.seriesName.startsWith("Illustrative path"));
          if (!filtered.length) return "";
          const month = filtered[0].axisValue;
          const lines = [
            `<b>Month ${month}</b> (${(month / 12).toFixed(1)}y)`,
            ...filtered.map((p) => `${p.seriesName}: $${formatCompact(p.value)}`),
          ];
          return lines.join("<br/>");
        },
      },
      xAxis: {
        type: "category",
        data: months,
        name: "Months",
        nameLocation: "middle",
        nameGap: 25,
        nameTextStyle: { color: colors.textMuted, fontSize: 11 },
        axisLabel: { color: colors.textMuted, fontSize: 10, interval: 5 },
        axisLine: { lineStyle: { color: colors.borderMid } },
      },
      yAxis: {
        type: "log",
        name: "Equity ($)",
        nameLocation: "middle",
        nameGap: 55,
        nameTextStyle: { color: colors.textMuted, fontSize: 11 },
        axisLabel: { color: colors.textMuted, fontSize: 10, formatter: (v: number) => `$${formatCompact(v)}` },
        splitLine: { lineStyle: { color: colors.borderDim } },
      },
      series,
    };
  }, [curve, policy, portfolioSize, referenceOverlays]);

  // Milestone annotations (read directly off the computed median curve).
  // Horizon is read from the backend curve so the milestones move with the
  // validated window (currently 35 months / 2.91y under the ensemble-gate run).
  const milestone = (m: number) => {
    const idx = curve.months.indexOf(m);
    if (idx < 0) return null;
    return curve.median_multiplier[idx] * portfolioSize;
  };
  const horizonMonths = curve.months.length - 1;
  const y1 = milestone(12);
  // Second milestone tracks the validated terminal — at the 35-month window
  // there is no month 36, so anchor on horizonMonths directly. If the window
  // grows past 36 (e.g. a future refit), Y3 still lands on 36.
  const yLate = milestone(Math.min(36, horizonMonths));
  const yLateLabel = horizonMonths >= 36 ? "3y median" : `${(horizonMonths / 12).toFixed(2)}y median`;

  // `!= null` handles both null (fresh backend) and undefined (old backend
  // that doesn't serialize the field). Strict `!==` would crash below when
  // the branch accesses policy.linear_growth fields on undefined.
  const isLinear = policy.linear_growth != null;
  const hasBand =
    !isLinear && curve.p5_multiplier.length === curve.months.length;
  const overlayNote = referenceOverlays.length
    ? ` Dashed gray = ${referenceOverlays.map((r) => r.policy.name).join(" / ")} for comparison.`
    : "";
  const subtitle = isLinear
    ? `${policy.name}: linear growth at ~$${Math.round((policy.linear_growth?.monthly_pl ?? 0) * 12 / 1000)}K/yr from 1-contract EV (capital-invariant — the dollar P/L doesn't depend on your portfolio size) + ${N_SAMPLE_PATHS} sample paths with ±$${Math.round((policy.linear_growth?.monthly_sigma ?? 0) / 1000)}K/mo jitter.${overlayNote}`
    : hasBand
    ? `${policy.name}: solid median + p5/p95 Monte Carlo band + ${N_SAMPLE_PATHS} illustrative paths scaled by historical drawdown. The single deterministic backtest sits near MC p95 (a favorable historical draw); use the MC median for honest planning.${overlayNote}`
    : `${policy.name}: deterministic median from the live-signal backtest + ${N_SAMPLE_PATHS} illustrative paths (Monte Carlo not run for this variant).${overlayNote}`;

  return (
    <Panel title="Compounding Growth Projection" subtitle={subtitle}>
      <div style={{ height: 360 }}>
        <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 8,
          marginTop: 10,
          fontFamily: fonts.mono,
        }}
      >
        <Milestone label="1y median" value={y1} />
        <Milestone label={yLateLabel} value={yLate} />
        <Milestone
          label={
            policy.backtest
              ? `Historical ${policy.backtest.years}y`
              : isLinear
              ? "2.91y linear"
              : "Baseline"
          }
          value={
            policy.backtest
              ? policy.backtest.terminal_equity * (portfolioSize / policy.backtest.start_equity)
              : isLinear && policy.linear_growth
              ? // 1ct terminal across the validated backtest window (35 months).
                // The monthly P/L is unscaled — 1 contract produces the same
                // dollar gain regardless of account size.
                portfolioSize + policy.linear_growth.monthly_pl * 35
              : portfolioSize
          }
          color={colors.accentBlue}
        />
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: colors.textMuted, fontStyle: "italic" }}>
        {isLinear
          ? `Static 1-contract sizing. Growth numbers are back-of-envelope from §4 EV × §8 schedule × §3 fire rate — replace with a static-sizing backtest when available. Past performance ≠ future results.`
          : `Backtest of the live signal stream: GO+ sizing ${policy.go_plus_mult}×, margin caps ${policy.global_pct}% portfolio / ${policy.per_strat_pct}% per strategy, hard cap ${policy.hard_cap} contracts, SPX multiplier ${SPX_MULTIPLIER}. Window: ${policy.backtest?.years ?? 2.91} years. Past performance ≠ future results.`}
      </div>
    </Panel>
  );
}

function Milestone({ label, value, color = colors.accentGreen }: { label: string; value: number | null; color?: string }) {
  return (
    <div style={{ background: colors.bgPanel, border: `1px solid ${colors.borderDim}`, borderRadius: 6, padding: "6px 10px" }}>
      <div style={{ fontSize: 9, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: fonts.sans }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: value != null ? color : colors.textDim }}>
        {value != null ? `$${formatCompact(value)}` : "—"}
      </div>
    </div>
  );
}
