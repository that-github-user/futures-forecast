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
  /** Overnight High — extreme of the most-recent ETH (non-RTH)
   *  contiguous bar run (prior 16:00 ET → next 09:30 ET). Frozen
   *  inside RTH; running pre-09:30 and during ETH evenings. */
  onh: number | null;
  /** Overnight Low — see onh. */
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
}

export interface TerminalSnapshot {
  timestamp: string;
  es_price: number | null;
  es_change: number | null;
  es_change_pct: number | null;
  regime: RegimeData;
  gex: GexData;
  vwap: VwapData;
  levels: LevelsData;
  breadth: BreadthData;
  synthesizer: SynthesizerData;
}
