/**
 * DC Trading Dashboard — main layout with 4 tabs.
 * Displays SPX double calendar spread trading data.
 */

import { useState } from "react";
import { useDCData } from "../../hooks/useDCData";
import { DCPositionsTab } from "./DCPositionsTab";
import { DCHistoryTab } from "./DCHistoryTab";
import { DCStrategiesTab } from "./DCStrategiesTab";
import { DCSignalsTab } from "./DCSignalsTab";

type DCTab = "positions" | "history" | "strategies" | "signals";

const TABS: { value: DCTab; label: string }[] = [
  { value: "positions", label: "Positions" },
  { value: "history", label: "History" },
  { value: "strategies", label: "Strategies" },
  { value: "signals", label: "Signals" },
];

export function DCDashboard() {
  const data = useDCData();
  const [tab, setTab] = useState<DCTab>("positions");

  if (data.loading) {
    return (
      <div style={centerStyle}>
        <div style={spinnerStyle} />
        <span style={{ color: "#64748b" }}>Loading DC dashboard...</span>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0a0e17" }}>
      {/* Header */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "1px solid #1e293b",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{
            margin: 0, fontSize: 18, fontWeight: 700,
            fontFamily: "Inter, sans-serif", color: "#e2e8f0", letterSpacing: 0.5,
          }}>
            DC Trading
          </h1>
          <span style={{
            fontSize: 10, fontWeight: 600, fontFamily: "Inter, sans-serif",
            padding: "2px 8px", borderRadius: 10, letterSpacing: 0.5,
            color: data.apiOnline ? "#10b981" : "#ef4444",
            background: data.apiOnline ? "#10b98118" : "#ef444418",
            border: `1px solid ${data.apiOnline ? "#10b98140" : "#ef444440"}`,
          }}>
            {data.apiOnline ? (data.summary?.daemon_online ? "LIVE" : "HISTORICAL") : "OFFLINE"}
          </span>
          {data.summary && (
            <span style={{
              fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "#94a3b8",
            }}>
              {data.summary.open_positions} open &middot; {data.summary.today_trades} today &middot;{" "}
              <span style={{ color: data.summary.today_pnl >= 0 ? "#10b981" : "#ef4444" }}>
                {data.summary.today_pnl >= 0 ? "+" : ""}{data.summary.today_pnl.toFixed(2)}
              </span>
            </span>
          )}
        </div>
        <a href="#/" style={{
          color: "#64748b", fontSize: 11, fontFamily: "Inter, sans-serif",
          textDecoration: "none", padding: "4px 10px",
          background: "#1e293b", borderRadius: 4,
        }}>
          ES Dashboard
        </a>
      </header>

      {/* API offline banner */}
      {!data.apiOnline && (
        <div style={{
          background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)",
          borderRadius: 6, padding: "8px 16px", margin: "8px 12px 0",
          fontFamily: "Inter, sans-serif", fontSize: 12, color: "#94a3b8",
        }}>
          <span style={{ color: "#ef4444", fontWeight: 600 }}>DC API Unavailable</span>
          {" "}— Ensure the DC API server is running on port 8001.
        </div>
      )}

      {/* Tab bar */}
      <div className="tab-bar" style={{ padding: "0 12px", marginTop: 8 }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            className={`tab-btn ${tab === t.value ? "active" : ""}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {tab === "positions" && <DCPositionsTab positions={data.positions} risk={data.risk} />}
        {tab === "history" && <DCHistoryTab trades={data.trades} />}
        {tab === "strategies" && <DCStrategiesTab strategies={data.strategies} />}
        {tab === "signals" && <DCSignalsTab signals={data.signals} />}
      </div>
    </div>
  );
}

const centerStyle: React.CSSProperties = {
  height: "100%", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  background: "#0a0e17", color: "#64748b", fontFamily: "Inter, sans-serif", gap: 12,
};

const spinnerStyle: React.CSSProperties = {
  width: 32, height: 32, border: "3px solid #1e293b", borderTopColor: "#3b82f6",
  borderRadius: "50%", animation: "spin 1s linear infinite",
};
