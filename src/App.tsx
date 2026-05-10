/**
 * App router — hash-based, four routes:
 *   #/         → LumenLander (auth gate)
 *   #/forecast → Dashboard (ES prediction; pulls FanChart + EquityCurve + echarts)
 *   #/dc       → DCDashboard (DC trading)
 *   #/app      → TerminalDashboard (six-system trading terminal)
 *
 * Every route component is lazy-loaded so the bundle a user fetches
 * is scoped to the routes they actually visit. Pre-PR (eager
 * imports), a user going straight to `/app` still pulled in
 * Dashboard's static dependency on echarts (~382 KB gz) because
 * App.tsx imported all four route components statically. With
 * lazy-loading, that user's bundle is `entry + LumenLander +
 * TerminalDashboard + TerminalChartCore` — echarts-free.
 *
 * Suspense fallback is a centered loader matching the dashboard
 * surface tones so the route swap doesn't flash an unstyled empty
 * div.
 */

import { Component, Suspense, lazy, type ReactNode } from "react";
import { useHash } from "./hooks/useHash";
// RequireAuth eager: 0.3 KB chunk would cost more in HTTP round-trip
// than it saves. The gate is on every gated-route render path;
// lazy-splitting just adds a tiny chunk fetch with no real benefit
// (R1+R2 both flagged this). The route-component lazies below are
// where the bundle savings come from — they hold the heavy deps.
import { RequireAuth } from "./components/lander/RequireAuth";
import { colors, fonts } from "./styles/tokens";

const Dashboard = lazy(() =>
  import("./components/layout/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const DCDashboard = lazy(() =>
  import("./components/dc/DCDashboard").then((m) => ({ default: m.DCDashboard })),
);
const LumenLander = lazy(() =>
  import("./components/lander/LumenLander").then((m) => ({ default: m.LumenLander })),
);
const TerminalDashboard = lazy(() =>
  import("./components/terminal/TerminalDashboard").then((m) => ({
    default: m.TerminalDashboard,
  })),
);

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

function App() {
  const [hash] = useHash();
  const isDC = hash === "#/dc" || hash.startsWith("#/dc/");
  const isForecast = hash === "#/forecast" || hash.startsWith("#/forecast/");
  const isTerminal = hash === "#/app" || hash.startsWith("#/app/");

  let content: React.ReactNode;
  if (isDC) {
    content = IS_DEMO ? (
      <DCDemoUnavailable />
    ) : (
      <RequireAuth>
        <DCDashboard />
      </RequireAuth>
    );
  } else if (isForecast) {
    content = (
      <RequireAuth>
        <Dashboard />
      </RequireAuth>
    );
  } else if (isTerminal) {
    content = (
      <RequireAuth>
        <TerminalDashboard />
      </RequireAuth>
    );
  } else {
    // Default route `#/` — the lander / auth gate.
    // After unlock, send the operator to the terminal (the new
    // load-bearing surface). Forecast + DC are reachable via RouteNav
    // links from any gated page.
    content = <LumenLander redirectTo="#/app" />;
  }

  return (
    <div className="app-root">
      <div className="app-content">
        <ChunkLoadErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            {content}
          </Suspense>
        </ChunkLoadErrorBoundary>
      </div>
    </div>
  );
}

/** Catches dynamic-import failures from `React.lazy` chunks. The
 *  failure mode this guards against: after a deploy, a user with a
 *  cached `index.js` from the prior deploy tries to fetch a hashed
 *  chunk that no longer exists at the expected URL. The lazy import
 *  rejects, Suspense bubbles the error, and without a boundary above
 *  it the user gets a white screen + console error. The boundary
 *  catches the rejection and prompts a reload, which fetches the
 *  fresh `index.js` referencing the current chunk hashes (R2
 *  flagged this). */
class ChunkLoadErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Surface to console for debug; the typical chunk-load failure
    // produces "Failed to fetch dynamically imported module".
    // eslint-disable-next-line no-console
    console.error("Route chunk failed to load:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: colors.bgBase,
            fontFamily: fonts.sans,
            color: colors.textSecondary,
            gap: 14,
            padding: 24,
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: 14, color: colors.textPrimary }}>
            A new version of the dashboard is available.
          </p>
          <p style={{ margin: 0, fontSize: 12, color: colors.textSecondary }}>
            Reload to apply.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 4,
              padding: "8px 16px",
              fontSize: 12,
              fontFamily: fonts.sans,
              color: colors.textPrimary,
              background: colors.borderDim,
              border: `1px solid ${colors.borderDim}`,
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Centered loading state during route-chunk fetch. Sized for full
 *  viewport so a slow connection doesn't render a tiny spinner.
 *  Matches the muted ink-60 tone the rest of the app uses for
 *  pre-data states. */
function RouteFallback() {
  // height: 100% (NOT 100vh) — `.app-content` is already a viewport-
  // tall flex item, so 100vh inside it would double-count and clip
  // (R1 nit). 100% fills the parent cleanly.
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bgBase,
        fontFamily: fonts.sans,
        color: colors.textSecondary,
        fontSize: 13,
        letterSpacing: "0.02em",
      }}
    >
      Loading…
    </div>
  );
}

function DCDemoUnavailable() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bgBase,
        fontFamily: fonts.sans,
        color: colors.textSecondary,
        gap: 12,
      }}
    >
      <h2 style={{ color: colors.textPrimary, fontSize: 18, margin: 0 }}>
        DC Trading Dashboard
      </h2>
      <p style={{ fontSize: 13, margin: 0 }}>
        Not available in demo mode — requires live backend connection.
      </p>
      <a
        href="#/"
        style={{
          marginTop: 8,
          color: colors.accentBlue,
          fontSize: 12,
          textDecoration: "none",
          padding: "6px 14px",
          background: colors.borderDim,
          borderRadius: 4,
        }}
      >
        Back
      </a>
    </div>
  );
}

export default App;
