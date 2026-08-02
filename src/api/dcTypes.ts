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

/**
 * A would-have-entered trade. Every signal-side gate cleared but the
 * broker-fill phase failed (`blocked_order` — typically the entry
 * reprice ladder exhausted with zero fills, or parked-at-ask without
 * a fill). The daemon never owned contracts, but the play is real and
 * appears in the Tent tab's "missed entries" section so operators can
 * track the position they SHOULD have been holding even when
 * automation couldn't fill.
 *
 * `position_uid` always starts with `phantom_` — fan out to the
 * existing `dcApi.phantomTentBundle(uid)` endpoint to render the
 * through-expiry curve.
 *
 * `block_category` is the stable enum classifying why no fill happened:
 *   - "ladder_exhausted"  — entry reprice ladder ran through all rungs
 *   - "parked_no_fill"    — held at ask for the configured park dwell
 *   - "entries_disabled"  — automated entry is switched off; no order
 *                           was ever submitted (the only category the
 *                           daemon still emits since 2026-08-01)
 *   - "other"             — future broker-reject / mid-fill paths
 *
 * The first two and the third are NOT comparable. On a submitted order
 * `intended_debit` is a price the book demonstrably refused; on an
 * "entries_disabled" row it is the untested mid the ladder would have
 * started from, so phantom P&L computed off it runs optimistic. Group
 * by block_category before comparing phantom results to real trades.
 */
export interface DCPhantomPosition {
  id: number;
  position_uid: string;
  strategy_name: string;
  signal: string;
  // ISO8601 with offset, ET-anchored (e.g. "2026-05-15T10:30:00-04:00")
  entry_time: string;
  // ISO date `YYYY-MM-DD`, ET-anchored (derived from entry_time's ET
  // wall-clock date by the daemon at write time). Safe for lexicographic
  // comparison against another `YYYY-MM-DD` string.
  entry_date: string;
  put_strike: number;
  call_strike: number;
  // YYYYMMDD (no separators), matching IBKR's contract expiry format.
  front_exp: string;
  back_exp: string;
  intended_debit: number;
  intended_quantity: number;
  spx_at_intent: number | null;
  block_reason: string | null;
  block_category: string | null;
  entry_front_put_iv: number | null;
  entry_front_call_iv: number | null;
  entry_back_put_iv: number | null;
  entry_back_call_iv: number | null;
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
  //   "live_stream"       — sl_ratio is from a streaming pre-entry
  //                         subscription (strategy in its T-60s →
  //                         T-0 window). Renders the LIVE badge.
  //   "live_stream_stale" — pre-entry stream just ended; values are
  //                         the last snapshot held in the daemon's
  //                         afterglow buffer (#274). Up to ~2 min
  //                         old. Dashboard dims values + shows
  //                         "RECENT" instead of LIVE.
  //   "snapshot"          — sl_ratio is from the 2-min SL worker
  //                         poll (potentially stale by up to 2 min).
  //   null                — no S/L data for this strategy yet.
  sl_ratio_source?: "live_stream" | "live_stream_stale" | "snapshot" | null;
  // Oldest-leg tick age in ms at API-call time, when source is
  // "live_stream". Null otherwise.
  last_tick_age_ms?: number | null;
  // True when this strategy is currently in its pre-entry window.
  pre_entry_window_active?: boolean | null;
  // Most recent entry-time outcome for this strategy today (NY date),
  // read directly from the daemon's signal_events table (#277).
  // Lets the dashboard render the post-window state without re-
  // deriving daemon decisions (SL gate, VIX gate, deconflict,
  // margin block, order rejection, …) on the client.
  // Frontend rule: blacklist `entered` — anything else = didn't
  // enter — so future daemon outcomes self-classify as skipped
  // without frontend updates.
  // Known values: entered | skipped_signal | blocked_sl_gate |
  // blocked_vix | blocked_margin | blocked_order |
  // blocked_deconflict | blocked_strike | blocked_features |
  // blocked_canTrade. Open enum; UI must default to skipped.
  // Null when no entry evaluation has happened yet today.
  today_outcome?: string | null;
  // Human-readable detail from signal_events.outcome_reason — e.g.,
  // "SL ratio 0.65 below 0.70 minimum" for a blocked_sl_gate
  // outcome. Surfaced as a tooltip on the card body so the operator
  // sees WHY the daemon skipped without digging through Events tab.
  today_outcome_reason?: string | null;
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
  // Server-side ISO timestamp of when THIS response was computed.
  // Used by the LIVE badge in the Signals tab: the badge displays
  // "Live tick {N}ms ago", computed client-side as
  // `(Date.now() - Date.parse(computed_at)) + last_tick_age_ms`
  // so the value ages between dashboard polls instead of staying
  // static at the server-computed instant. Null on older daemons
  // (pre-Phase-4 follow-up) → frontend falls back to the static
  // server-side `last_tick_age_ms`.
  computed_at?: string | null;
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
// Capital Allocation tab (ensemble-gate backtest, 2023-06-01 → 2026-04-29)
// ---------------------------------------------------------------------------

export type PolicyKey = "live" | "conservative" | "go_only" | "aggressive" | "static_1ct";

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
  recommended: boolean;
  // Null for the static_1ct baseline (no compounding research applies);
  // populated for every ensemble-gate policy.
  backtest: DCPolicyBacktest | null;
  // Only populated for the `live` policy — 500-path bootstrap (14-day blocks).
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

// ── Tent-PnL tracker (PR 4–7) ─────────────────────────────────────
//
// Mirrors the Pydantic models in automated-dc-entry/api/schemas.py.
// `iv_source` echoes one of four labels the renderer should
// distinguish in tooltips / badges:
//   "entry"          — positions.entry_*_iv (frozen at fill)
//   "latest"         — most recent greek_snapshots row (live-drift)
//   "entry_fallback" — caller asked for "latest" but no snapshot yet
//   "intrinsic"      — no IVs anywhere; tent is intrinsic-only
//                      (frontend MUST surface the warning).
//
// `current_spx_source` (#338 — gathered from `api/app.py:_read_current_spx`
// + the legacy fallback at app.py:1314):
//   "index"               — RTH SPX cash from broker_state, authoritative.
//   "es_proxy"             — ETH proxy: ES front-month - fresh basis
//                            (<12h old). Render SPX marker with "(ES)" tag.
//   "es_proxy_stale"       — ES proxy with basis >12h old (weekend gap,
//                            extended /terminal outage). Render SPX
//                            marker dashed + "(ES~)" tag.
//   "broker_state"         — LEGACY fallback when sidecar predates #290
//                            (no `spx_source` key on disk). Treated as
//                            authoritative for rendering (solid line, no
//                            tag) — same visual as "index". To be removed
//                            after #290 has been live one full session;
//                            keep in the union until then so a deploy-
//                            window mismatch doesn't break the type.
//   "fallback_midstrike"   — SpxProxy ran but produced nothing AND no
//                            sidecar value; tent centered on strike
//                            midpoint. Render SPX marker dashed +
//                            "(est)" tag so operator sees a placeholder
//                            without being misled into thinking it's real.
//   "unavailable"          — daemon's SpxProxy returned no value at all;
//                            tent centered on strike midpoint; SPX
//                            marker suppressed (backend leaves
//                            current_spx=null in this case).
//
// Pre-#338 this was typed as `"broker_state" | "fallback_midstrike"`
// AND the SPX-rendering gate checked `=== "broker_state"`. With the
// post-#290 daemon emitting "index" / "es_proxy" / etc., the gate never
// matched and SPX never rendered. Fixed in #338 by both broadening the
// union AND switching the gate to `current_spx != null`.
//
// `phantom: true` → render with dashed border + "would-have-entered"
//                   pill so operators can tell phantoms from real
//                   positions.
//
// `warnings`: human-readable degradation strings — banner candidates.
export type DCTentIVSource = "entry" | "latest" | "entry_fallback" | "intrinsic";
export type DCTentSpxSource =
  | "index"
  | "es_proxy"
  | "es_proxy_stale"
  | "broker_state"  // legacy fallback — see comment block above
  | "fallback_midstrike"
  | "unavailable";

export interface DCTentPoint {
  spx: number;
  value: number;
}

export interface DCTentResponse {
  points: DCTentPoint[];
  current_spx: number | null;
  current_spx_source: DCTentSpxSource;
  entry_debit: number;
  breakeven_low: number | null;
  breakeven_high: number | null;
  pole_low: number;          // = put strike
  pole_high: number;         // = call strike
  days_in_trade: number;
  days_to_front_exp: number;
  days_to_back_exp: number;
  iv_source: DCTentIVSource;
  phantom: boolean;
  // Only meaningful when `phantom` is true: which flavor of
  // would-have-entered this is, mirroring
  // phantom_positions.block_category. Without it the modal can only ask
  // "is this a phantom?" and is forced to assume a broker-fill failure,
  // which is wrong for every row written while automated entry is off.
  // Null on real positions and on legacy phantoms predating the enum —
  // treat null as "unknown flavor", not as "ladder failed".
  block_category: string | null;
  as_of_resolved: string;
  snapshot_time: string | null;
  warnings: string[];
  iv_front_put: number | null;
  iv_front_call: number | null;
  iv_back_put: number | null;
  iv_back_call: number | null;
}

/**
 * All 4 tent curves for one position in a single response. Replaces
 * the 4-separate-fetches pattern that compounded Cloudflare Tunnel
 * latency into a 20s wait (operator-reported). Bundle endpoint
 * collapses to one CFT roundtrip ≈ 100-500ms.
 *
 * Each curve field is optional:
 *   - frozen: null when iv_source can't resolve to 'entry' (closed
 *     trade without entry IVs, e.g.)
 *   - today: null only on hard compute failure (per-curve degradation
 *     is logged; bundle is still returned)
 *   - halfway / at_expiry: null when DTE is too small for evolution
 *     curves (within ~0.5 days of front expiry) or front_exp is
 *     unparseable
 *
 * `cache_hit` is a diagnostic map (curve_kind → bool) — True when
 * the curve was served from the precomputed `tent_curves` SQLite
 * cache, False when the bundled handler computed it on-demand (cold
 * cache, new position before first greek_logger tick).
 *
 * `served_at` marks when the API assembled the bundle (distinct
 * from each curve's `as_of_resolved` and `snapshot_time` which mark
 * compute-time and IV-source-time respectively).
 */
export interface DCTentBundleResponse {
  frozen: DCTentResponse | null;
  today: DCTentResponse | null;
  /** @deprecated #338 dropped the Halfway tent curve from the UI
   *  (convexity / exponential theta made it visually indistinguishable
   *  from Today). The backend still computes + ships it for
   *  pre-#339-deploy compatibility; consumers MUST drop it on read.
   *  Removed in follow-up #339. */
  halfway: DCTentResponse | null;
  at_expiry: DCTentResponse | null;
  cache_hit: Record<string, boolean>;
  served_at: string;
}


export interface DCGreekSnapshot {
  snapshot_time: string;
  spx_price: number | null;
  days_to_front_exp: number | null;
  days_to_back_exp: number | null;
  front_put_iv: number | null;
  front_call_iv: number | null;
  back_put_iv: number | null;
  back_call_iv: number | null;
  front_put_delta: number | null;
  front_call_delta: number | null;
  back_put_delta: number | null;
  back_call_delta: number | null;
  front_put_vega: number | null;
  front_call_vega: number | null;
  back_put_vega: number | null;
  back_call_vega: number | null;
  front_put_theta: number | null;
  front_call_theta: number | null;
  back_put_theta: number | null;
  back_call_theta: number | null;
  source: string;
  created_at: string | null;
}

export interface DCGreekSnapshotsResponse {
  position_uid: string;
  snapshots: DCGreekSnapshot[];
}
