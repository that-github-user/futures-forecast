/**
 * Dashboard layout: CSS grid — 60% fan chart, 40% sidebar.
 * Assembles all components.
 */

import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { HistoryEntry } from "../../api/types";
import { useHealth } from "../../hooks/useHealth";
import { usePrediction } from "../../hooks/usePrediction";
import { FanChart } from "../charts/FanChart";
import { ProbabilityDist } from "../charts/ProbabilityDist";
import { EquityCurve } from "../charts/EquityCurve";
import { SignalPanel } from "../indicators/SignalPanel";
import { MetricsBar } from "../indicators/MetricsBar";
import { Header } from "./Header";

export function Dashboard() {
  const { prediction, connected, demoMode, error } = usePrediction();
  const health = useHealth();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [liveStats, setLiveStats] = useState<{
    pf: number | null;
    winRate: number | null;
    numTrades: number | null;
  }>({ pf: null, winRate: null, numTrades: null });

  // Fetch history periodically
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const h = await api.history(100);
        setHistory(h.entries);
        setLiveStats({
          pf: h.live_pf,
          winRate: h.live_win_rate,
          numTrades: h.live_num_trades,
        });
      } catch {
        // History not critical
      }
    };

    fetchHistory();
    const id = setInterval(fetchHistory, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!prediction) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0e17",
          color: "#64748b",
          fontFamily: "Inter, sans-serif",
          gap: 12,
        }}
      >
        <div
          className="spinner"
          style={{
            width: 32,
            height: 32,
            border: "3px solid #1e293b",
            borderTopColor: "#3b82f6",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          }}
        />
        <span>{error || "Connecting to prediction server..."}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0a0e17",
        color: "#e2e8f0",
        overflow: "hidden",
      }}
    >
      <Header
        instrument={prediction.instrument}
        connected={connected}
        lastPredictionTime={prediction.timestamp}
        dataFeedStatus={health?.data_feed_status}
      />

      {demoMode && (
        <div
          style={{
            background: "rgba(245, 158, 11, 0.1)",
            borderBottom: "1px solid rgba(245, 158, 11, 0.3)",
            padding: "6px 20px",
            fontSize: 11,
            color: "#f59e0b",
            fontFamily: "Inter, sans-serif",
            textAlign: "center",
          }}
        >
          Demo mode — showing simulated data. Connect to a live API for real predictions.
          {error && <span style={{ marginLeft: 8, color: "#94a3b8" }}>({error})</span>}
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gridTemplateRows: "1fr 200px",
          gap: 1,
          padding: 1,
          overflow: "hidden",
        }}
      >
        {/* Main fan chart */}
        <div
          className="panel"
          style={{ gridRow: "1 / 3", padding: 8, minHeight: 0 }}
        >
          <div className="panel-header">
            <span className="panel-title">Ensemble Forecast</span>
            <span
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              {prediction.last_close.toFixed(2)}
            </span>
          </div>
          <div style={{ height: "calc(100% - 28px)" }}>
            <FanChart prediction={prediction} />
          </div>
        </div>

        {/* Sidebar top: signal + metrics */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            overflow: "auto",
            minHeight: 0,
          }}
        >
          <SignalPanel
            signal={prediction.signal}
            lastClose={prediction.last_close}
          />
          <MetricsBar
            pf={liveStats.pf}
            winRate={liveStats.winRate}
            numTrades={liveStats.numTrades}
          />
          <div style={{ flex: 1, minHeight: 150 }}>
            <ProbabilityDist prediction={prediction} />
          </div>
        </div>

        {/* Sidebar bottom: equity curve */}
        <div style={{ minHeight: 0 }}>
          <EquityCurve history={history} />
        </div>
      </div>
    </div>
  );
}
