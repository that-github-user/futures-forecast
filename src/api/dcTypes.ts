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
  // Human-readable natural key: "{strategy-slug}_{iso-entry-time}".
  // Null on legacy rows created before the column existed.
  position_uid: string | null;
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
  // IBKR conIds — used by the Positions tab's Broker Reality panel
  // to reconcile daemon-tracked positions against ib.positions() by
  // contract identity. Null on legacy rows.
  front_put_conid: number | null;
  front_call_conid: number | null;
  back_put_conid: number | null;
  back_call_conid: number | null;
  spx_at_entry: number | null;
  status: string;
  close_reason: string | null;
  close_time: string | null;
  close_pnl: number | null;
  // Broker-reality debit reconstructed from IBKR's per-leg avg_cost
  // (server-side join of positions ↔ broker_state by conId). Null
  // when any of the four legs is missing from the latest snapshot,
  // or when the daemon-tracked position is a legacy row without
  // conids. Surfaces on the dashboard as the "Broker Δ" column.
  broker_entry_debit: number | null;
  // Signed drift: broker_entry_debit − entry_debit. Positive = broker
  // charged more than daemon recorded. Null when broker_entry_debit
  // is null.
  debit_drift: number | null;
  // Populated when drift couldn't be computed:
  //   "legacy"    → row predates conid tracking; no join possible
  //   "unmatched" → conids present but at least one leg isn't in
  //                 the latest broker snapshot (transient stale
  //                 snapshot or real drift to investigate)
  //   null        → drift computed cleanly, OR sidecar missing
  // Used by the tooltip to distinguish the two null-drift cases.
  drift_reason: "legacy" | "unmatched" | null;
  // Live mark-to-market on the open spread, reconstructed from per-leg
  // mid quotes in the broker_state sidecar. `current_net_value` is the
  // per-contract value of the 4-leg structure RIGHT NOW (back_put_mid
  // + back_call_mid − front_put_mid − front_call_mid), in dollars per
  // contract. `unrealized_pnl` is (current_net_value − entry_debit)
  // × quantity × 100 — the running $ P&L the daemon would realize
  // closing the position at mid this instant. Both fields are null
  // when any leg's mid is missing (illiquid strikes, market-data
  // farm down, after-hours), or when the position is a legacy row
  // without conids. Refreshes on the broker_state cadence (1 minute
  // during RTH).
  // Optional in case the daemon hasn't migrated yet — graceful
  // degradation during cross-repo deploy ordering.
  current_net_value?: number | null;
  unrealized_pnl?: number | null;
  // Signed P&L as a fraction of entry premium. For debit (DCs):
  // (current − entry) / entry. For credit (SPY shorts/straddles):
  // (entry − current) / entry. Mirrors the daemon's compute_pnl_pct
  // so dashboard "X% of way to PT" matches what the monitor checks.
  // Null when entry_debit is zero/missing or current_net_value
  // can't be computed.
  pnl_pct?: number | null;
  // Live S/L ratio = front_premium / back_premium, computed from
  // the same per-leg mids that produce current_net_value. The metric
  // the daemon's _check_sl_ratio_exit watches for breach. Null when
  // any leg's mid is missing or back_premium is zero.
  live_sl_ratio?: number | null;
  // Order ID of the broker-side profit-target bracket (PR #126).
  // Non-null = IBKR is holding a GTC limit at the target price;
  // daemon-side TP monitor is a no-op. Null on legacy rows, hold-
  // to-expiration sentinel strategies, or rows where bracket
  // submission failed.
  bracket_order_id?: number | null;
  // Lmt price of the resting bracket order, joined from broker_state's
  // open_orders by bracket_order_id. Lets the dashboard show the
  // actual GTC limit pending at the broker without a TWS roundtrip.
  // Null when bracket_order_id is null or when the bracket has been
  // cancelled/filled and is no longer in open_orders.
  bracket_target_price?: number | null;
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
  // Which IV anchor the resolver's BS inverter used this cycle:
  //   "chain"   — fetch_atm_iv sampled live option IVs (good)
  //   "vix"     — fallback to VIX-scaled estimate (the pre-fix path
  //               that caused the 21/28 strike incident)
  //   "default" — cold-start, no VIX or chain IV available
  //   null      — strategy not yet resolved, or pre-observability row
  iv_source: "chain" | "vix" | "default" | null;
  // Phase 3 of live-tick-pre-entry (gate-data fidelity surface):
  //   "live_stream" — sl_ratio above is from a streaming
  //                   pre-entry subscription (strategy in its
  //                   T-60s → T-0 window). Renders the LIVE badge.
  //   "snapshot"    — sl_ratio is from the 2-min SL worker poll
  //                   (potentially stale by up to 2 minutes).
  //   null          — no S/L data for this strategy yet.
  sl_ratio_source?: "live_stream" | "snapshot" | null;
  // Oldest-leg tick age in ms at API-call time, when source is
  // "live_stream". Null otherwise.
  last_tick_age_ms?: number | null;
  // True when this strategy is currently in its pre-entry window.
  pre_entry_window_active?: boolean | null;
}

export interface DCFeatures {
  atr_pct: number | null;
  gap_pct: number | null;
  bb_position: number | null;
  rsi_14: number | null;
  return_5d: number | null;
  return_20d: number | null;
  vix_close: number | null;
  vix_pctile: number | null;
  vix_change_pct: number | null;
  vix_vix3m_ratio: number | null;
  vol_regime: number | null;
  trend_score: number | null;
  price_vs_sma50_pct: number | null;
  consecutive_days: number | null;
  // Prior-day bar date the causal features are computed against (Friday on Monday).
  feature_date: string | null;
  // The trading session these features are for — the real "as-of" date.
  computed_date: string | null;
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
  // Optional margin snapshot (vega-pilot risk_status.json sidecar).
  // null when the daemon hasn't written the sidecar yet (cold start)
  // or when NLV is unset. Surfaced on the Positions tab; not used
  // by Signals or any per-strategy view.
  net_liquidation?: number | null;
  total_open_margin?: number | null;
  global_margin_cap?: number | null;
  margin_budget_global_pct?: number | null;
}

export interface DCSignalEvent {
  id: number;
  strategy_name: string;
  entry_time: string;
  entry_date: string;
  signal: string;
  outcome: string;
  outcome_reason: string | null;
  features_snapshot: Record<string, unknown> | null;
  sl_ratio: number | null;
  entry_debit: number | null;
  quantity: number | null;
  position_id: number | null;
  spx_at_event: number | null;
  // Deconflict audit: populated on `entered` rows whose ideal strike
  // was taken by an open position (auto-moved to the next-best
  // delta-tolerable strike), and on `blocked_deconflict` rows where no
  // acceptable alternative was found. NULL otherwise.
  ideal_put_strike: number | null;
  ideal_call_strike: number | null;
  conflicting_strategy: string | null;
  // Resolved strikes — the strikes the resolver actually picked, post-
  // deconflict-move if any. Populated on every event that reached the
  // resolve phase (entered + blocked_margin / blocked_order / etc).
  // NULL only on blocked_strike or events that never reached the
  // resolver (prechecks, connect failure). Distinct from ideal_*
  // which records the FIRST-pass conflicted strike.
  // Optional in case the daemon hasn't migrated yet — graceful
  // degradation during cross-repo deploy ordering.
  resolved_put_strike?: number | null;
  resolved_call_strike?: number | null;
  // Which IV anchor the BS inverter used for this resolve cycle.
  // Null on pre-observability rows (schema migration didn't backfill)
  // and on pre-fetch event paths (blocked_signal, blocked_features,
  // blocked_vix, blocked_canTrade) where no resolve happened.
  iv_source: "chain" | "vix" | "default" | null;
  // Gate-fidelity audit (live-tick-pre-entry PR #148): which data
  // source the S/L gate decision was made against, and how stale.
  gate_data_source?: "live_stream" | "snapshot" | null;
  gate_data_age_ms?: number | null;
  // Drift-mid-window count (post-Phase-3 PR #151): number of times
  // the drift watcher re-resolved this strategy's strikes during
  // its T-60s → T-0 window. Surfaces on the History tab so
  // operators can see "did this entry's strikes drift mid-window?"
  // without grepping daemon logs. 0 on quiet days; 1-2 on macro
  // events (FOMC/CPI/NFP). Null on pre-observability rows or
  // upstream-blocked outcomes that never reached the gate.
  pre_entry_reresolve_count?: number | null;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Broker state (daemon snapshot of what IBKR actually reports)
// ---------------------------------------------------------------------------

export interface DCBrokerContract {
  conId: number;
  symbol: string;
  secType: string;
  expiry: string;          // YYYYMMDD
  strike: number;
  right: string;           // 'P' | 'C' | ''
  tradingClass: string;    // 'SPXW' | 'SPX' | 'COMB' | ''
  multiplier: string;
  currency: string;
}

export interface DCBrokerPosition {
  account: string;
  contract: DCBrokerContract;
  position: number;        // signed — negative = short
  avg_cost: number;
}

export interface DCBrokerOrder {
  orderId: number;
  permId: number;
  action: string;          // 'BUY' | 'SELL'
  totalQuantity: number;
  lmtPrice: number;
  tif: string;
  status: string;          // Submitted | PreSubmitted | Inactive | etc.
  filled: number;
  remaining: number;
  avg_fill_price: number;
  contract: DCBrokerContract;
}

export interface DCBrokerState {
  snapshot_at: string | null;   // ISO ET; null if sidecar missing
  positions: DCBrokerPosition[];
  open_orders: DCBrokerOrder[];
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
  avg_margin: number | null; // dollars per contract, from CAPITAL_ALLOCATION.md §8
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
  // 'debit' = we pay premium (DCs); 'credit' = we collect premium (SPY short
  // puts, straddles). Drives net-mark header coloring and profit-target math.
  entry_direction: "debit" | "credit";
  // Which gate the daemon's signal evaluator applies to this strategy:
  //   "ensemble" — Weighted fold_top3_OR ∨ BMA top3 unanimous (DC default).
  //                Can reach GO+ when both methods agree → 2.0× sizing.
  //   "fallback" — DC strategy missing from current refit; default-permits
  //                at 1.0× until next refit. Transient.
  //   "ungated"  — by-design no regime filter (SPY shorts + straddles).
  //                Always fires on entry day; never reaches GO+.
  //   "unknown"  — config bug (strategy name absent from all
  //                classifications). Should never happen in practice.
  // Drives the StrategyMonitorCard's UNGATED pill. Optional in case the
  // daemon hasn't deployed the gate_mode field yet — graceful
  // degradation during cross-repo deploy ordering.
  gate_mode?: "ensemble" | "fallback" | "ungated" | "unknown";
}


// ---------------------------------------------------------------------------
// Capital Allocation tab (CAPITAL_ALLOCATION.md §4, §5, §8, §10)
// ---------------------------------------------------------------------------

export type PolicyKey = "take_all" | "rec_60_10" | "cons_40_8" | "cop_cons_60_10" | "static_1ct";
export type CopelandMode = "aggressive" | "conservative";

export interface DCPolicyBacktest {
  start_equity: number;
  terminal_equity: number;
  pf: number;
  max_dd_pct: number;
  years: number;
  trades_skipped: number;
}

export interface DCPolicyMonteCarlo {
  median: number;
  p5: number;
  p95: number;
}

export interface DCLinearGrowth {
  monthly_pl: number;
  monthly_sigma: number;
  source: string;
}

export interface DCAllocationPolicy {
  key: PolicyKey;
  name: string;
  description: string;
  base_pct: number;
  dal_cap: number;
  go_plus_mult: number;
  global_pct: number;
  per_strat_pct: number;
  hard_cap: number;
  copeland_mode: CopelandMode;
  recommended: boolean;
  // Reference-only policies render as an overlay on the compounding chart
  // but don't appear in the picker (used for take_all, which isn't
  // executable on a real broker).
  reference_only: boolean;
  // Null for the static_1ct baseline (no vega-prime research behind it);
  // populated for every other policy.
  backtest: DCPolicyBacktest | null;
  // Only populated for the rec_60_10 policy — see CAPITAL_ALLOCATION.md §10.
  monte_carlo: DCPolicyMonteCarlo | null;
  // Set only for non-compounding policies (static_1ct). Enables linear
  // median + Gaussian-noise sample-path rendering.
  linear_growth: DCLinearGrowth | null;
}

export interface DCEVRankingRow {
  rank: number;
  strategy: string;
  e_pl: number;
  margin: number;
  avg_hold: number;
  ev_mg_day: number;
  pf: number;
}

export interface DCCompoundingCurve {
  months: number[];
  median_multiplier: number[];
  p5_multiplier: number[];
  p95_multiplier: number[];
}

export interface DCCapitalSummary {
  policies: DCAllocationPolicy[];
  ev_ranking: DCEVRankingRow[];
  compounding_curves: Record<PolicyKey, DCCompoundingCurve>;
  source: string;
}

// Surfaced the moment the daemon detects an exit condition for an
// open position, BEFORE the close order submits. Lifecycle:
//   cleared_at == null  → exit ladder still in progress (active alert)
//   cleared_at != null  → position closed, alert resolved (server keeps
//                         on the wire ~5min for graceful UI fade)
export interface DCExitAlert {
  id: number;
  position_id: number;
  strategy_name: string;
  exit_reason: string;       // free-form, e.g., "time_exit (hard floor 15:55)"
  detected_at: string;       // ISO-8601 ET wall-clock
  cleared_at: string | null;
}
