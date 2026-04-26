import { Dashboard } from "./components/layout/Dashboard";
import { DCDashboard } from "./components/dc/DCDashboard";
import { LumenLander } from "./components/lander/LumenLander";
import { RequireAuth } from "./components/lander/RequireAuth";
import { TerminalDashboard } from "./components/terminal/TerminalDashboard";
import { useHash } from "./hooks/useHash";
import { colors, fonts } from "./styles/tokens";

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
      <div className="app-content">{content}</div>
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
