/**
 * SizingGrid — Panel B. Per-strategy contract-count table at the
 * user's current portfolio size and selected allocation policy.
 * Shows base (DAl=1), DAl-capped, GO+ boosted, and per-strategy
 * capital cap in one row per DC strategy. Cheapest strategies
 * first (matches CAPITAL_ALLOCATION.md §6).
 */

import { useMemo } from "react";
import { colors, fonts } from "../../../styles/tokens";
import type { DCAllocationPolicy, DCPosition, DCStrategySpec } from "../../../api/dcTypes";
import { computeSuggestedContracts } from "../../../lib/dcSizing";
import { formatCompact, Panel } from "./shared";

export function SizingGrid({
  specs,
  policy,
  portfolioSize,
  positions,
}: {
  specs: DCStrategySpec[];
  policy: DCAllocationPolicy;
  portfolioSize: number;
  positions: DCPosition[];
}) {
  // Only DC strategies (filter out SPY — not validated for the tab yet) that have avg_margin.
  const rows = useMemo(() => {
    const dcSpecs = specs.filter((s) => s.avg_margin != null && !s.family.startsWith("spy"));
    // Sort by margin ascending — cheapest first, matches §6 table.
    dcSpecs.sort((a, b) => (a.avg_margin ?? 0) - (b.avg_margin ?? 0));
    return dcSpecs.map((spec) => {
      const go = computeSuggestedContracts({
        spec,
        signal: "GO",
        portfolioSize,
        policy,
        currentDalMult: 1,
        openPositions: positions,
        marginPerContract: (spec.avg_margin ?? 0),
      });
      const dalCap = computeSuggestedContracts({
        spec,
        signal: "GO",
        portfolioSize,
        policy,
        currentDalMult: policy.dal_cap,
        openPositions: positions,
        marginPerContract: (spec.avg_margin ?? 0),
      });
      const goPlus = computeSuggestedContracts({
        spec,
        signal: "GO_PLUS",
        portfolioSize,
        policy,
        currentDalMult: 1,
        openPositions: positions,
        marginPerContract: (spec.avg_margin ?? 0),
      });
      return { spec, go, dalCap, goPlus };
    });
  }, [specs, policy, portfolioSize, positions]);

  const globalCap = portfolioSize * (policy.global_pct / 100);
  const stratCap = portfolioSize * (policy.per_strat_pct / 100);

  return (
    <Panel
      title="Per-Strategy Sizing Grid"
      subtitle={`At $${formatCompact(portfolioSize)}, ${policy.base_pct}% base allocation, ${policy.global_pct}% / ${policy.per_strat_pct}% caps`}
    >
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: fonts.mono,
            fontSize: 12,
            color: colors.textPrimary,
          }}
        >
          <thead>
            <tr style={{ color: colors.textMuted, textAlign: "right" }}>
              <th style={{ textAlign: "left", padding: 6 }}>Strategy</th>
              <th style={{ padding: 6 }}>Margin / ct</th>
              <th style={{ padding: 6 }}>Base (DAl=1)</th>
              <th style={{ padding: 6 }}>DAl={policy.dal_cap}</th>
              <th style={{ padding: 6 }}>GO+ (DAl=1)</th>
              <th style={{ padding: 6 }}>Per-strat cap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ spec, go, dalCap, goPlus }) => {
              const maxAtCap = Math.floor(stratCap / (spec.avg_margin ?? 1));
              const capBinding = dalCap.marginTrimmed || dalCap.hardCapped;
              return (
                <tr key={spec.name} style={{ borderTop: `1px solid ${colors.borderDim}` }}>
                  <td style={{ textAlign: "left", padding: 6, color: colors.textPrimary }}>{spec.name}</td>
                  <td style={{ textAlign: "right", padding: 6 }}>${spec.avg_margin?.toFixed(0)}</td>
                  <td style={{ textAlign: "right", padding: 6 }}>{go.finalContracts}</td>
                  <td style={{ textAlign: "right", padding: 6, color: capBinding ? colors.accentAmber : colors.textPrimary }}>
                    {dalCap.finalContracts}
                  </td>
                  <td style={{ textAlign: "right", padding: 6, color: colors.accentGreen }}>{goPlus.finalContracts}</td>
                  <td style={{ textAlign: "right", padding: 6, color: colors.textMuted }}>
                    {maxAtCap} cts (${formatCompact(maxAtCap * (spec.avg_margin ?? 0))})
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `1px solid ${colors.borderMid}`, color: colors.textMuted }}>
              <td colSpan={6} style={{ padding: 8 }}>
                Global cap: ${formatCompact(globalCap)} ({policy.global_pct}% of ${formatCompact(portfolioSize)})
                &middot; hard cap {policy.hard_cap} contracts/entry
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}
