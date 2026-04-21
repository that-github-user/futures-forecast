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
export function roundToSpxTick(price: number): number {
  // Python's round() uses banker's rounding. JavaScript's Math.round()
  // does round-half-away-from-zero. Emulate Python's tie-to-even so
  // the number the UI renders matches the number the broker sees.
  const absPrice = Math.abs(price);
  const tick = absPrice < 3.0 ? 0.05 : 0.10;
  const scaled = price / tick;
  // Banker's rounding: if the fractional part is exactly 0.5, round to
  // the nearest even integer. Otherwise standard nearest-integer round.
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
