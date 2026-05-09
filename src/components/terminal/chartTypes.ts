/**
 * Shared chart-type definitions consumed by both the desktop
 * (ECharts) and mobile (Lightweight Charts) chart implementations
 * AND by their parent `TerminalDashboard.tsx` (which holds the
 * overlay-state). Extracted from `TerminalChartCanvas.tsx` so the
 * desktop chart's heavy ECharts module-imports don't pull into
 * the type-import path used by the mobile-chart bundle.
 */

// ── AVWAP anchor configuration ─────────────────────────────────────

export type VwapAnchorKey = "week" | "daily" | "rth";

export type VwapAnchorState = {
  vwap: boolean;
  band1: boolean;
  band2: boolean;
};

export type VwapOverlayState = Record<VwapAnchorKey, VwapAnchorState>;

export const VWAP_ANCHORS: { key: VwapAnchorKey; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "daily", label: "Daily" },
  { key: "rth", label: "RTH" },
];

// ── Opening Range overlay state ─────────────────────────────────────

export type OrWindowKey = "m1" | "m5" | "m15";

export type OrOverlayState = Record<OrWindowKey, boolean>;

export const OR_WINDOWS: { key: OrWindowKey; label: string; minutes: number }[] = [
  { key: "m1", label: "1m", minutes: 1 },
  { key: "m5", label: "5m", minutes: 5 },
  { key: "m15", label: "15m", minutes: 15 },
];

// ── Overlay state shape ─────────────────────────────────────────────

export type OverlayState = {
  vwap: VwapOverlayState;
  pocVa: boolean;
  priorHlc: boolean;
  openingRange: OrOverlayState;
};

export const DEFAULT_OVERLAYS: OverlayState = {
  vwap: {
    week: { vwap: true, band1: false, band2: false },
    daily: { vwap: false, band1: false, band2: false },
    rth: { vwap: false, band1: false, band2: false },
  },
  pocVa: true,
  priorHlc: true,
  openingRange: { m1: false, m5: true, m15: false },
};

// ── Timeframe ──────────────────────────────────────────────────────

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h";

export const DEFAULT_TIMEFRAME: Timeframe = "5m";
