/**
 * Dashboard layout: CSS grid — 60% fan chart, 40% sidebar.
 * Assembles all components with smooth transitions.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { HindcastPrediction, HistoryEntry } from "../../api/types";
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
  const [hindcast, setHindcast] = useState<HindcastPrediction[]>([]);
  const [showHindcast, setShowHindcast] = useState(false);

  // Fetch history + hindcast periodically
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

    const fetchHindcast = async () => {
      try {
        const hc = await api.hindcast(6);
        setHindcast(hc.predictions);
      } catch {
        // Non-critical — silently ignore
      }
    };

    fetchHistory();
    fetchHindcast();
    const id = setInterval(() => {
      fetchHistory();
      fetchHindcast();
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Compute range accuracy metrics from hindcast data
  const rangeMetrics = useMemo(() => {
    if (!hindcast?.length) return null;
    let inP2575 = 0, inP1090 = 0, total = 0;
    for (const hc of hindcast) {
      for (let hi = 0; hi < hc.horizons.length; hi++) {
        const rp = hc.realized_prices[hi];
        if (rp == null) continue;
        total++;
        if (rp >= hc.percentiles.p25[hi] && rp <= hc.percentiles.p75[hi]) {
          inP2575++; inP1090++;
        } else if (rp >= hc.percentiles.p10[hi] && rp <= hc.percentiles.p90[hi]) {
          inP1090++;
        }
      }
    }
    if (total === 0) return null;
    return {
      innerPct: inP2575 / total,
      outerPct: inP1090 / total,
      totalPoints: total,
      numPredictions: hindcast.length,
    };
  }, [hindcast]);

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
    <div className="dashboard-root">

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
          className="panel fade-in fan-chart-cell"
        >
          <div className="panel-header">
            <span className="panel-title">Ensemble Forecast</span>
            <div className="panel-controls">
              <TimeframeToggle value={timeframe} onChange={setTimeframe} />
              <ChartTypeToggle value={chartType} onChange={setChartType} />
              <ForecastStyleToggle value={forecastStyle} onChange={setForecastStyle} />
              <HindcastToggle value={showHindcast} onChange={setShowHindcast} />
              {forecastStyle !== "spaghetti" &&
                hindcast.length > 0 &&
                hindcast[hindcast.length - 1]?.bars_elapsed >= 3 && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "#64748b",
                      fontStyle: "italic",
                      fontFamily: "Inter, sans-serif",
                      cursor: "pointer",
                    }}
                    onClick={() => setForecastStyle("spaghetti")}
                    title="Switch to Paths view to see best-match trajectories"
                  >
                    Path match available
                  </span>
                )}
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
            <FanChart
              prediction={prediction}
              chartType={chartType}
              forecastStyle={forecastStyle}
              timeframe={timeframe}
              hindcast={showHindcast ? hindcast : undefined}
              showHindcast={showHindcast}
            />
          </div>
        </div>

        {/* Sidebar top: signal + metrics */}
        <div className="sidebar-top">
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
              rangeAccuracy={rangeMetrics}
            />
          </div>
          <div className="fade-in" style={{ flex: 1, minHeight: 150 }}>
            <ProbabilityDist prediction={prediction} />
          </div>
        </div>

        {/* Sidebar bottom: equity curve */}
        <div className="fade-in sidebar-bottom">
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

function ChartTypeToggle({ value, onChange }: { value: ChartType; onChange: (t: ChartType) => void }) {
  return (
    <div className="toggle-group">
      {chartTypeOptions.map((opt) => (
        <button key={opt.value} className={value === opt.value ? "active" : ""} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function TimeframeToggle({ value, onChange }: { value: Timeframe; onChange: (tf: Timeframe) => void }) {
  return (
    <div className="toggle-group">
      {TIMEFRAME_OPTIONS.map((opt) => (
        <button key={opt.value} className={value === opt.value ? "active" : ""} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function HindcastToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`toggle-btn-solo ${value ? "active" : ""}`}
      onClick={() => onChange(!value)}
      title="Show past prediction accuracy overlay"
    >
      Hindcast
    </button>
  );
}

const forecastStyleOptions: { value: ForecastStyle; label: string }[] = [
  { value: "bands", label: "Bands" },
  { value: "spaghetti", label: "Paths" },
];

function ForecastStyleToggle({ value, onChange }: { value: ForecastStyle; onChange: (s: ForecastStyle) => void }) {
  return (
    <div className="toggle-group">
      {forecastStyleOptions.map((opt) => (
        <button key={opt.value} className={value === opt.value ? "active" : ""} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
