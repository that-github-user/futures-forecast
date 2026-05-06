/**
 * dcSizing — shared 5-layer sizing math for the DC dashboard.
 *
 * Mirrors the daemon's stack (vega-pilot core/sizing.py + engine/risk.py)
 * so the "Suggested contracts" number on a StrategyMonitorCard equals what
 * the daemon would actually submit at the same equity. Any drift between
 * this file and the Python implementation shows up immediately as a
 * frontend/backend parity test failure (tests/sizing/parity.test.ts).
 *
 *   Layer 1 — Copeland gating            // done upstream; consumes GO/GO+ signal
 *   Layer 2 — margin budget              // check_margin_budget
 *   Layer 3 — EV/MgDay priority          // deferred per CAPITAL_ALLOCATION.md §4
 *   Layer 4 — base sizing                // floor(equity * base_pct% / avg_margin)
 *   Layer 5 — D'Alembert × GO+           // scale by current_mult (clamped) + GO+ boost
 *
 * Margin proxy is `entry_debit × qty × SPX_MULTIPLIER` (§5). Frontend uses
 * `spec.avg_margin` as the per-contract cost when a live entry_debit is
 * unavailable.
 */

import type {
  DCAllocationPolicy,
  DCPosition,
  DCStrategySpec,
} from "../api/dcTypes";

export const SPX_MULTIPLIER = 100;

/**
 * Python 3 round() uses banker's rounding (round-half-to-even): round(0.5) = 0,
 * round(1.5) = 2, round(2.5) = 2, round(10.5) = 10. JavaScript's Math.round
 * rounds half-to-+inf: Math.round(0.5) = 1, Math.round(10.5) = 11. The daemon's
 * sizing (core/sizing.py::calculate_size line 105) uses Python's round; the
 * frontend must match or the "Suggested contracts" number drifts from what
 * the daemon would submit.
 *
 * The implementation detects exact-half cases (within float tolerance) and
 * branches: `floor(x)` if that floor is even, otherwise `floor(x) + 1`.
 * This works correctly for negatives too — `floor(-0.5) = -1`, which is odd,
 * so we bump to `0` (matching Python's `round(-0.5) = 0`). Non-half values
 * fall through to `Math.round`, which agrees with Python on all non-half
 * inputs. The parity fixture exercises both branches.
 */
export function roundHalfToEven(x: number): number {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (Math.abs(frac - 0.5) < 1e-9) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(x);
}

export type SuggestedSignal = "GO" | "GO_PLUS";

export interface SuggestedContractsInput {
  spec: DCStrategySpec;
  signal: SuggestedSignal;
  portfolioSize: number;
  policy: DCAllocationPolicy;
  /** Live D'Alembert counter from DCStrategyStats.current_mult (≥ 1). */
  currentDalMult: number;
  /** Currently-open DC positions for margin budget math. */
  openPositions: DCPosition[];
  /**
   * Per-contract dollar margin. When a live entry_debit is available use
   * `entry_debit * SPX_MULTIPLIER`; otherwise pass `spec.avg_margin`.
   * Returns 0 contracts if this is missing or non-positive.
   */
  marginPerContract: number | null;
}

export interface SuggestedContractsResult {
  baseContracts: number;
  dalContracts: number;
  goPlusContracts: number;
  /** Final recommended contracts after margin trim + hard cap. */
  finalContracts: number;
  /** Effective D'Alembert multiplier applied (clamped to policy.dal_cap). */
  dalMultApplied: number;
  /** True when the hard cap (policy.hard_cap) was binding. */
  hardCapped: boolean;
  /** True when the margin budget was binding. */
  marginTrimmed: boolean;
  /** Global cap in dollars for the current policy. */
  globalCap: number;
  /** Global margin already used across all open positions. */
  globalUsed: number;
  /** Per-strategy cap in dollars. */
  stratCap: number;
  /** Per-strategy margin already used for this strategy. */
  stratUsed: number;
  /** Set when finalContracts === 0 — explains why. */
  reasonIfZero: string | null;
}

// ---------------------------------------------------------------------------
// Margin budget helpers — mirror engine/risk.py
// ---------------------------------------------------------------------------

export interface MarginSnapshot {
  totalOpen: number;
  perStrategyOpen: Record<string, number>;
}

/** Mirrors RiskManager.update_open_margin — entry_debit × qty × 100. */
export function computeOpenMargin(positions: DCPosition[]): MarginSnapshot {
  let total = 0;
  const perStrat: Record<string, number> = {};
  for (const p of positions) {
    // Guard against missing/malformed records — the backend does the same.
    if (p.entry_debit == null || p.quantity == null) continue;
    if (p.status && p.status !== "open") continue;
    const margin = Number(p.entry_debit) * Number(p.quantity) * SPX_MULTIPLIER;
    if (!Number.isFinite(margin) || margin <= 0) continue;
    total += margin;
    perStrat[p.strategy_name] = (perStrat[p.strategy_name] ?? 0) + margin;
  }
  return { totalOpen: total, perStrategyOpen: perStrat };
}

/** Mirrors RiskManager.max_affordable_contracts — min(global, per-strat) avail / per-contract. */
export function maxAffordableContracts(
  strategyName: string,
  marginPerContract: number,
  snapshot: MarginSnapshot,
  portfolioSize: number,
  globalPct: number,
  perStratPct: number,
): number {
  if (portfolioSize <= 0 || marginPerContract <= 0) return 0;
  const globalCap = portfolioSize * (globalPct / 100);
  const stratCap = portfolioSize * (perStratPct / 100);
  const globalAvail = Math.max(0, globalCap - snapshot.totalOpen);
  const stratAvail = Math.max(
    0,
    stratCap - (snapshot.perStrategyOpen[strategyName] ?? 0),
  );
  const avail = Math.min(globalAvail, stratAvail);
  return Math.floor(avail / marginPerContract);
}

// ---------------------------------------------------------------------------
// Core sizing — mirrors PositionSizer.calculate_size + entry.py step 12a
// ---------------------------------------------------------------------------

export function computeSuggestedContracts(
  input: SuggestedContractsInput,
): SuggestedContractsResult {
  const { spec, signal, portfolioSize, policy, currentDalMult, openPositions, marginPerContract } = input;
  const hardCap = policy.hard_cap;

  const snapshot = computeOpenMargin(openPositions);
  const globalCap = portfolioSize * (policy.global_pct / 100);
  const stratCap = portfolioSize * (policy.per_strat_pct / 100);
  const stratUsed = snapshot.perStrategyOpen[spec.name] ?? 0;

  const empty = {
    baseContracts: 0,
    dalContracts: 0,
    goPlusContracts: 0,
    finalContracts: 0,
    dalMultApplied: 1,
    hardCapped: false,
    marginTrimmed: false,
    globalCap,
    globalUsed: snapshot.totalOpen,
    stratCap,
    stratUsed,
    reasonIfZero: null as string | null,
  };

  // Layer 4 base sizing requires a per-contract margin to scale off.
  const avgMargin = spec.avg_margin;
  if (avgMargin == null || avgMargin <= 0 || portfolioSize <= 0) {
    return { ...empty, reasonIfZero: "Missing avg_margin or portfolio size" };
  }

  // base = floor(equity * base_pct% / avg_margin); min 1
  const rawBase = Math.floor((portfolioSize * (policy.base_pct / 100)) / avgMargin);
  const baseContracts = Math.max(1, rawBase);

  // D'Alembert + GO+ — match daemon's PositionSizer.calculate_size exactly:
  // combine multipliers then round once. Using Math.round mirrors Python's
  // ``max(1, round(base * effective_mult))`` at core/sizing.py:105.
  // Note: Python's round() uses banker's rounding on exact .5 cases where JS
  // Math.round rounds half-to-+inf; the parity fixture is the guard.
  const dalMultApplied = Math.max(1, Math.min(policy.dal_cap, currentDalMult));
  const effectiveMult = signal === "GO_PLUS" ? dalMultApplied * policy.go_plus_mult : dalMultApplied;
  const sizedCombined = Math.max(1, roundHalfToEven(baseContracts * effectiveMult));
  // Expose the intermediate stages for the "base N × DAl X × GO+ Y" tooltip.
  const dalContracts = Math.max(1, roundHalfToEven(baseContracts * dalMultApplied));
  const goPlusContracts = sizedCombined;

  // Hard cap
  const afterHardCap = Math.min(sizedCombined, hardCap);
  const hardCapped = sizedCombined > hardCap;

  // Margin budget trim
  const perContract = marginPerContract && marginPerContract > 0 ? marginPerContract : avgMargin;
  const maxAffordable = maxAffordableContracts(
    spec.name,
    perContract,
    snapshot,
    portfolioSize,
    policy.global_pct,
    policy.per_strat_pct,
  );
  const finalContracts = Math.min(afterHardCap, maxAffordable);
  const marginTrimmed = maxAffordable < afterHardCap;

  let reasonIfZero: string | null = null;
  if (finalContracts === 0) {
    if (maxAffordable === 0) {
      if (snapshot.totalOpen >= globalCap) {
        reasonIfZero = "Over global margin cap";
      } else if (stratUsed >= stratCap) {
        reasonIfZero = "Over per-strategy margin cap";
      } else {
        reasonIfZero = "Insufficient margin available";
      }
    } else {
      reasonIfZero = "Base size calculation returned 0";
    }
  }

  return {
    baseContracts,
    dalContracts,
    goPlusContracts,
    finalContracts,
    dalMultApplied,
    hardCapped,
    marginTrimmed,
    globalCap,
    globalUsed: snapshot.totalOpen,
    stratCap,
    stratUsed,
    reasonIfZero,
  };
}

// ---------------------------------------------------------------------------
// Human-readable breakdown — for the Suggested row on StrategyMonitorCard
// ---------------------------------------------------------------------------

export function computeSizingBreakdown(r: SuggestedContractsResult, signal: SuggestedSignal): string {
  const parts: string[] = [`base ${r.baseContracts}`];
  if (r.dalMultApplied !== 1) parts.push(`× DAl ${r.dalMultApplied.toFixed(1)}`);
  if (signal === "GO_PLUS") parts.push(`× GO+ 1.5`);
  return parts.join(" ");
}

