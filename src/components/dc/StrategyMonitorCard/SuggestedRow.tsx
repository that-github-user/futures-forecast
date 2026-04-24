/**
 * SuggestedRow — capital-allocation sizing recommendation ("Suggested:
 * N cts"). Rendered only when the caller supplies a policy +
 * portfolioSize AND the lifecycle state + signal warrant a
 * recommendation (shouldShowSuggested below).
 */

import { colors, fonts } from "../../../styles/tokens";
import type { LifecycleState } from "../../../lib/dcLifecycle";
import type { DCAllocationPolicy, DCPosition, DCStrategySpec } from "../../../api/dcTypes";
import {
  computeSizingBreakdown,
  computeSuggestedContracts,
  formatMarginUsage,
  SPX_MULTIPLIER,
} from "../../../lib/dcSizing";
import type { LegData } from "./types";

/** True when the lifecycle state + signal combination warrants showing
 *  a "Suggested: N cts" sizing recommendation. Hides on SKIP (no
 *  entry-worthy signal), fully-inactive (not firing today), closed
 *  (already handled), or credit-direction strategies (SPY short puts /
 *  straddles are not auto-executed today — the `blocked_direction`
 *  gate in the backend refuses them — and the sizing math assumes a
 *  4-leg SPX debit structure with an SPX_MULTIPLIER-based margin
 *  proxy). Rendering "Suggested: N cts" for a credit strategy would
 *  be actively misleading. */
export function shouldShowSuggested(
  state: LifecycleState,
  signal: string | null,
  entryDirection: "debit" | "credit" = "debit",
): boolean {
  if (entryDirection === "credit") return false;
  const activeEnough =
    state === "primed" ||
    state === "imminent" ||
    state === "firing" ||
    state === "recently_fired" ||
    state === "passed_will_fire";
  const hasGoSignal = signal === "GO" || signal === "GO_PLUS";
  return activeEnough && hasGoSignal;
}

export function SuggestedRow({
  spec,
  signal,
  policy,
  portfolioSize,
  currentDalMult,
  openPositions,
  legData,
}: {
  spec: DCStrategySpec;
  signal: string | null;
  policy: DCAllocationPolicy;
  portfolioSize: number;
  currentDalMult: number;
  openPositions: DCPosition[];
  legData: LegData;
}) {
  const sizedSignal: "GO" | "GO_PLUS" = signal === "GO_PLUS" ? "GO_PLUS" : "GO";
  // Prefer the live entry debit from the snapshot when present — more accurate
  // than spec.avg_margin. Falls back to spec.avg_margin inside the helper.
  const liveDebit = legData.snapshot?.net_debit ?? legData.netDebit ?? null;
  const marginPerContract =
    liveDebit != null ? liveDebit * SPX_MULTIPLIER : (spec.avg_margin ?? null);

  const result = computeSuggestedContracts({
    spec,
    signal: sizedSignal,
    portfolioSize,
    policy,
    currentDalMult,
    openPositions,
    marginPerContract,
  });

  // Color treatment:
  //   green  — sized ok
  //   amber  — sized but margin-trimmed or hard-capped
  //   red    — skipped
  const zero = result.finalContracts === 0;
  const trimmed = !zero && (result.marginTrimmed || result.hardCapped);
  const color = zero ? colors.accentRed : trimmed ? colors.accentAmber : colors.accentGreen;
  const bg = color + "14";
  const border = color + "40";

  const breakdown = computeSizingBreakdown(result, sizedSignal);
  const marginLine = formatMarginUsage(result);

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: "6px 8px",
        fontFamily: fonts.mono,
        fontSize: 11,
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color, fontWeight: 700 }}>
          {zero
            ? `Suggested: skip — ${result.reasonIfZero ?? "over budget"}`
            : `Suggested: ${result.finalContracts} cts`}
        </span>
        {!zero && (
          <span style={{ color: colors.textMuted, fontSize: 10 }}>{breakdown}</span>
        )}
      </div>
      {!zero && (
        <div style={{ color: colors.textMuted, fontSize: 10 }}>
          {trimmed && (
            <span style={{ color: colors.accentAmber, marginRight: 6 }}>
              {result.marginTrimmed
                ? `trimmed from ${result.goPlusContracts} (margin cap)`
                : `capped from ${result.goPlusContracts} (hard cap)`}
            </span>
          )}
          {marginLine}
        </div>
      )}
    </div>
  );
}
