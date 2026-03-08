import { useState } from "react";
import { Dashboard } from "./components/layout/Dashboard";
import { BacktestPage } from "./components/layout/BacktestPage";

type Tab = "dashboard" | "backtest";

function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Tab bar */}
      <nav
        style={{
          display: "flex",
          gap: 0,
          background: "#0d1117",
          borderBottom: "1px solid #1e293b",
          padding: "0 20px",
          flexShrink: 0,
        }}
      >
        <TabButton
          label="Live Forecast"
          active={tab === "dashboard"}
          onClick={() => setTab("dashboard")}
        />
        <TabButton
          label="Backtest"
          active={tab === "backtest"}
          onClick={() => setTab("backtest")}
        />
      </nav>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "dashboard" && <Dashboard />}
        {tab === "backtest" && <BacktestPage />}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 20px",
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
        color: active ? "#e2e8f0" : "#64748b",
        fontFamily: "Inter, sans-serif",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
    >
      {label}
    </button>
  );
}

export default App;
