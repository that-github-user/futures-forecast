/**
 * CapitalAllocationTab — dashboards the vega-prime research (CAPITAL_ALLOCATION.md).
 *
 * Four panels (order matters — reactive panels up top, static reference at bottom):
 *   A. PolicyPicker      — 4 validated policies + static_1ct baseline
 *   B. SizingGrid        — per-strategy contract counts at the user's capital
 *   C. CompoundingChart  — §10 Monte Carlo growth projection + jittered sample paths
 *   D. EVRankingPanel    — §4 EV/margin-day capital efficiency (reference, static)
 *
 * The allocation math is the same `lib/dcSizing.ts` used by StrategyMonitorCard's
 * Suggested row, so the Sizing Grid shows the exact numbers a live entry would
 * produce at each capital level.
 *
 * Siblings (this folder):
 *   HeaderBand.tsx         — portfolio input + policy label + Apply-to-Signals toggle
 *   PolicyPicker.tsx       — Panel A (policy cards)
 *   SizingGrid.tsx         — Panel B (per-strategy contract counts)
 *   CompoundingChart.tsx   — Panel C (ECharts projection + milestones)
 *   EVRankingPanel.tsx     — Panel D (ECharts reference bar chart)
 *   shared.tsx             — Panel wrapper + formatCompact helper
 */

import { Component, useEffect } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { colors, fonts } from "../../../styles/tokens";
import type { DCPosition } from "../../../api/dcTypes";
import { useCapitalAllocation } from "../../../hooks/useCapitalAllocation";
import { useCapitalSummary } from "../../../hooks/useCapitalSummary";
import { useStrategySpecs } from "../../../hooks/useStrategySpecs";
import { CompoundingChart } from "./CompoundingChart";
import { EVRankingPanel } from "./EVRankingPanel";
import { HeaderBand } from "./HeaderBand";
import { PolicyPicker } from "./PolicyPicker";
import { SizingGrid } from "./SizingGrid";

interface Props {
  positions: DCPosition[];
}

// Defense in depth: any render crash inside the Capital tab body now shows a
// small error panel instead of unmounting the dashboard. The root cause
// should still be fixed upstream, but this prevents a single-line bug from
// taking down the whole route and making users refresh to navigate away.
class CapitalAllocationErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[CapitalAllocationTab] render error", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            margin: 20,
            padding: 14,
            background: colors.bgPanel,
            border: `1px solid ${colors.accentRed}`,
            borderRadius: 6,
            color: colors.accentRedLight,
            fontFamily: fonts.sans,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Capital tab crashed.</div>
          <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 8 }}>
            Likely cause: dc-api.service is running an older build than the frontend
            expects. Restart the service (`sudo systemctl restart dc-api.service`) and
            hard-reload. If it persists, the browser console has the stack trace.
          </div>
          <div
            style={{
              fontSize: 11,
              color: colors.accentRedLight,
              fontFamily: fonts.mono,
              background: colors.bgInset,
              padding: 6,
              borderRadius: 4,
            }}
          >
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function CapitalAllocationTab(props: Props) {
  return (
    <CapitalAllocationErrorBoundary>
      <CapitalAllocationTabInner {...props} />
    </CapitalAllocationErrorBoundary>
  );
}

function CapitalAllocationTabInner({ positions }: Props) {
  const capital = useCapitalAllocation();
  const { summary, loading } = useCapitalSummary();
  const { specs } = useStrategySpecs();

  // Migrate a pre-PR selection of take_all (now reference_only) back to the
  // default. MUST stay ABOVE the early `if (loading)` / `if (!summary)`
  // returns — React requires the same hook order on every render, and
  // `loading` flips false on the second render which would otherwise
  // introduce a hook where there wasn't one before (React error #310).
  //
  // Deps are narrow (only what actually changes the decision) to avoid
  // re-firing on every render — `capital` itself is a fresh object literal
  // each render, so depending on it would run this effect unnecessarily.
  // The `summary?.policies` optional-chain handles the still-loading state.
  useEffect(() => {
    if (!summary) return;
    const stillPicked = summary.policies.find((p) => p.key === capital.policyKey);
    if (stillPicked?.reference_only) {
      const fallback = summary.policies.find((p) => !p.reference_only);
      if (fallback) capital.setPolicy(fallback.key);
    }
  }, [summary, capital.policyKey, capital.setPolicy]);

  if (loading) {
    return (
      <div style={{ color: colors.textMuted, fontSize: 13, textAlign: "center", padding: 40 }}>
        Loading Capital Allocation research…
      </div>
    );
  }
  if (!summary) {
    return (
      <div style={{ color: colors.textSecondary, fontSize: 13, textAlign: "center", padding: 40 }}>
        DC API unavailable — Capital Allocation research requires the daemon to be online.
      </div>
    );
  }

  // Policies the user can actually pick. `reference_only` policies (take_all)
  // are rendered as overlays on the compounding chart rather than as selectable
  // options — the picker excludes them and any localStorage that still points
  // at one gets coerced back to the default by the useEffect above.
  const selectablePolicies = summary.policies.filter((p) => !p.reference_only);
  const referencePolicies = summary.policies.filter((p) => p.reference_only);

  const selectedPolicy =
    selectablePolicies.find((p) => p.key === capital.policyKey) ??
    selectablePolicies[0];
  const selectedCurve = selectedPolicy
    ? summary.compounding_curves[selectedPolicy.key]
    : undefined;

  if (!selectedPolicy || !selectedCurve) {
    return (
      <div style={{ color: colors.textSecondary, fontSize: 13, textAlign: "center", padding: 40 }}>
        Capital Allocation payload is missing policy or curve data. Check the DC API's /capital/summary endpoint.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Sticky header: portfolio input + Apply-to-Signals toggle (drives every panel below) */}
      <HeaderBand
        portfolioSize={capital.portfolioSize}
        onPortfolioChange={capital.setPortfolioSize}
        policyKey={capital.policyKey}
        useCapitalForSignals={capital.useCapitalForSignals}
        onToggleUseForSignals={capital.setUseCapitalForSignals}
        source={summary.source}
      />

      {/* Panel A — pick a policy (reactive). reference_only policies
          (take_all) are excluded — they appear as overlays on the chart. */}
      <PolicyPicker
        policies={selectablePolicies}
        selectedKey={capital.policyKey}
        onSelect={capital.setPolicy}
        portfolioSize={capital.portfolioSize}
      />

      {/* Panel B — per-strategy sizing grid (reactive to policy + portfolio size) */}
      <SizingGrid
        specs={specs ?? []}
        policy={selectedPolicy}
        portfolioSize={capital.portfolioSize}
        positions={positions}
      />

      {/* Panel C — compounding projection (reactive to policy + portfolio size +
          jittered paths). reference-only policies render as dashed overlays. */}
      <CompoundingChart
        curve={selectedCurve}
        policy={selectedPolicy}
        portfolioSize={capital.portfolioSize}
        referenceOverlays={referencePolicies.map((p) => ({
          policy: p,
          curve: summary.compounding_curves[p.key],
        }))}
      />

      {/* Panel D — static EV reference (not affected by user's choice; parked at bottom) */}
      <EVRankingPanel rows={summary.ev_ranking} />
    </div>
  );
}
