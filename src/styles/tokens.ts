/**
 * Design tokens — typed mirror of the CSS custom properties in
 * src/styles/globals.css. Having a TS-side source of truth lets
 * inline style objects (which can't reach `var(--...)` in strongly-
 * typed contexts like ECharts option builders) reference the same
 * palette that `.panel` / `.stat-card` / etc. read through CSS.
 *
 * Rule of thumb: if a color appears in two places, it goes here.
 * Component-local state theming (e.g. per-lifecycle-state background
 * tints on StrategyMonitorCard) stays inline — those are specific to
 * one component's visual logic, not part of the shared palette.
 *
 * Adding a color: also add the corresponding CSS var to globals.css
 * so component-level CSS rules stay in lockstep with TS consumers.
 */

export const colors = {
  // Backgrounds — progressively lighter panel chrome
  bgBase: "#0a0e17",      // app background
  bgPanel: "#111827",     // default panel / card
  bgElevated: "#0d1117",  // header / tab-bar
  bgInset: "#0f172a",     // inner sub-panel / sticky table head
  // Borders — dim to bright
  borderDim: "#1e293b",
  borderMid: "#334155",
  borderBright: "#475569",
  // Text — primary to dim
  textBright: "#f8fafc",   // near-white, used rarely for headline emphasis
  textPrimary: "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
  textDim: "#475569",      // same hex as borderBright by design — muted-on-muted
  // Accents
  accentBlue: "#3b82f6",
  accentGreen: "#10b981",
  accentRed: "#ef4444",
  accentRedLight: "#fca5a5", // for "error text on dark bg" where #ef4444 reads too hot
  accentAmber: "#f59e0b",
} as const;

export const fonts = {
  sans: "Inter, sans-serif",
  mono: "JetBrains Mono, monospace",
} as const;

/**
 * Append a two-digit alpha suffix to a 6-digit hex color, producing
 * an 8-digit `#RRGGBBAA` string. Inline styles use this for the
 * subtle-tint patterns the audit flagged as proliferating hex
 * literals (e.g. `#10b98140` for a faint green glow border).
 *
 * `withAlpha(colors.accentGreen, 0.25)` → "#10b98140".
 * Clamped to [0, 1] defensively.
 */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const byte = Math.round(clamped * 255);
  return `${hex}${byte.toString(16).padStart(2, "0")}`;
}

/**
 * Same as `withAlpha` but takes the alpha byte (0..255) directly.
 * Use when reproducing an existing literal exactly is more important
 * than writing a round fraction — e.g. the pre-existing `#10b98144`
 * inline (byte 0x44 = 68) doesn't have a clean fractional equivalent
 * without visual drift. Prefer `withAlpha` for new code.
 */
export function withAlphaByte(hex: string, byte: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(byte)));
  return `${hex}${clamped.toString(16).padStart(2, "0")}`;
}
