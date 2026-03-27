/**
 * Dashboard layout: CSS grid — 60% fan chart, 40% sidebar.
 * Assembles all components with smooth transitions.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { DailySummary, HindcastPrediction, HistoryEntry, RollingAccuracy, SessionStats } from "../../api/types";
import { usePrediction } from "../../hooks/usePrediction";
import { useHealth } from "../../hooks/useHealth";
import type { Timeframe } from "../../api/timeframe";
import { TIMEFRAME_OPTIONS } from "../../api/timeframe";
import { FanChart, type ChartType, type ForecastStyle } from "../charts/FanChart";
import { ProbabilityDist } from "../charts/ProbabilityDist";
import { EquityCurve } from "../charts/EquityCurve";
import { ScenarioCluster } from "../charts/ScenarioCluster";
import { SignalPanel } from "../indicators/SignalPanel";
import { MetricsBar } from "../indicators/MetricsBar";
import { AnalyticsCards } from "../indicators/AnalyticsCards";
import { TrackRecord } from "../indicators/TrackRecord";
import { SidebarTabs, type SidebarTab } from "./SidebarTabs";
import { Header } from "./Header";

export function Dashboard() {
  const { prediction, connected, demoMode, error, retryConnection } = usePrediction();
  const health = useHealth();
  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [forecastStyle, setForecastStyle] = useState<ForecastStyle>("gradient");
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [liveStats, setLiveStats] = useState<{
    pf: number | null;
    winRate: number | null;
    numTrades: number | null;
  }>({ pf: null, winRate: null, numTrades: null });
  const [hindcast, setHindcast] = useState<HindcastPrediction[]>([]);
  const [rollingAccuracy, setRollingAccuracy] = useState<RollingAccuracy | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [showTracking, setShowTracking] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("signal");
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [highlightedPaths, setHighlightedPaths] = useState<number[] | null>(null);

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
        setSessionStats(h.session_stats ?? null);
        setHistoryError(false);
      } catch {
        setHistoryError(true);
      }
    };

    const fetchHindcast = async () => {
      try {
        const hc = await api.hindcast(24);
        setHindcast(hc.predictions);
        setRollingAccuracy(hc.rolling_accuracy ?? null);
      } catch {
        // Non-critical — silently ignore
      }
    };

    const fetchDailySummaries = async () => {
      try {
        const ds = await api.dailySummaries();
        setDailySummaries(ds);
      } catch {
        // Non-critical
      }
    };

    fetchHistory();
    fetchHindcast();
    fetchDailySummaries();
    const id = setInterval(() => {
      fetchHistory();
      fetchHindcast();
    }, 60_000);
    // Daily summaries refresh less often (every 5 min)
    const dsId = setInterval(fetchDailySummaries, 300_000);
    return () => { clearInterval(id); clearInterval(dsId); };
  }, []);

  // Compute range accuracy from rolling accuracy (server-computed)
  const rangeMetrics = useMemo(() => {
    if (!rollingAccuracy) return null;
    return {
      innerPct: rollingAccuracy.coverage_p25_p75 ?? 0,
      outerPct: rollingAccuracy.coverage_p10_p90 ?? 0,
      totalPoints: rollingAccuracy.n_evaluated,
      numPredictions: rollingAccuracy.n_evaluated,
    };
  }, [rollingAccuracy]);

  // Scored hindcasts for tracking, sorted by best-validated first.
  // Prefer predictions with more realized bars (longer confirmed track)
  // and lower RMSE. FanChart picks the first whose anchor fits the visible candles.
  const scoredHindcasts = useMemo(() => {
    if (!hindcast?.length) return [];
    return hindcast
      .filter((h) => h.scoring?.best_paths?.length && h.bars_elapsed >= 6)
      .filter((h) => h.realized_prices.filter((p) => p != null).length >= 6)
      .sort((a, b) => {
        const aRealized = a.realized_prices.filter((p) => p != null).length;
        const bRealized = b.realized_prices.filter((p) => p != null).length;
        const aRmse = a.scoring!.best_paths![0].rmse_pts;
        const bRmse = b.scoring!.best_paths![0].rmse_pts;
        return bRealized - aRealized || aRmse - bRmse;
      });
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
        modelHealth={rollingAccuracy ? { coverage: rollingAccuracy.coverage_p10_p90, nScored: rollingAccuracy.n_evaluated } : null}
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
              <TrackingToggle value={showTracking} onChange={setShowTracking} />
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
              invalidationLevel={prediction.signal.invalidation?.price_level ?? prediction.invalidation?.price_level ?? null}
              highlightedPaths={highlightedPaths}
              hindcastCandidates={scoredHindcasts}
              showTracking={showTracking}
            />
          </div>
        </div>

        {/* Sidebar: analytics cards */}
        <div className="sidebar-cards fade-in">
          <AnalyticsCards
            regime={prediction.signal.regime ? { label: prediction.signal.regime as "trending" | "mean-reverting" | "volatile" | "quiet", confidence: 0 } : prediction.regime ?? null}
            exhaustionScore={prediction.signal.exhaustion_score ?? prediction.exhaustion_score ?? null}
            ensembleAgreement={prediction.signal.ensemble_agreement ?? prediction.ensemble_agreement ?? null}
            signalPercentile={prediction.signal.signal_strength_percentile ?? prediction.signal_percentile ?? null}
            invalidation={prediction.signal.invalidation ?? prediction.invalidation ?? null}
            regimePerformance={prediction.regime_performance ?? null}
            lastClose={prediction.last_close}
            direction={prediction.signal.direction}
          />
        </div>

        {/* Sidebar: tabbed middle */}
        <div className="sidebar-middle">
          <SidebarTabs activeTab={sidebarTab} onChange={setSidebarTab} />
          {sidebarTab === "signal" && (
            <>
              <div className="fade-in">
                <SignalPanel
                  signal={prediction.signal}
                  lastClose={prediction.last_close}
                  regime={prediction.signal.regime ? { label: prediction.signal.regime as "trending" | "mean-reverting" | "volatile" | "quiet", confidence: 0 } : prediction.regime ?? null}
                />
              </div>
              <div className="fade-in">
                <MetricsBar
                  pf={liveStats.pf}
                  winRate={liveStats.winRate}
                  numTrades={liveStats.numTrades}
                  historyError={historyError}
                  rangeAccuracy={rangeMetrics}
                  regimeLabel={prediction.signal.regime ?? prediction.regime?.label ?? null}
                />
              </div>
            </>
          )}
          {sidebarTab === "distribution" && (
            <div className="fade-in" style={{ flex: 1, minHeight: 150 }}>
              <ProbabilityDist prediction={prediction} />
            </div>
          )}
          {sidebarTab === "scenarios" && (
            <div className="fade-in" style={{ flex: 1 }}>
              <ScenarioCluster
                samplePaths={prediction.sample_paths}
                horizons={prediction.horizons}
                lastClose={prediction.last_close}
                percentiles={prediction.percentiles}
                onClusterHighlight={setHighlightedPaths}
              />
            </div>
          )}
          {sidebarTab === "track-record" && (
            <div className="fade-in" style={{ flex: 1, minHeight: 0 }}>
              <TrackRecord
                history={history}
                liveStats={liveStats}
                sessionStats={sessionStats}
                rollingAccuracy={rollingAccuracy}
                dailySummaries={dailySummaries}
              />
            </div>
          )}
        </div>

        {/* Sidebar: equity curve */}
        <div className="fade-in sidebar-equity">
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

function TrackingToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`toggle-btn-solo ${value ? "active" : ""}`}
      onClick={() => onChange(!value)}
      title="Show best-match tracking path from prior prediction"
    >
      Tracking
    </button>
  );
}

const forecastStyleOptions: { value: ForecastStyle; label: string }[] = [
  { value: "bands", label: "Bands" },
  { value: "gradient", label: "Gradient" },
  { value: "density", label: "Density" },
  { value: "ribbon", label: "Ribbon" },
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
