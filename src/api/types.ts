/** API response types — mirrors server/schemas.py */

export interface HorizonSignal {
  direction: "LONG" | "SHORT" | "FLAT";
  expected_return: number;
  confidence: number;
}

export interface SignalResponse {
  composite_score: number;
  direction: "LONG" | "SHORT" | "FLAT";
  confidence: number;
  expected_return: number;
  ensemble_sharpe: number;
  p10_return: number;
  p90_return: number;
  long_frac: number;
  horizon_signals?: Record<string, HorizonSignal> | null;
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RegimeInfo {
  label: "trending" | "mean-reverting" | "volatile" | "quiet";
  confidence: number;
}

export interface InvalidationInfo {
  price_level: number;
  price_direction: string;
  description: string;
  ensemble_contradiction: number;
}

export interface RegimePerformance {
  win_rate: number;
  profit_factor: number;
  n_trades: number;
}

export interface PredictionResponse {
  timestamp: string;
  instrument: string;
  last_close: number;
  horizons: number[];
  percentiles: {
    p10: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p90: number[];
  };
  sample_paths: number[][] | null;
  signal: SignalResponse;
  context_candles: CandleData[] | null;
  // Analytics engine fields
  exhaustion_score?: number | null;
  regime?: RegimeInfo | null;
  ensemble_agreement?: number | null;
  signal_percentile?: number | null;
  invalidation?: InvalidationInfo | null;
  regime_performance?: RegimePerformance | null;
}

export interface HistoryEntry {
  timestamp: string;
  instrument: string;
  last_close: number;
  signal: SignalResponse;
  realized_return: number | null;
  realized_direction: "UP" | "DOWN" | null;
  realized_returns: Record<string, number | null> | null;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  live_pf: number | null;
  live_win_rate: number | null;
  live_num_trades: number | null;
}

export interface PathTrackingInfo {
  path_index: number;
  path_values: number[];
  rmse_pts: number;
  tracking_duration_bars: number;
  tracking_threshold_pts: number;
  deviations: number[];
}

export interface HindcastScored {
  coverage_p10_p90: number | null;
  coverage_p25_p75: number | null;
  direction_correct: boolean | null;
  median_rmse_pts: number | null;
  best_paths: PathTrackingInfo[] | null;
  verdict: "PASS" | "PARTIAL" | "FAIL" | null;
  signal_direction: string | null;
  expected_return_pts: number | null;
  realized_return_pts: number | null;
}

export interface RollingAccuracy {
  n_evaluated: number;
  coverage_p10_p90: number | null;
  coverage_p25_p75: number | null;
  direction_hit_rate: number | null;
  mean_tracking_rmse_pts: number | null;
}

export interface HindcastPrediction {
  timestamp: string;
  last_close: number;
  horizons: number[];
  percentiles: {
    p10: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p90: number[];
  };
  sample_paths: number[][] | null;
  realized_prices: (number | null)[];
  bars_elapsed: number;
  scoring?: HindcastScored | null;
}

export interface HindcastResponse {
  predictions: HindcastPrediction[];
  rolling_accuracy?: RollingAccuracy | null;
}

export interface HealthResponse {
  status: string;
  uptime_seconds: number;
  last_prediction_time: string | null;
  last_bar_time: string | null;
  data_feed_status: string;
  model_loaded: boolean;
  gpu_available: boolean;
  market_status: "RTH" | "ETH" | "CLOSED" | null;
}
