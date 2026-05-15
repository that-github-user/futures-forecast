/**
 * TerminalChartCanvas — slim wrapper that lazy-loads the chart core.
 *
 * Originally routed between a desktop (ECharts) and mobile
 * (Lightweight Charts) implementation based on viewport width. The
 * desktop ECharts code was deleted after the Lightweight Charts
 * mobile chart reached feature parity AND the user confirmed it was
 * the smoother, more intuitive experience even on desktop. The
 * single chart implementation now lives at `./TerminalChartCore`.
 *
 * Re-exports chart-type symbols from `./chartTypes` for back-compat
 * with consumers (TerminalDashboard) that already import them from
 * this path.
 */

import { Suspense, lazy } from "react";
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
  PriorHlcOverlayState,
} from "./chartTypes";
export {
  VWAP_ANCHORS,
  OR_WINDOWS,
  DEFAULT_OVERLAYS,
  DEFAULT_TIMEFRAME,
} from "./chartTypes";

// Lazy-loaded chart core. The dynamic-import boundary keeps
// lightweight-charts in its own chunk (~57 KB gz) that's only
// fetched when this component renders — i.e., when the operator
// navigates to the `/app` terminal route. Other routes
// (`/forecast`, `/dc`, `/`) never pay the chart-library cost.
const TerminalChartCore = lazy(() =>
  import("./TerminalChartCore").then((m) => ({
    default: m.TerminalChartCore,
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
  return (
    <Suspense
      fallback={
        <div className="terminal-chart-canvas">
          <span className="empty">Loading chart…</span>
        </div>
      }
    >
      <TerminalChartCore {...props} />
    </Suspense>
  );
}
