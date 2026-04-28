/**
 * Pure helpers for the ReentryContext component.
 *
 * Lives in its own module so the component file (ReentryContext.tsx)
 * stays component-only — keeps fast-refresh working and makes the
 * helper unit-testable without rendering React.
 */

import { colors } from "../../../styles/tokens";

/**
 * Map an unrealized P&L number to its semantic color.
 * Within ±$1 reads as muted (functionally flat — sub-tick noise).
 * NaN/Infinity defensively read as muted rather than picking a
 * misleading direction (silent wrong-color bugs are worse than no
 * color at all).
 */
export function pnlColor(pnl: number): string {
  if (!Number.isFinite(pnl)) return colors.textMuted;
  if (Math.abs(pnl) < 1) return colors.textMuted;
  return pnl > 0 ? colors.accentGreen : colors.accentRed;
}


/**
 * Format an "age" interval in seconds as "Xd Yh ago", "Xh Ym ago",
 * "Xm ago", or "just now". Granularity is intentionally coarse — entries
 * on multi-entry strategies are hours apart, and tick-second precision
 * adds noise without value.
 *
 * Negative deltas (entry timestamp is in the future — clock skew or a
 * misconfigured position) clamp to "just now" rather than rendering
 * a negative duration.
 */
export function formatTimeSince(deltaSec: number): string {
  if (!Number.isFinite(deltaSec) || deltaSec < 60) return "just now";
  const totalMin = Math.floor(deltaSec / 60);
  if (totalMin < 60) return `${totalMin}m ago`;
  const totalHours = Math.floor(totalMin / 60);
  const minPart = totalMin % 60;
  if (totalHours < 24) {
    return minPart === 0 ? `${totalHours}h ago` : `${totalHours}h ${minPart}m ago`;
  }
  const days = Math.floor(totalHours / 24);
  const hourPart = totalHours % 24;
  return hourPart === 0 ? `${days}d ago` : `${days}d ${hourPart}h ago`;
}

/**
 * Classify a re-entry preview vs. the open position's paid debit.
 *
 * For DEBIT spreads (DCs — we pay premium): a LOWER preview is BETTER
 * (we'd pay less to re-enter the same structure).
 * For CREDIT spreads (SPY straddles, short puts — we collect premium):
 * a HIGHER preview is BETTER (we'd collect more).
 *
 * Returns "better" / "worse" / "same" — null if the preview is missing.
 */
export function classifyReentry(
  paidDebit: number,
  previewNetDebit: number | null,
  entryDirection: "debit" | "credit",
): "better" | "worse" | "same" | null {
  if (previewNetDebit == null || !Number.isFinite(previewNetDebit)) return null;
  const delta = previewNetDebit - paidDebit;
  if (Math.abs(delta) < 0.01) return "same";
  // For credit, flip the sign — collecting more is "better" but produces +delta.
  const directional = entryDirection === "credit" ? -delta : delta;
  return directional < 0 ? "better" : "worse";
}
