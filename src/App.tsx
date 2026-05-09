/**
 * App router — hash-based, four routes:
 *   #/         → LumenLander (auth gate)
 *   #/forecast → Dashboard (ES prediction; pulls FanChart + EquityCurve + echarts)
 *   #/dc       → DCDashboard (DC trading)
 *   #/app      → TerminalDashboard (six-system trading terminal)
 *
 * Every route component is lazy-loaded so the bundle a user fetches
 * is scoped to the routes they actually visit. Pre-PR (eager
 * imports), a mobile user going straight to `/app` still pulled in
 * Dashboard's static dependency on echarts (~382 KB gz) because
 * App.tsx imported all four route components statically. With
 * lazy-loading, that user's bundle is `entry + LumenLander +
 * TerminalDashboard + MobileChartCanvas` — echarts-free.
 *
 * Suspense fallback is a centered loader matching the dashboard
 * surface tones so the route swap doesn't flash an unstyled empty
 * div.
 */

import { Suspense, lazy } from "react";
import { useHash } from "./hooks/useHash";
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
const RequireAuth = lazy(() =>
  import("./components/lander/RequireAuth").then((m) => ({ default: m.RequireAuth })),
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
        <Suspense fallback={<RouteFallback />}>
          {content}
        </Suspense>
      </div>
    </div>
  );
}

/** Centered loading state during route-chunk fetch. Sized for full
 *  viewport so a slow connection doesn't render a tiny spinner.
 *  Matches the muted ink-60 tone the rest of the app uses for
 *  pre-data states. */
function RouteFallback() {
  return (
    <div
      style={{
        height: "100vh",
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
