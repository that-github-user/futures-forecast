/**
 * TerminalChartCanvas — viewport-routed chart wrapper.
 *
 * Picks between the desktop (ECharts) and mobile (TradingView
 * Lightweight Charts) implementations based on the current
 * viewport width. Both implementations are lazy-loaded so each
 * device only fetches the chart library it actually uses:
 *
 *   Desktop: TerminalChartCanvas → DesktopTerminalChartCanvas (ECharts)
 *   Mobile:  TerminalChartCanvas → MobileChartCanvas (Lightweight Charts)
 *
 * Bundle effect: the dynamic-import boundary is what keeps each
 * chart library out of the other's bundle. Static imports inside
 * the lazy-loaded module become part of that module's chunk;
 * the bundler doesn't pull them into the entry chunk. So
 * `import("./DesktopTerminalChartCanvas")` (static `import * from
 * "echarts/core"` inside) yields a separate chunk for desktop
 * users only, and `import("./MobileChartCanvas")` likewise for
 * lightweight-charts.
 *
 * Re-exports chart-type symbols from `./chartTypes` for back-compat
 * with consumers (TerminalDashboard) that already import them from
 * this path.
 */

import { Suspense, lazy } from "react";
import { useIsMobileViewport } from "../../hooks/useIsMobileViewport";
import type { TerminalSnapshot } from "../../api/terminalTypes";
import type { OverlayState, Timeframe } from "./chartTypes";

export type {
  Timeframe,
  OverlayState,
  VwapAnchorKey,
  VwapAnchorState,
  VwapOverlayState,
  OrWindowKey,
  OrOverlayState,
} from "./chartTypes";
export {
  VWAP_ANCHORS,
  OR_WINDOWS,
  DEFAULT_OVERLAYS,
  DEFAULT_TIMEFRAME,
} from "./chartTypes";

// Both charts are lazy-loaded. The dynamic-import boundary is what
// keeps echarts (desktop) and lightweight-charts (mobile) in
// separate chunks; static imports inside each lazy module become
// part of that module's chunk and don't pull into the entry.
const DesktopTerminalChartCanvas = lazy(() =>
  import("./DesktopTerminalChartCanvas").then((m) => ({
    default: m.DesktopTerminalChartCanvas,
  })),
);
const MobileChartCanvas = lazy(() =>
  import("./MobileChartCanvas").then((m) => ({
    default: m.MobileChartCanvas,
  })),
);

interface Props {
  snapshot: TerminalSnapshot | null;
  overlays: OverlayState;
  timeframe: Timeframe;
  formatBarTime: (iso: string, withSeconds?: boolean) => string;
  formatBarDay: (iso: string) => string;
  tzLabel: string;
}

export function TerminalChartCanvas(props: Props) {
  const isMobile = useIsMobileViewport();
  // Suspense fallback while the chunk loads. On a slow mobile
  // connection this can be ~1-2s on first paint; matches the
  // existing empty-state styling at `.terminal-chart-canvas .empty`.
  const fallback = (
    <div className="terminal-chart-canvas">
      <span className="empty">Loading chart…</span>
    </div>
  );
  if (isMobile) {
    return (
      <Suspense fallback={fallback}>
        <MobileChartCanvas {...props} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={fallback}>
      <DesktopTerminalChartCanvas {...props} />
    </Suspense>
  );
}
