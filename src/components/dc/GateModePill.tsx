/**
 * GateModePill — small status pill describing how the daemon gates a
 * strategy. Drives by the `DCStrategySpec.gate_mode` field, which the
 * daemon serializes from `config/ensemble_rules.gate_mode_for()`.
 *
 * Renders for two of the four classifications:
 *
 *   "ungated"  → muted UNGATED pill. By design, no regime gate; SPY
 *                shorts + straddles always fire on entry day, never
 *                reach GO+.
 *   "fallback" → amber FALLBACK pill. The strategy is missing rules
 *                in the current refit and runs default-permit at 1.0×
 *                until the next monthly refit + sync. Ops cue: this
 *                is a transient gap that should drain on next refit.
 *   "ensemble" → no pill (it's the DC default — rendering would clutter
 *                every card with the same redundant marker).
 *   "unknown"  → no pill (daemon-side audit gate catches misconfig at
 *                CI; a dashboard alarm here would just duplicate the
 *                signal).
 *
 * Sibling-rendered next to <SignalBadge> in StrategyMonitorCard
 * (Signals tab) and StrategyCatalogCard (Strategies tab) for cross-tab
 * consistency. role/aria-label match the project's existing
 * non-text-status pattern (see IVSourceBadge in LegDetailBlock.tsx).
 */

import { colors, fonts } from "../../styles/tokens";

interface Props {
  gateMode: "ensemble" | "fallback" | "ungated" | "unknown" | undefined;
}

export function GateModePill({ gateMode }: Props) {
  if (gateMode !== "ungated" && gateMode !== "fallback") return null;

  const config = gateMode === "ungated"
    ? {
        label: "Ungated",
        ariaLabel: "Ungated strategy — no regime gate",
        title: "By design — no regime gate. Always fires on entry day; never reaches GO+.",
        color: colors.textMuted,
        border: colors.borderDim,
        background: colors.bgInset,
      }
    : {
        // Fallback — warning hue so an operator notices a refit-coverage
        // gap. Amber on a faint amber-tinted bg, similar weight to the
        // IV-source vix-fallback badge the project already ships.
        label: "Fallback",
        ariaLabel: "Fallback gate — strategy missing rules in current refit",
        title:
          "Missing from the latest deployment_rules refit. Runs at " +
          "base size on its entry day regardless of regime features " +
          "(1.0×, never GO+), until next monthly refit + sync.",
        color: colors.accentAmber,
        border: colors.accentAmber + "55",
        background: colors.accentAmber + "14",
      };

  return (
    <span
      role="img"
      aria-label={config.ariaLabel}
      title={config.title}
      style={{
        fontSize: 9,
        fontWeight: 600,
        color: config.color,
        border: `1px solid ${config.border}`,
        background: config.background,
        padding: "2px 6px",
        borderRadius: 6,
        fontFamily: fonts.sans,
        letterSpacing: 0.6,
        textTransform: "uppercase",
      }}
    >
      {config.label}
    </span>
  );
}
