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
  // Backgrounds — slate-blue, panels rise above bg
  bgBase: "#0a0e17",      // app background (--paper)
  bgPanel: "#111827",     // default panel / card (--paper-elev)
  bgElevated: "#0d1117",  // header / tab-bar
  bgInset: "#0f172a",     // inner sub-panel / sticky table head (--paper-deep)
  // Borders — dim to bright (slate scale)
  borderDim: "#1e293b",   // --ink-20
  borderMid: "#334155",   // --ink-40 mid-step
  borderBright: "#475569",// --ink-40 light-step (same hex as textDim by design)
  // Text — primary to dim (slate scale, clean white tones)
  textBright: "#f8fafc",   // --ink-100
  textPrimary: "#e2e8f0",  // --ink-80
  textSecondary: "#94a3b8",// --ink-60
  textMuted: "#64748b",    // --ink-60 mid
  textDim: "#475569",      // --ink-40 — same hex as borderBright
  // Accents — saturated blue/green/red/amber 4-tone state palette so
  // SignalBadge GO_PLUS / GO / READY / SKIP and similar four-state UIs
  // keep visual distinction.
  accentBlue: "#3b82f6",       // saturated blue
  accentGreen: "#10b981",      // saturated green
  accentRed: "#ef4444",        // saturated red
  accentRedLight: "#fca5a5",   // light red for error text on dark bg
  accentAmber: "#f59e0b",      // saturated amber
  // Indigo / magenta — secondary accent slots for program-flow chips
  // (XYLD monthly = indigo, JHEQX quarterly = magenta). Tokenized so
  // any future surface reusing program-family color coding has one
  // source of truth rather than redeclaring hex literals inline.
  accentIndigo: "#6366f1",
  accentMagenta: "#d946ef",
  // Backwards-compat token names — chart components reference these by
  // semantic role ("warm distinct accent", "muted secondary text").
  // Repointed to cool-palette equivalents so the four consumer files
  // (FanChart, ScenarioCluster, StrategyCatalogCard, AnalyticsCards)
  // don't need invasive edits.
  ink80: "#94a3b8",            // mirrors --ink-80 (slate-blue muted)
  lumen: "#f59e0b",            // amber — fills the "warm accent" semantic slot
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
