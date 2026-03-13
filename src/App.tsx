import { useState } from "react";
import { Dashboard } from "./components/layout/Dashboard";
import { BacktestPage } from "./components/layout/BacktestPage";

type Tab = "dashboard" | "backtest";

function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="app-root">
      <nav className="tab-bar">
        <button
          className={`tab-btn ${tab === "dashboard" ? "active" : ""}`}
          onClick={() => setTab("dashboard")}
        >
          Live Forecast
        </button>
        <button
          className={`tab-btn ${tab === "backtest" ? "active" : ""}`}
          onClick={() => setTab("backtest")}
        >
          Backtest
        </button>
      </nav>

      <div className="app-content">
        {tab === "dashboard" && <Dashboard />}
        {tab === "backtest" && <BacktestPage />}
      </div>
    </div>
  );
}

export default App;
