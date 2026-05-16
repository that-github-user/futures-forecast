/**
 * Pure formatters for the RealizedImpliedHeader cells. Extracted so
 * the component file remains "components only" for the
 * `react-refresh/only-export-components` lint rule.
 */

import { colors } from "../../styles/tokens";

/** Color-code the realized-vs-implied ratio per spec.
 *
 *  - <70%   → green (dealers winning, range compressed inside EM)
 *  - 70-110% → amber (running close to implied)
 *  - >110%  → red (realized blew past implied — pin candidates broken)
 *  - null   → muted (cold-start / no data yet)
 */
export function realizedVsImpliedColor(pct: number | null): string {
  if (pct == null) return colors.textMuted;
  if (pct < 70) return colors.accentGreen;
  if (pct <= 110) return colors.accentAmber;
  return colors.accentRed;
}

export function formatNumber(v: number | null, digits = 2): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatInt(v: number | null): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString("en-US");
}

export function formatAge(seconds: number | null): string | null {
  if (seconds == null) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}
