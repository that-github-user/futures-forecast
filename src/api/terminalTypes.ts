/**
 * TS types mirroring the terminal API Pydantic schemas in
 * `vega-pilot/futures_terminal/api/schemas.py`. Keep in lockstep —
 * any backend schema change requires updating these.
 */

export type RegimeLabel =
  | "trending"
  | "mean_reverting"
  | "volatile"
  | "quiet"
  | "unknown";

export interface TerminalHealth {
  status: "ok" | "degraded";
  ibkr_connected: boolean;
  last_tick_age_seconds: number | null;
  // Names of streams the terminal-api's StaleStreamWatcher has
  // flagged as stale beyond threshold for ≥5 consecutive watcher
  // cycles (~5min) despite re-subscribe attempts. Empty list =
  // healthy. Common cause: competing IBKR live session (Error
  // 10197) — operator should log out of any other TWS / Gateway /
  // mobile session sharing the account. Defaults to [] when the
  // backend hasn't deployed the watcher field yet (graceful
  // degradation during cross-repo deploy ordering).
  degraded_streams?: string[];
}

export interface RegimeData {
  vix: number | null;
  sqn: number | null;
  divergence_flag: "positive" | "negative" | "none";
  regime_label: RegimeLabel;
  confidence: number | null;
}

export interface GexData {
  available: boolean;
  flip_strike: number | null;
  largest_gamma_strike: number | null;
  dealer_posture: "dampen" | "amplify" | "unknown";
  message: string;
}

export interface AnchoredVwap {
  name: string;
  value: number | null;
  anchor_time: string | null;
}

export interface VwapData {
  session_vwap: number | null;
  anchored: AnchoredVwap[];
  confluence_count: number;
  confluence_price: number | null;
}

export interface LevelsData {
  pd_high: number | null;
  pd_low: number | null;
  pd_close: number | null;
  /** Previous-prior-session HLC — the RTH session BEFORE the one
   *  carried in pd_*. Layered as a secondary overnight reference via
   *  the OverlaysSheet "Prev session" toggle. Null when fewer than
   *  two prior sessions are in the buffer (cold start). Backend
   *  (PR #185) cuts over at 16:00 ET — pre-RTH-close pd_* = Friday's
   *  and prev_pd_* = Thursday's; post-RTH-close pd_* = today's and
   *  prev_pd_* = Friday's. */
  prev_pd_high: number | null;
  prev_pd_low: number | null;
  prev_pd_close: number | null;
  /** Overnight High — extreme of the most-recent ETH overnight
   *  window: ETH session reopen (18:00 ET — AFTER the 17:00→18:00
   *  Globex maintenance break) through the next RTH open (09:30 ET).
   *  Deliberately excludes the 16:00→17:00 after-cash-close hour
   *  (ES trades there but it's not the "overnight session" per
   *  operator definition). Frozen inside RTH at the just-completed
   *  overnight's value; running pre-09:30 and during ETH evenings
   *  as bars extend through the window. */
  onh: number | null;
  /** Overnight Low — see onh for window definition. */
  onl: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  // Per-window opening-range high/low. Frontend renders any combo
  // via the OR popover-checklist.
  or_1m_high: number | null;
  or_1m_low: number | null;
  or_5m_high: number | null;
  or_5m_low: number | null;
  or_15m_high: number | null;
  or_15m_low: number | null;
  // Legacy aliases for the 5m window (kept for back-compat with
  // any consumer still reading these — synthesizer scoring etc).
  or_high: number | null;
  or_low: number | null;
}

export interface BreadthData {
  tick: number | null;
  trin: number | null;
  advn_decl_ratio: number | null;
  hyg_lqd_ratio: number | null;
  hyg_lqd_lead_signal: "bullish" | "bearish" | "neutral" | "unknown";
}

export type SystemKey = "volatility" | "gamma" | "structure" | "levels" | "breadth";

export interface SynthesizerContribution {
  system: SystemKey;
  /** System-internal score (signed). */
  score: number;
  /** Signed contribution to the synthesizer total. */
  contribution: number;
  /** Normalized share for proportional bar rendering, range -1..+1. */
  share: number;
}

export interface SynthesizerData {
  score: number;
  confirms: number;
  /** Hard-stop override names — non-empty list desaturates the
   *  headline score chip per spec §4.1.1 ("the score is a lie"). */
  overrides: string[];
  /** Tier 2 advisory event names — namespaced by source system
   *  (e.g. "levels.gap_failed.rth", "micro.range_expansion"). Surfaced
   *  on the System Feed as a separate event class (medium importance,
   *  no §4.1.1 visual treatment). Defaults to empty list when no
   *  Tier 2 detector has fired. */
  advisories: string[];
  bias: "LONG" | "SHORT" | "FLAT";
  conviction: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  contributions: SynthesizerContribution[];
  score_history_4h: number[];
}

export interface TerminalIntradayBar {
  /** ISO-8601 UTC, Z-suffixed (e.g. "2026-04-26T22:01:00Z"). */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TerminalIntradayBarsResponse {
  bars: TerminalIntradayBar[];
  /** True when the served bars came from the historical-fetcher cache
   *  during a fetch failure — either the `intraday_eth` slot is in
   *  circuit-breaker cooldown or the most recent IBKR fetch attempt
   *  timed out. Chart renders a "STALE" badge so a customer doesn't
   *  mistake yesterday's bars for live data during an IBKR outage.
   *  Defaults to false on older payloads (graceful degradation during
   *  cross-repo deploy ordering). */
  stale?: boolean;
  /** Seconds since the most recent SUCCESSFUL IBKR fetch for the
   *  intraday_eth slot. null means no fetch has ever succeeded
   *  (cold start). Formatted onto the STALE badge for operator
   *  triage — distinguishes "stale by 30s" from "stale by 6 hours". */
  data_age_seconds?: number | null;
}

// Macro calendar (System 8 — advisory-only).
// vol 1-3 impact tier mirrors economic-calendar provider schema:
// 3 = highest (CPI/NFP/FOMC-equivalent), 2 = moderate (PCE/PPI/ISM),
// 1 = light (Baker Hughes/CFTC reports). Imminent-window thresholds
// are tier-driven (vol 3 → 60min, vol 2 → 30min, vol 1 → 15min).
export interface MacroEvent {
  timestamp: string;       // UTC ISO-8601
  time_et: string;         // "HH:MM" ET wall-clock
  name: string;
  vol: 1 | 2 | 3;
  minutes_until: number;   // positive int; rounded down
  is_imminent: boolean;    // within tier-driven imminent window
}

export interface CalendarData {
  events: MacroEvent[];    // active mode's window, sorted ascending by timestamp
  // Display mode, switched server-side based on ET wall-clock:
  //   "next_24h"   — Mon 00:00 ET → Fri 17:00 ET, rolling 24h window, all vols.
  //   "week_ahead" — Fri 17:00 ET → Sun 23:59 ET, forward 7-day vol≥2 docket.
  //                  Lets a Sunday-night trader pre-flight the macro week.
  // Older snapshot payloads (pre-PR) lack the field — treat undefined as
  // "next_24h" for graceful degradation during deploy rollover.
  mode?: "next_24h" | "week_ahead";
}

// Gap-fill target context. Populated when the gap_fill.* advisory is
// firing — carries the prior pre-halt close ES needs to trade to in
// order to fill the gap. Frontend's ActiveAdvisories renders inline
// alongside the "Open gap" label so the trader sees the level without
// having to look at the chart.
export interface GapFillContext {
  target_price: number;
  direction: "up" | "down";
  open_price: number;
  // CME settlement (Tick Type 9) for the prior session, surfaced
  // when it differs meaningfully from target_price (≥ 0.5pt). Drives
  // the gap_fill.set_reached intermediate-target advisory body and
  // (optionally) inline rendering. Null on quiet days where SET ≈ PDC.
  settlement_price: number | null;
}

// Server-recorded transition event for the System Feed sidebar.
// Mirrors backend FeedEvent (futures_terminal/api/schemas.py).
// The backend records OVERRIDE/ADVISORY/BIAS/REGIME/CREDIT/TICK
// transitions to a ring buffer; snapshot.events surfaces them
// filtered to the current ETH session. Frontend renders directly
// — no local diff detection needed (which silently dropped any
// events fired before page load on hard-refresh).
export interface FeedEvent {
  id: string;
  timestamp_ms: number;
  kind: "tick" | "credit" | "override" | "advisory" | "regime" | "bias";
  importance: "high" | "medium" | "low";
  subject: string;
  body: string;
  // Raw event identifier (e.g. "gap_fill.opened" for advisories,
  // override key like "weekly-vwap-lost"). Lets the frontend
  // re-format with formatAdvisoryName when richer rendering is
  // needed; falls back to the server-rendered `body`.
  name: string | null;
}

export interface TerminalSnapshot {
  timestamp: string;
  es_price: number | null;
  es_change: number | null;
  es_change_pct: number | null;
  // CME-published settlement for the prior session (Tick Type 9).
  // Distinct from levels.pd_close (PDC = 16:00 ET RTH close used by
  // gap-fill state machine + chart PDC line). The headline ticker's
  // change% is computed against es_settlement on the backend already
  // (with fallback to pd_close on cold start). Frontend exposes it
  // for the chart's SET reference line.
  es_settlement: number | null;
  regime: RegimeData;
  gex: GexData;
  vwap: VwapData;
  levels: LevelsData;
  breadth: BreadthData;
  synthesizer: SynthesizerData;
  calendar: CalendarData;
  gap_fill: GapFillContext | null;
  // Server-recorded System Feed events for the current ETH session.
  // Backend handles all diff detection now — frontend just renders.
  events: FeedEvent[];
}
