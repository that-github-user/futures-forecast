/**
 * Frontend/backend sizing parity test.
 *
 * Consumes the canned fixture produced by vega-pilot's
 * ``tests/test_frontend_sizing_parity.py``. Each scenario must produce
 * the same final contract count via ``computeSuggestedContracts`` as the
 * daemon's own 5-layer stack. Drift in either side fails this test —
 * which is exactly what we want: the "Suggested contracts" number on a
 * StrategyMonitorCard must never silently diverge from what the daemon
 * would actually submit.
 *
 * Regenerate the fixture after changing sizing.py/risk.py in vega-pilot:
 *   (in vega-pilot) pytest tests/test_frontend_sizing_parity.py
 *   (in futures-forecast) cp ../vega-pilot/tests/fixtures/sizing_parity.json src/lib/__fixtures__/
 */

import { describe, expect, it } from "vitest";

import type { DCAllocationPolicy, DCPosition, DCStrategySpec } from "../api/dcTypes";
import { computeSuggestedContracts, roundHalfToEven, SPX_MULTIPLIER } from "./dcSizing";
import fixture from "./__fixtures__/sizing_parity.json";

interface FixtureCase {
  label: string;
  input: {
    strategy: string;
    avg_margin: number;
    signal: "GO" | "GO_PLUS";
    policy_key: string;
    policy: {
      base_pct: number;
      dal_cap: number;
      go_plus_mult: number;
      global_pct: number;
      per_strat_pct: number;
      hard_cap: number;
    };
    portfolio_value: number;
    current_mult: number;
    open_positions: Array<{ strategy_name: string; entry_debit: number; quantity: number }>;
    spx_multiplier: number;
  };
  expected: {
    final_contracts: number;
    max_affordable: number;
    sized_before_margin_trim: number;
    global_cap: number;
    global_used: number;
    strat_cap: number;
    strat_used: number;
  };
}

const CASES = (fixture as { cases: FixtureCase[] }).cases;

function makeSpec(name: string, avgMargin: number): DCStrategySpec {
  return {
    name,
    family: "short_dte",
    avg_margin: avgMargin,
    front_dte: 2,
    back_dte: 3,
    put_delta: 25,
    call_delta: 25,
    is_asymmetric: false,
    entry_days: [0],
    entry_times: ["12:00"],
    sl_ratio_min: null,
    vix_min: null,
    profit_target_pct: 0.3,
    exit_time: "15:30",
    sl_ratio_exit: null,
    max_dit: null,
    delta_exits: [],
    tested_exits: [],
    partial_close: null,
    entry_window_end: null,
  };
}

function makePolicy(key: string, p: FixtureCase["input"]["policy"]): DCAllocationPolicy {
  return {
    key: key as DCAllocationPolicy["key"],
    name: key,
    description: "",
    base_pct: p.base_pct,
    dal_cap: p.dal_cap,
    go_plus_mult: p.go_plus_mult,
    global_pct: p.global_pct,
    per_strat_pct: p.per_strat_pct,
    hard_cap: p.hard_cap,
    copeland_mode: "aggressive",
    recommended: key === "rec_60_10",
    backtest: { start_equity: 100_000, terminal_equity: 0, pf: 0, max_dd_pct: 0, years: 3.8, trades_skipped: 0 },
    monte_carlo: { median: 0, p5: 0, p95: 0 },
  };
}

function makePosition(p: { strategy_name: string; entry_debit: number; quantity: number }): DCPosition {
  return {
    id: 0,
    strategy_name: p.strategy_name,
    signal: "GO",
    entry_time: "",
    entry_date: "",
    put_strike: 0,
    call_strike: 0,
    front_exp: "",
    back_exp: "",
    entry_debit: p.entry_debit,
    quantity: p.quantity,
    original_quantity: p.quantity,
    spx_at_entry: null,
    status: "open",
    close_reason: null,
    close_time: null,
    close_pnl: null,
  };
}

describe("dcSizing parity with vega-pilot daemon", () => {
  it("agrees on SPX_MULTIPLIER", () => {
    expect(SPX_MULTIPLIER).toBe(100);
    // Every scenario in the fixture must use the same multiplier.
    for (const c of CASES) expect(c.input.spx_multiplier).toBe(SPX_MULTIPLIER);
  });

  it.each(CASES)("matches daemon for: $label", (c) => {
    const spec = makeSpec(c.input.strategy, c.input.avg_margin);
    const policy = makePolicy(c.input.policy_key, c.input.policy);
    const openPositions = c.input.open_positions.map(makePosition);

    const result = computeSuggestedContracts({
      spec,
      signal: c.input.signal,
      portfolioSize: c.input.portfolio_value,
      policy,
      currentDalMult: c.input.current_mult,
      openPositions,
      marginPerContract: c.input.avg_margin,
    });

    expect(result.finalContracts).toBe(c.expected.final_contracts);
    expect(result.globalCap).toBeCloseTo(c.expected.global_cap, 6);
    expect(result.globalUsed).toBeCloseTo(c.expected.global_used, 6);
    expect(result.stratCap).toBeCloseTo(c.expected.strat_cap, 6);
    expect(result.stratUsed).toBeCloseTo(c.expected.strat_used, 6);
  });
});

describe("roundHalfToEven — matches Python round()", () => {
  it.each([
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [4.5, 4],
    [10.5, 10],
    [-0.5, 0],
    [-1.5, -2],
    [-2.5, -2],
    // Non-halves should agree with Math.round
    [1.4, 1],
    [1.6, 2],
    [-1.4, -1],
    [-1.6, -2],
    // Exact integers pass through
    [0, 0],
    [7, 7],
    [-3, -3],
  ])("round(%f) === %i", (input, expected) => {
    expect(roundHalfToEven(input)).toBe(expected);
  });
});

describe("computeSuggestedContracts — defensive edge cases", () => {
  const basePolicy: DCAllocationPolicy = {
    key: "rec_60_10",
    name: "",
    description: "",
    base_pct: 5,
    dal_cap: 2,
    go_plus_mult: 1.5,
    global_pct: 60,
    per_strat_pct: 10,
    hard_cap: 50,
    copeland_mode: "aggressive",
    recommended: true,
    backtest: { start_equity: 100_000, terminal_equity: 0, pf: 0, max_dd_pct: 0, years: 3.8, trades_skipped: 0 },
    monte_carlo: null,
  };
  const baseSpec: DCStrategySpec = {
    name: "TEST",
    family: "short_dte",
    avg_margin: 870,
    front_dte: 2,
    back_dte: 3,
    put_delta: 25,
    call_delta: 25,
    is_asymmetric: false,
    entry_days: [0],
    entry_times: ["12:00"],
    sl_ratio_min: null,
    vix_min: null,
    profit_target_pct: 0.3,
    exit_time: "15:30",
    sl_ratio_exit: null,
    max_dit: null,
    delta_exits: [],
    tested_exits: [],
    partial_close: null,
    entry_window_end: null,
  };

  it("returns 0 when portfolioSize is 0", () => {
    const r = computeSuggestedContracts({
      spec: baseSpec,
      signal: "GO",
      portfolioSize: 0,
      policy: basePolicy,
      currentDalMult: 1,
      openPositions: [],
      marginPerContract: 870,
    });
    expect(r.finalContracts).toBe(0);
    expect(r.reasonIfZero).not.toBeNull();
  });

  it("returns 0 when avg_margin is null", () => {
    const r = computeSuggestedContracts({
      spec: { ...baseSpec, avg_margin: null },
      signal: "GO",
      portfolioSize: 100_000,
      policy: basePolicy,
      currentDalMult: 1,
      openPositions: [],
      marginPerContract: null,
    });
    expect(r.finalContracts).toBe(0);
  });

  it("clamps currentDalMult below 1 up to 1", () => {
    const r = computeSuggestedContracts({
      spec: baseSpec,
      signal: "GO",
      portfolioSize: 100_000,
      policy: basePolicy,
      currentDalMult: 0,            // malformed input
      openPositions: [],
      marginPerContract: 870,
    });
    expect(r.dalMultApplied).toBe(1);
  });

  it("clamps currentDalMult above policy.dal_cap down to the cap", () => {
    const r = computeSuggestedContracts({
      spec: baseSpec,
      signal: "GO",
      portfolioSize: 100_000,
      policy: basePolicy,              // dal_cap = 2
      currentDalMult: 10,              // daemon-side counter went haywire
      openPositions: [],
      marginPerContract: 870,
    });
    expect(r.dalMultApplied).toBe(2);
  });

  it("skips malformed position records when computing open margin", () => {
    const r = computeSuggestedContracts({
      spec: baseSpec,
      signal: "GO",
      portfolioSize: 100_000,
      policy: basePolicy,
      currentDalMult: 1,
      openPositions: [
        // Each of these should be ignored — not count toward margin
        { ...makeZeroPos(), entry_debit: null as unknown as number, quantity: 5 },
        { ...makeZeroPos(), entry_debit: 5, quantity: null as unknown as number },
        { ...makeZeroPos(), entry_debit: -5, quantity: 5 },
        { ...makeZeroPos(), status: "closed", entry_debit: 5, quantity: 5 },
      ],
      marginPerContract: 870,
    });
    expect(r.globalUsed).toBe(0);
    expect(r.stratUsed).toBe(0);
  });
});

function makeZeroPos(): DCPosition {
  return {
    id: 0,
    strategy_name: "TEST",
    signal: "GO",
    entry_time: "",
    entry_date: "",
    put_strike: 0,
    call_strike: 0,
    front_exp: "",
    back_exp: "",
    entry_debit: 0,
    quantity: 0,
    original_quantity: 0,
    spx_at_entry: null,
    status: "open",
    close_reason: null,
    close_time: null,
    close_pnl: null,
  };
}
