/**
 * Shared primitives for the CapitalAllocationTab subtree.
 *
 * Panel: the dark-inset card wrapper used by every panel (A–D) in the
 * tab. Consistent padding, title + subtitle layout, and fontFamily
 * live here so a future restyle is a single-file change.
 *
 * formatCompact: humanize big dollar numbers ($50M, $1.2B, $420K, $350).
 * Used across the policy card, sizing grid, compounding chart,
 * milestones — anywhere the tab formats dollar values that span 3–4
 * orders of magnitude.
 */

import { colors, fonts } from "../../../styles/tokens";

export function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: colors.bgInset,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 8,
        padding: 14,
        fontFamily: fonts.sans,
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

export function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}
