/**
 * Lifecycle theming maps for StrategyMonitorCard. STATE_STYLES drives
 * the per-state border / background / glow / opacity visuals;
 * STATE_LABELS supplies the uppercase status chip text. Siblings read
 * these verbatim — no logic lives here.
 */

import { colors, withAlpha, withAlphaByte } from "../../../styles/tokens";
import type { LifecycleState } from "../../../lib/dcLifecycle";

export interface StyleSet {
  border: string;
  background: string;
  opacity: number;
  glow: string;
}

// STATE_STYLES' lifecycle tints derive from accent tokens via low-opacity
// withAlpha so they blend over the underlying paper to produce dark
// accent-tinted panels. Borders + glows use the same accent at higher
// opacities so a palette-wide restyle propagates everywhere consistently.
export const STATE_STYLES: Record<LifecycleState, StyleSet> = {
  inactive: {
    border: colors.borderDim,
    background: withAlpha(colors.accentBlue, 0.08),
    opacity: 0.4,
    glow: "none",
  },
  pre_features: {
    border: colors.borderDim,
    background: colors.bgPanel,
    opacity: 0.85,
    glow: "none",
  },
  primed: {
    border: withAlpha(colors.accentBlue, 0.5),
    background: colors.bgPanel,
    opacity: 1,
    glow: `0 0 0 1px ${withAlpha(colors.accentBlue, 0.25)}`,
  },
  imminent: {
    border: colors.accentAmber,
    background: withAlpha(colors.accentAmber, 0.10),
    opacity: 1,
    glow: `0 0 12px ${withAlpha(colors.accentAmber, 0.4)}, 0 0 0 1px ${withAlpha(colors.accentAmber, 0.5)}`,
  },
  firing: {
    border: colors.accentGreen,
    background: withAlpha(colors.accentGreen, 0.10),
    opacity: 1,
    glow: `0 0 18px ${withAlpha(colors.accentGreen, 0.6)}, 0 0 0 2px ${withAlpha(colors.accentGreen, 0.8)}`,
  },
  recently_fired: {
    border: withAlpha(colors.accentGreen, 0.5),
    background: withAlpha(colors.accentGreen, 0.06),
    opacity: 0.95,
    // 0x44 (68) — preserved exactly for visual parity with the old literal.
    glow: `0 0 8px ${withAlphaByte(colors.accentGreen, 0x44)}`,
  },
  passed_will_fire: {
    border: withAlpha(colors.accentGreen, 0.25),
    background: withAlpha(colors.accentGreen, 0.04),
    opacity: 0.7,
    glow: "none",
  },
  passed_skipped: {
    border: colors.borderDim,
    background: colors.bgInset,
    opacity: 0.55,
    glow: "none",
  },
  not_fired_yet: {
    border: colors.borderDim,
    background: colors.bgPanel,
    opacity: 0.85,
    glow: "none",
  },
  closed: {
    border: colors.borderDim,
    background: colors.bgBase,
    opacity: 0.25,
    glow: "none",
  },
};

export const STATE_LABELS: Record<LifecycleState, string> = {
  inactive: "INACTIVE",
  pre_features: "AWAITING FEATURES",
  primed: "PRIMED",
  imminent: "IMMINENT",
  firing: "FIRING",
  recently_fired: "JUST FIRED",
  passed_will_fire: "FIRED EARLIER",
  passed_skipped: "NO FIRE",
  not_fired_yet: "WATCHING",
  closed: "CLOSED",
};
