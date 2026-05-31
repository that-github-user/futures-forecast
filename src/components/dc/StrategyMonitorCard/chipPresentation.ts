/**
 * Pure resolver for the StrategyMonitorCard's top-right status chip.
 *
 * Split out of index.tsx so the precedence logic is unit-testable
 * (house style: test pure helpers, not JSX). Returns the chip LABEL and
 * the STATE_STYLES key to theme the card with — the caller looks the
 * style up so this stays free of styling imports beyond the label map.
 *
 * Two overrides sit on top of the plain per-state label:
 *
 *   1. slGateFailing — the live S/L gate is failing, so the daemon would
 *      NOT enter. Neutralize BOTH label and style ("GATE FAIL" before
 *      entry, "SKIPPED" after) so a viewer doesn't read the card as a
 *      fill. Unchanged from the original inline behavior.
 *
 *   2. brokerNoFill — today's recorded outcome is `blocked_order`: every
 *      signal-side gate cleared and the daemon submitted, but the broker
 *      never crossed. The lifecycle classifier intentionally keeps this
 *      in a "fired" state (recently_fired / passed_will_fire) so the card
 *      stays highlighted — but "JUST FIRED" / "FIRED EARLIER" is a lie
 *      (nothing filled). Relabel to "NO FILL" while KEEPING the fired
 *      style, honoring the standing operator preference that
 *      automation-side failures should not gray out the card.
 *
 * Precedence: slGateFailing wins when both are set — preserving the
 * pre-existing behavior and leaving the tested gate-skip path untouched.
 * Note this is NOT strictly "more conservative": it lets the LIVE
 * gate-failing state win over a RECORDED blocked_order. In practice the
 * two barely overlap — the daemon records a failed S/L gate as
 * `blocked_sl_gate` (→ passed_skipped, a non-fired state this resolver
 * never relabels), never as `blocked_order`. They co-occur only if the
 * live S/L ratio drifts below min AFTER a blocked_order was recorded
 * earlier the same day, within the post-fire window. Both stories still
 * avoid falsely claiming a fill, so the operator complaint is satisfied
 * either way; flip this precedence later only if that rare race is seen
 * in the wild.
 */

import type { LifecycleState } from "../../../lib/dcLifecycle";
import { STATE_LABELS } from "./styles";

export interface ChipPresentation {
  label: string;
  /** Which STATE_STYLES entry the card should theme with. */
  styleKey: LifecycleState;
}

/** States the lifecycle classifier routes a `blocked_order` (broker
 *  no-fill) into — the ones whose default label wrongly implies a fill. */
const FIRED_STATES: ReadonlySet<LifecycleState> = new Set<LifecycleState>([
  "firing",
  "recently_fired",
  "passed_will_fire",
]);

export function resolveChipPresentation(args: {
  state: LifecycleState;
  slGateFailing: boolean;
  brokerNoFill: boolean;
}): ChipPresentation {
  const { state, slGateFailing, brokerNoFill } = args;

  if (slGateFailing) {
    return {
      label:
        state === "recently_fired" || state === "passed_will_fire"
          ? "SKIPPED"
          : "GATE FAIL",
      styleKey: "not_fired_yet",
    };
  }

  if (brokerNoFill && FIRED_STATES.has(state)) {
    // Honest label, but keep the fired style (don't gray out).
    return { label: "NO FILL", styleKey: state };
  }

  return { label: STATE_LABELS[state], styleKey: state };
}
