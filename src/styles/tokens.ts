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
  // Backgrounds — paper layers, warm graphite tones
  bgBase: "#0d0c0a",      // app background (--paper)
  bgPanel: "#15130f",     // default panel / card (--paper-elev)
  bgElevated: "#0d0c0a",  // header / tab-bar (--paper, no elevation chrome)
  bgInset: "#08070a",     // inner sub-panel / sticky table head (--paper-deep)
  // Borders — dim to bright (ink scale)
  borderDim: "#2a2823",   // --ink-20
  borderMid: "#5a564f",   // --ink-40
  borderBright: "#8c877c",// --ink-60 — same hex as textMuted by design (muted-on-muted)
  // Text — primary to dim (ink scale, bone-cream tones)
  textBright: "#f5efe2",   // --ink-100
  textPrimary: "#f5efe2",  // --ink-100
  textSecondary: "#c9c3b6",// --ink-80
  textMuted: "#8c877c",    // --ink-60 — same hex as borderBright
  textDim: "#5a564f",      // --ink-40
  // Accents — single warm accent (lumen) for emphasis;
  // bone-cream + persimmon for directional cues (no green per spec).
  // accentAmber stays distinct from accentBlue/lumen so traffic-light
  // UIs (e.g. SignalBadge READY/GO/GO+) keep three readable states.
  accentBlue: "#efc88b",       // --lumen
  accentGreen: "#d6c79a",      // --pos-cream
  accentRed: "#b8746a",        // --neg-persimmon
  accentRedLight: "#d4a59c",   // --neg-persimmon-light
  accentAmber: "#cf9852",      // --accent-warn (burnt amber)
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
