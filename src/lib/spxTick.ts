/**
 * SPX / SPXW option tick-size rule, mirroring the daemon's
 * `ibkr.orders.round_to_tick_size` (which every order submission path
 * goes through).
 *
 * CBOE / IBKR enforces:
 *   price <  $3.00  → $0.05 increments
 *   price ≥  $3.00  → $0.10 increments
 *
 * Any price displayed as a "this is what your TP will submit at" on
 * the dashboard MUST be rounded through this function, otherwise the
 * UI shows values that the broker would reject or hold off-tick. The
 * user caught this on 2026-04-21: a $9.40 entry × 1.30 PT displayed
 * as $12.22, but the actual close order would be $12.20.
 *
 * Keep this helper's math byte-identical to the backend's
 * `round_to_tick_size`. Unit test in spxTick.test.ts parametrizes the
 * same cases as tests/test_tick_size.py::TestSmallPrices /
 * TestLargePrices / TestBoundary.
 */
/** Python-style banker's round of `price / tick` × `tick`. Extracted so
 *  the SPX and SPY variants share identical tie-handling behavior. */
function roundToTick(price: number, tick: number): number {
  const scaled = price / tick;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  let rounded: number;
  if (frac < 0.5) {
    rounded = floor;
  } else if (frac > 0.5) {
    rounded = floor + 1;
  } else {
    // Exactly 0.5 — round to even.
    rounded = (floor % 2 === 0) ? floor : floor + 1;
  }
  return rounded * tick;
}

export function roundToSpxTick(price: number): number {
  // Python's round() uses banker's rounding. JavaScript's Math.round()
  // does round-half-away-from-zero. Emulate Python's tie-to-even so
  // the number the UI renders matches the number the broker sees.
  const absPrice = Math.abs(price);
  const tick = absPrice < 3.0 ? 0.05 : 0.10;
  return roundToTick(price, tick);
}

/**
 * SPY option tick-size rule. SPY is in the CBOE penny pilot program, so
 * its tick grid is finer than SPX's:
 *   price <  $3.00  → $0.01 increments
 *   price ≥  $3.00  → $0.05 increments
 *
 * Call on any price displayed as a "this is what your close order would
 * submit at" on a SPY credit-strategy card. Using `roundToSpxTick` for
 * SPY produces visibly-wrong values: a $1.37 TP target gets rendered as
 * $1.35 (SPX's $0.05 grid) when the real tick would let it sit at
 * $1.37 exactly.
 */
export function roundToSpyTick(price: number): number {
  const absPrice = Math.abs(price);
  const tick = absPrice < 3.0 ? 0.01 : 0.05;
  return roundToTick(price, tick);
}
