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
 * Precedence: slGateFailing wins when both are set. That path is the more
 * conservative neutralization and is the pre-existing behavior; the
 * common no-fill case (broker miss with a passing gate) is unaffected,
 * so the honest relabel lands where it matters without touching the
 * tested gate-skip path.
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
