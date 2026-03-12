/**
 * Header: instrument label, price ticker, market status, connection status, countdown.
 */

import type { PredictionResponse } from "../../api/types";
import type { Timeframe } from "../../api/timeframe";
import { getTimeframeLabel } from "../../api/timeframe";
import { CountdownTimer } from "../indicators/CountdownTimer";

interface Props {
  instrument: string;
  connected: boolean;
  lastPredictionTime: string | null;
  prediction: PredictionResponse;
  marketStatus: "RTH" | "ETH" | "CLOSED" | null;
  timeframe?: Timeframe;
}

export function Header({ instrument, connected, lastPredictionTime, prediction, marketStatus, timeframe = "5m" }: Props) {
  // Compute session change: last_close vs open from ~2 hours ago (24 five-min bars)
  const ctxCandles = prediction.context_candles ?? [];
  const sessionRefIdx = Math.max(0, ctxCandles.length - 24);
  const firstOpen = ctxCandles[sessionRefIdx]?.open ?? prediction.last_close;
  const sessionChange = prediction.last_close - firstOpen;
  const sessionChangePct = firstOpen !== 0 ? (sessionChange / firstOpen) * 100 : 0;
  const changePositive = sessionChange >= 0;
  const changeColor = changePositive ? "#10b981" : "#ef4444";

  const marketStatusColor =
    marketStatus === "RTH" ? "#10b981" : marketStatus === "ETH" ? "#f59e0b" : "#ef4444";

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: "1px solid #1e293b",
        background: "#0d1117",
        flexWrap: "wrap",
        gap: 8,
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
          {instrument}
        </h1>

        {/* Price ticker */}
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 16,
            fontWeight: 700,
            color: "#e2e8f0",
          }}
        >
          {prediction.last_close.toFixed(2)}
        </span>
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 13,
            fontWeight: 600,
            color: changeColor,
          }}
        >
          {changePositive ? "+" : ""}{sessionChange.toFixed(2)} ({changePositive ? "+" : ""}{sessionChangePct.toFixed(2)}%)
        </span>

        {/* Market status badge */}
        {marketStatus && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: marketStatusColor,
              fontFamily: "Inter, sans-serif",
              background: marketStatusColor + "18",
              border: `1px solid ${marketStatusColor}40`,
              padding: "2px 8px",
              borderRadius: 10,
              letterSpacing: 0.5,
            }}
          >
            {marketStatus}
          </span>
        )}

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
          {getTimeframeLabel(timeframe)}
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
