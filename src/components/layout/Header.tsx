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
  modelHealth?: { coverage: number | null; nScored: number } | null;
}

export function Header({ instrument, connected, lastPredictionTime, prediction, marketStatus, timeframe = "5m", modelHealth }: Props) {
  // Compute change from prior RTH close (16:00 ET settlement).
  // Scan context candles backwards to find the last bar at or before 16:00 ET.
  const ctxCandles = prediction.context_candles ?? [];
  let refPrice = prediction.last_close;
  for (let i = ctxCandles.length - 1; i >= 0; i--) {
    const d = new Date(ctxCandles[i].time * 1000);
    // Convert to ET hours — approximate via UTC-5 (EST) or UTC-4 (EDT)
    // Use the month to determine DST (Mar-Nov = EDT)
    const month = d.getUTCMonth(); // 0-indexed
    const isDST = month >= 2 && month <= 10; // Mar(2) through Nov(10)
    const etHour = (d.getUTCHours() + (isDST ? 20 : 19)) % 24;
    const etMinute = d.getUTCMinutes();
    // RTH close = 16:00 ET. Find the candle at or just before that boundary.
    if (etHour === 15 && etMinute >= 55) {
      // Last 5-min bar of RTH (15:55-16:00)
      refPrice = ctxCandles[i].close;
      break;
    }
    if (etHour < 16 && i > 0) {
      // Check if the NEXT candle crosses 16:00
      const nextD = new Date(ctxCandles[i + 1]?.time * 1000);
      const nextEtHour = (nextD.getUTCHours() + (isDST ? 20 : 19)) % 24;
      if (nextEtHour >= 16 && etHour < 16) {
        refPrice = ctxCandles[i].close;
        break;
      }
    }
  }
  // Fallback: if no RTH close found, use oldest candle's open
  if (refPrice === prediction.last_close && ctxCandles.length > 0) {
    refPrice = ctxCandles[0].open;
  }
  const sessionChange = prediction.last_close - refPrice;
  const sessionChangePct = refPrice !== 0 ? (sessionChange / refPrice) * 100 : 0;
  const changePositive = sessionChange >= 0;
  const changeColor = changePositive ? "#10b981" : "#ef4444";

  const marketStatusColor =
    marketStatus === "RTH" ? "#10b981" : marketStatus === "ETH" ? "#f59e0b" : "#ef4444";

  return (
    <header className="dashboard-header">
      <div className="header-left">
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

        {/* Model Health badge */}
        {modelHealth && (() => {
          const cov = modelHealth.coverage;
          const n = modelHealth.nScored;
          let label: string;
          let color: string;
          if (n < 10) { label = "Initializing"; color = "#64748b"; }
          else if (cov == null) { label = "No Data"; color = "#64748b"; }
          else if (cov >= 0.70 && cov <= 0.90) { label = "Calibrated"; color = "#10b981"; }
          else if (cov > 0.90) { label = "Bands Wide"; color = "#f59e0b"; }
          else { label = "Check Model"; color = "#ef4444"; }
          return (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color,
                fontFamily: "Inter, sans-serif",
                background: color + "18",
                border: `1px solid ${color}40`,
                padding: "2px 8px",
                borderRadius: 10,
                letterSpacing: 0.3,
              }}
              title={`P10-P90 coverage: ${cov != null ? (cov * 100).toFixed(0) + "%" : "N/A"} (n=${n})`}
            >
              {label}
            </span>
          );
        })()}
      </div>

      <div className="header-right">
        <CountdownTimer
          lastPredictionTime={lastPredictionTime}
          lastBarTime={ctxCandles.length ? ctxCandles[ctxCandles.length - 1].time : null}
        />

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
