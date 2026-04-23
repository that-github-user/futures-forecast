import { colors, withAlpha, withAlphaByte } from "../../../styles/tokens";
import type { LifecycleState } from "../../../lib/dcLifecycle";

export interface StyleSet {
  border: string;
  background: string;
  opacity: number;
  glow: string;
}

// STATE_STYLES' `background` values are intentionally off-palette —
// they're lifecycle-state tints (very dark accent-tinted panels) that
// are specific to this one component's visual logic, not part of the
// shared palette. Borders and glows derive from shared accent colors
// via withAlpha / withAlphaByte so a palette-wide restyle propagates.
export const STATE_STYLES: Record<LifecycleState, StyleSet> = {
  inactive: {
    border: colors.borderDim,
    background: "#0d1320",
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
    background: "#1c1607",
    opacity: 1,
    glow: `0 0 12px ${withAlpha(colors.accentAmber, 0.4)}, 0 0 0 1px ${withAlpha(colors.accentAmber, 0.5)}`,
  },
  firing: {
    border: colors.accentGreen,
    background: "#062019",
    opacity: 1,
    glow: `0 0 18px ${withAlpha(colors.accentGreen, 0.6)}, 0 0 0 2px ${withAlpha(colors.accentGreen, 0.8)}`,
  },
  recently_fired: {
    border: withAlpha(colors.accentGreen, 0.5),
    background: "#0a1814",
    opacity: 0.95,
    // 0x44 (68) — preserved exactly for visual parity with the old literal.
    glow: `0 0 8px ${withAlphaByte(colors.accentGreen, 0x44)}`,
  },
  passed_will_fire: {
    border: withAlpha(colors.accentGreen, 0.25),
    background: "#0c1612",
    opacity: 0.7,
    glow: "none",
  },
  passed_skipped: {
    border: colors.borderDim,
    background: "#10131c",
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
