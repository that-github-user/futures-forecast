/**
 * Header: instrument label, connection status dot, countdown.
 */

import { CountdownTimer } from "../indicators/CountdownTimer";

interface Props {
  instrument: string;
  connected: boolean;
  lastPredictionTime: string | null;
  dataFeedStatus?: string;
}

export function Header({ instrument, connected, lastPredictionTime }: Props) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: "1px solid #1e293b",
        background: "#0d1117",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            fontFamily: "Inter, sans-serif",
            color: "#e2e8f0",
            letterSpacing: 0.5,
          }}
        >
          {instrument} Forecast
        </h1>
        <span
          style={{
            fontSize: 11,
            color: "#64748b",
            fontFamily: "JetBrains Mono, monospace",
            background: "#1e293b",
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          5min bars | 2hr context | 6.5hr forecast
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <CountdownTimer lastPredictionTime={lastPredictionTime} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? "#10b981" : "#ef4444",
              boxShadow: connected
                ? "0 0 6px rgba(16, 185, 129, 0.5)"
                : "0 0 6px rgba(239, 68, 68, 0.5)",
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: connected ? "#10b981" : "#ef4444",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>
    </header>
  );
}
