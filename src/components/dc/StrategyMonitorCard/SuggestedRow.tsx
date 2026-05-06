/**
 * SuggestedRow — capital-allocation sizing recommendation ("Suggested:
 * N cts"). A pure what-if calculator: each viewer sets their own
 * portfolio size + allocation policy on the Capital tab, and this row
 * answers "given that, here's the size you'd take on this signal."
 *
 * Why account-neutral: this row is visible to anyone who toggled
 * "Use capital for signals." It must not surface margin information
 * tied to the daemon's specific account — viewers don't know what
 * other plays the daemon has running, and warning them about caps
 * the daemon would hit is operator-private state. The math is
 * therefore computed against a CLEAN slate (no open margin deducted),
 * and margin-cap reasons are filtered out of the skip messaging.
 *
 * Operator-facing margin status lives on the Positions tab's
 * MarginCard — separate surface, separate audience.
 */

import { colors, fonts } from "../../../styles/tokens";
import type { LifecycleState } from "../../../lib/dcLifecycle";
import type { DCAllocationPolicy, DCStrategySpec } from "../../../api/dcTypes";
import {
  computeSizingBreakdown,
  computeSuggestedContracts,
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
  entryDirection: "debit" | "credit",
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

// Margin-state-derived skip reasons leak account-specific info. The
// "Insufficient margin available" reason mathematically reduces to
// "your stated portfolio × global_pct can't fit one contract" once
// open-margin is zeroed — that's pure what-if feedback, not state
// leakage, but the wording reads as a margin warning either way.
// Strip these so the only skip message is "Suggested: skip".
const ACCOUNT_TIED_REASONS = new Set([
  "Over global margin cap",
  "Over per-strategy margin cap",
  "Insufficient margin available",
]);

export function SuggestedRow({
  spec,
  signal,
  policy,
  portfolioSize,
  currentDalMult,
  legData,
}: {
  spec: DCStrategySpec;
  signal: string | null;
  policy: DCAllocationPolicy;
  portfolioSize: number;
  currentDalMult: number;
  legData: LegData;
}) {
  const sizedSignal: "GO" | "GO_PLUS" = signal === "GO_PLUS" ? "GO_PLUS" : "GO";
  // Prefer the live entry debit from the snapshot when present — more accurate
  // than spec.avg_margin. Falls back to spec.avg_margin inside the helper.
  const liveDebit = legData.snapshot?.net_debit ?? legData.netDebit ?? null;
  const marginPerContract =
    liveDebit != null ? liveDebit * SPX_MULTIPLIER : (spec.avg_margin ?? null);

  // Empty openPositions = clean-slate sizing. Each viewer sees their
  // own portfolio × policy answer, not one colored by the daemon's
  // open margin. See the file-level docstring for rationale.
  const result = computeSuggestedContracts({
    spec,
    signal: sizedSignal,
    portfolioSize,
    policy,
    currentDalMult,
    openPositions: [],
    marginPerContract,
  });

  // Color treatment:
  //   green  — sized ok
  //   amber  — sized but hit the policy hard cap
  //   red    — skipped
  // The marginTrimmed flag is suppressed here — its message
  // ("trimmed from N (margin cap)") implied a margin warning.
  // hardCapped is account-neutral (a fixed policy ceiling) so we
  // still highlight that case.
  const zero = result.finalContracts === 0;
  const capped = !zero && result.hardCapped;
  const color = zero ? colors.accentRed : capped ? colors.accentAmber : colors.accentGreen;
  const bg = color + "14";
  const border = color + "40";

  const breakdown = computeSizingBreakdown(result, sizedSignal);
  // Filter the skip reason: account-tied ones become a bare "skip"
  // (no trailing reason). Non-account reasons (missing config, base
  // size = 0) still pass through for actionable feedback.
  const skipSuffix =
    result.reasonIfZero && !ACCOUNT_TIED_REASONS.has(result.reasonIfZero)
      ? ` — ${result.reasonIfZero}`
      : "";

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
            ? `Suggested: skip${skipSuffix}`
            : `Suggested: ${result.finalContracts} cts`}
        </span>
        {!zero && (
          <span style={{ color: colors.textMuted, fontSize: 10 }}>{breakdown}</span>
        )}
      </div>
      {!zero && capped && (
        <div style={{ color: colors.accentAmber, fontSize: 10 }}>
          capped from {result.goPlusContracts} (hard cap)
        </div>
      )}
    </div>
  );
}
