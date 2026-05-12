/**
 * Synthesizer FLAT-bias sub-state classifier (#276).
 *
 * The synthesizer emits bias ∈ {LONG, SHORT, FLAT}. Pre-#276 the
 * /terminal dashboard rendered FLAT as "Awaiting" with no number —
 * indistinguishable from "data missing." Operator-reported 2026-05-12:
 * user thought the system was broken because no number appeared, when
 * the synthesizer was actually working correctly with score = -0.24
 * inside the ±1.0 FLAT band.
 *
 * This module distinguishes the three operationally meaningful sub-
 * states behind FLAT plus a true-no-data state. The dashboard renders
 * each one with a different chip + always shows the numeric score (so
 * proximity-to-threshold is visible).
 *
 * States:
 *   AWAITING — synthesizer.score is null/undefined. No data yet
 *              (cold start, IBKR disconnected, daemon down).
 *   BLOCKED  — synth.overrides is non-empty. The score may or may
 *              not be directional but an override is suppressing
 *              actionability. The override is the dominant signal;
 *              operator should not trade off the score regardless.
 *   MIXED    — bias=FLAT and contributions are large but opposing.
 *              Volatility + breadth might be +3 each, structure +
 *              levels might be -6 each — they cancel to a near-zero
 *              score, but the systems are STRONGLY disagreeing. Very
 *              different from "all systems near zero."
 *   NEUTRAL  — bias=FLAT and contributions are all near zero or
 *              aligned. Genuine no-signal state.
 *
 * Used by both the headline strip and the SynthesisCard so the two
 * surfaces agree on state.
 */

import type { SynthesizerData } from "../api/terminalTypes";

export type FlatSubState = "AWAITING" | "BLOCKED" | "MIXED" | "NEUTRAL";

/**
 * Threshold above which a contribution is considered "large" for the
 * MIXED-vs-NEUTRAL discrimination. Starting value calibrated from
 * 2026-05-12 incident data where the contributions ranged from
 * volatility +3.15 to structure -6.24 — both above this cutoff. Tune
 * downward if NEUTRAL-misclassifications surface in the wild (a
 * legitimate split-systems situation reading as NEUTRAL means
 * operator loses the disagreement signal).
 */
export const MIXED_CONTRIBUTION_THRESHOLD = 2.5;

/**
 * Classify the synthesizer's FLAT sub-state. Returns AWAITING when
 * data is missing entirely. Returns BLOCKED when overrides are
 * active — even for LONG/SHORT bias, the override means the score
 * is "a lie" per the synthesizer's §4.1.1 design intent, so BLOCKED
 * dominates over directional bias.
 *
 * For genuine FLAT (no overrides, bias === "FLAT"), MIXED-vs-NEUTRAL
 * is decided by whether contributions disagree with large magnitudes:
 * MIXED requires at least one contribution >= +THRESHOLD AND at least
 * one <= -THRESHOLD.
 *
 * Caller is expected to short-circuit on LONG/SHORT bias before
 * calling — this function only meaningfully runs when bias === "FLAT"
 * or score === null. Returning BLOCKED for LONG/SHORT-with-overrides
 * is intentional (allows the caller to render the BLOCKED chip even
 * when bias is directional).
 */
export function classifyFlatState(synth: SynthesizerData | null | undefined): FlatSubState {
  if (synth == null || synth.score == null) return "AWAITING";
  // BLOCKED takes precedence — operator most needs to know an
  // override is firing. May coexist with a directional bias if the
  // score WOULD have been LONG/SHORT but overrides suppressed it
  // via the desaturated-chip visual treatment.
  if (synth.overrides.length > 0) return "BLOCKED";
  // MIXED: contributions in strong disagreement.
  const contribs = synth.contributions ?? [];
  const hasLargePositive = contribs.some(
    (c) => c.contribution >= MIXED_CONTRIBUTION_THRESHOLD,
  );
  const hasLargeNegative = contribs.some(
    (c) => c.contribution <= -MIXED_CONTRIBUTION_THRESHOLD,
  );
  if (hasLargePositive && hasLargeNegative) return "MIXED";
  return "NEUTRAL";
}

/**
 * Combined render state for the score chip. Three input bands:
 *   "directional"  — bias=LONG/SHORT, no overrides → full color + Buy/Sell
 *   FlatSubState   — bias=FLAT or overrides active → AWAITING / BLOCKED /
 *                    MIXED / NEUTRAL chip rendering
 *
 * Centralizes the precedence (BLOCKED beats directional, AWAITING
 * beats everything when score is null) so both render sites agree.
 *
 * `underlyingBias` (#279): when BLOCKED suppresses an otherwise-
 * directional score, this carries the underlying bias the
 * synthesizer would have called. Lets the UI surface "Blocked —
 * would-be Buy" so the operator can see WHAT the synthesizer wanted
 * to say despite the block — useful for attribution and for
 * noticing whether overrides are over-firing. Undefined for
 * AWAITING (no data) and for genuine FLAT-with-override (where
 * there was no underlying lean to lose).
 */
export type ScoreRenderState =
  | { kind: "directional"; bias: "LONG" | "SHORT" }
  | {
      kind: "flat";
      sub: FlatSubState;
      underlyingBias?: "LONG" | "SHORT";
    };

export function deriveScoreRenderState(
  synth: SynthesizerData | null | undefined,
): ScoreRenderState {
  const sub = classifyFlatState(synth);
  // AWAITING and BLOCKED both supersede directional rendering — the
  // operator should NOT see "Buy" or "Sell" when there's no data or
  // an override is suppressing the score.
  if (sub === "AWAITING") return { kind: "flat", sub };
  if (sub === "BLOCKED") {
    // Surface the underlying lean when the synthesizer's bias was
    // directional. synth is non-null here because BLOCKED requires
    // synth.overrides.length > 0 (and overrides comes from synth).
    const underlyingBias =
      synth!.bias === "LONG" || synth!.bias === "SHORT"
        ? synth!.bias
        : undefined;
    return { kind: "flat", sub, underlyingBias };
  }
  if (synth!.bias === "LONG" || synth!.bias === "SHORT") {
    return { kind: "directional", bias: synth!.bias };
  }
  return { kind: "flat", sub };
}
