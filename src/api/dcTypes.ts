/** TypeScript types for the DC Trading Dashboard API responses. */

export interface DCHealthResponse {
  status: string;
  daemon_online: boolean;
  features_stale: boolean;
  features_date: string | null;
  db_path: string | null;
}

export interface DCPosition {
  id: number;
  strategy_name: string;
  signal: string;
  entry_time: string;
  entry_date: string;
  put_strike: number;
  call_strike: number;
  front_exp: string;
  back_exp: string;
  entry_debit: number;
  quantity: number;
  original_quantity: number;
  spx_at_entry: number | null;
  status: string;
  close_reason: string | null;
  close_time: string | null;
  close_pnl: number | null;
}

export interface DCTrade {
  id: number;
  strategy_name: string;
  signal: string | null;
  entry_date: string | null;
  close_date: string | null;
  entry_debit: number | null;
  close_value: number | null;
  pnl: number | null;
  result: string | null;
  close_reason: string | null;
  quantity: number | null;
  put_strike: number | null;
  call_strike: number | null;
  front_exp: string | null;
  back_exp: string | null;
}

export interface DCStrategyStats {
  strategy_name: string;
  total_trades: number;
  total_wins: number;
  total_losses: number;
  win_rate: number | null;
  total_pnl: number;
  avg_pnl: number | null;
  current_mult: number;
  consecutive_wins: number;
  consecutive_losses: number;
}

export interface DCLegDetail {
  action: "STO" | "BTO";
  strike: number;
  expiry: string;              // YYYYMMDD
  mid: number | null;
  entry_mid: number | null;    // from snapshot
}

export interface DCSnapshotInfo {
  captured_at: string;         // ISO datetime ET
  entry_time: string;          // "HH:MM"
  net_debit: number;
  sl_ratio: number | null;
}

export type LegName = "front_put" | "front_call" | "back_put" | "back_call";

export interface DCSignalStatus {
  strategy_name: string;
  signal: string; // GO_PLUS, GO, READY, SKIP
  entry_days: number[];
  next_entry_times: string[];
  sl_ratio: number | null;
  sl_ratio_meets_min: boolean | null;
  legs: Record<LegName, DCLegDetail> | null;
  net_debit: number | null;
  entry_net_debit: number | null;
  snapshot: DCSnapshotInfo | null;
}

export interface DCFeatures {
  atr_pct: number | null;
  gap_pct: number | null;
  bb_position: number | null;
  rsi_14: number | null;
  return_5d: number | null;
  vix_close: number | null;
  vix_pctile: number | null;
  vol_regime: number | null;
  feature_date: string | null;
}

export interface DCSignalsResponse {
  features: DCFeatures | null;
  features_stale: boolean;
  signals: DCSignalStatus[];
}

export interface DCRiskStatus {
  daily_pnl: number;
  daily_trades: number;
  daily_wins: number;
  daily_losses: number;
  daily_limit: number;
  max_daily_trades: number;
  paused: boolean;
}

export interface DCSummary {
  open_positions: number;
  today_trades: number;
  today_pnl: number;
  today_win_rate: number | null;
  total_trades: number;
  total_pnl: number;
  overall_win_rate: number | null;
  daemon_online: boolean;
  active_strategies: number;
}

export interface DCDeltaExitRule {
  leg: string;          // 'put' | 'call'
  entry_delta: number;
  direction: string;    // 'above' | 'below'
  threshold: number;
}

export interface DCTestedExitRule {
  leg: string;
  breach_pct: number;
}

export interface DCPartialClose {
  pct_of_position: number;
  at_pt_pct: number;
}

export interface DCStrategySpec {
  name: string;
  family: string;       // 'long_dte' | 'short_dte' | 'hybrid_fm'
  front_dte: number;
  back_dte: number;
  put_delta: number;
  call_delta: number;
  is_asymmetric: boolean;
  entry_days: number[]; // 0=Mon..4=Fri
  entry_times: string[]; // 'HH:MM' ET
  sl_ratio_min: number | null;
  vix_min: number | null;
  profit_target_pct: number;
  exit_time: string;    // 'HH:MM' ET
  sl_ratio_exit: number | null;
  max_dit: number | null;
  delta_exits: DCDeltaExitRule[];
  tested_exits: DCTestedExitRule[];
  partial_close: DCPartialClose | null;
  entry_window_end: string | null; // 'HH:MM' ET, only set when the strategy has an entry window range
}
