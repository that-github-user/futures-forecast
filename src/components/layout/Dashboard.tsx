/**
 * Dashboard layout: CSS grid — 60% fan chart, 40% sidebar.
 * Assembles all components with smooth transitions.
 */

import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { HistoryEntry } from "../../api/types";
import { usePrediction } from "../../hooks/usePrediction";
import { useHealth } from "../../hooks/useHealth";
import type { Timeframe } from "../../api/timeframe";
import { TIMEFRAME_OPTIONS } from "../../api/timeframe";
import { FanChart, type ChartType, type ForecastStyle } from "../charts/FanChart";
import { ProbabilityDist } from "../charts/ProbabilityDist";
import { EquityCurve } from "../charts/EquityCurve";
import { SignalPanel } from "../indicators/SignalPanel";
import { MetricsBar } from "../indicators/MetricsBar";
import { Header } from "./Header";

export function Dashboard() {
  const { prediction, connected, demoMode, error, retryConnection } = usePrediction();
  const health = useHealth();
  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [forecastStyle, setForecastStyle] = useState<ForecastStyle>("bands");
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState(false);
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
        setHistoryError(false);
      } catch {
        setHistoryError(true);
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
          height: "100%",
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
        height: "100%",
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
        prediction={prediction}
        marketStatus={health?.market_status ?? null}
        timeframe={timeframe}
      />

      {demoMode && (
        <div className="demo-banner">
          Demo mode — showing simulated data.
          {error && <span style={{ marginLeft: 8, color: "#94a3b8" }}>({error})</span>}
          <button
            onClick={retryConnection}
            style={{
              marginLeft: 12,
              background: "rgba(245, 158, 11, 0.2)",
              border: "1px solid rgba(245, 158, 11, 0.4)",
              color: "#f59e0b",
              borderRadius: 4,
              padding: "2px 10px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "Inter, sans-serif",
            }}
          >
            Retry Connection
          </button>
        </div>
      )}

      <div className="dashboard-grid">
        {/* Main fan chart */}
        <div
          className="panel fade-in"
          style={{ gridRow: "1 / 3", padding: 8, minHeight: 0 }}
        >
          <div className="panel-header">
            <span className="panel-title">Ensemble Forecast</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TimeframeToggle value={timeframe} onChange={setTimeframe} />
              <ChartTypeToggle value={chartType} onChange={setChartType} />
              <ForecastStyleToggle value={forecastStyle} onChange={setForecastStyle} />
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
          </div>
          <div style={{ height: "calc(100% - 28px)" }}>
            <FanChart prediction={prediction} chartType={chartType} forecastStyle={forecastStyle} timeframe={timeframe} />
          </div>
        </div>

        {/* Sidebar top: signal + metrics */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            overflow: "auto",
            minHeight: 0,
          }}
        >
          <div className="fade-in">
            <SignalPanel
              signal={prediction.signal}
              lastClose={prediction.last_close}
            />
          </div>
          <div className="fade-in">
            <MetricsBar
              pf={liveStats.pf}
              winRate={liveStats.winRate}
              numTrades={liveStats.numTrades}
              historyError={historyError}
            />
          </div>
          <div className="fade-in" style={{ flex: 1, minHeight: 150 }}>
            <ProbabilityDist prediction={prediction} />
          </div>
        </div>

        {/* Sidebar bottom: equity curve */}
        <div className="fade-in" style={{ minHeight: 0 }}>
          <EquityCurve history={history} />
        </div>
      </div>
    </div>
  );
}

const chartTypeOptions: { value: ChartType; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "candlestick", label: "Candles" },
  { value: "ohlc", label: "OHLC" },
];

function ChartTypeToggle({
  value,
  onChange,
}: {
  value: ChartType;
  onChange: (t: ChartType) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        background: "#0f172a",
        borderRadius: 4,
        border: "1px solid #1e293b",
        overflow: "hidden",
      }}
    >
      {chartTypeOptions.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            background: value === opt.value ? "#1e293b" : "transparent",
            color: value === opt.value ? "#e2e8f0" : "#475569",
            border: "none",
            padding: "2px 8px",
            fontSize: 11,
            fontFamily: "Inter, sans-serif",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function TimeframeToggle({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        background: "#0f172a",
        borderRadius: 4,
        border: "1px solid #1e293b",
        overflow: "hidden",
      }}
    >
      {TIMEFRAME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            background: value === opt.value ? "#1e293b" : "transparent",
            color: value === opt.value ? "#e2e8f0" : "#475569",
            border: "none",
            padding: "2px 8px",
            fontSize: 11,
            fontFamily: "Inter, sans-serif",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const forecastStyleOptions: { value: ForecastStyle; label: string }[] = [
  { value: "bands", label: "Bands" },
  { value: "spaghetti", label: "Paths" },
];

function ForecastStyleToggle({
  value,
  onChange,
}: {
  value: ForecastStyle;
  onChange: (s: ForecastStyle) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        background: "#0f172a",
        borderRadius: 4,
        border: "1px solid #1e293b",
        overflow: "hidden",
      }}
    >
      {forecastStyleOptions.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            background: value === opt.value ? "#1e293b" : "transparent",
            color: value === opt.value ? "#e2e8f0" : "#475569",
            border: "none",
            padding: "2px 8px",
            fontSize: 11,
            fontFamily: "Inter, sans-serif",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
