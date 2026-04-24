import { describe, it, expect } from "vitest";
import { roundToSpxTick, roundToSpyTick } from "./spxTick";

// Cases ported from automated-dc-entry/tests/test_tick_size.py so any
// future divergence between backend and frontend tick-rounding shows
// up as a simultaneous failure.

describe("roundToSpxTick — small prices (<$3)", () => {
  it.each([
    [0.00, 0.00],
    [0.05, 0.05],
    [0.07, 0.05],  // snaps down
    [0.12, 0.10],  // snaps down
    [0.13, 0.15],  // snaps up
    [1.27, 1.25],
    [2.97, 2.95],
  ])("rounds %p → %p (5c grid)", (raw, expected) => {
    expect(roundToSpxTick(raw)).toBeCloseTo(expected, 6);
  });
});

describe("roundToSpxTick — large prices (≥$3)", () => {
  it.each([
    [3.00, 3.00],
    [3.04, 3.00],     // snaps down
    [3.06, 3.10],     // snaps up
    [9.40, 9.40],     // on-grid
    [9.42, 9.40],     // non-tick cost basis from partial fills
    [9.46, 9.50],
    // Banker's-rounding ties. A future refactor that replaces the
    // manual frac==0.5 → round-to-even with Math.round(scaled)*tick
    // would silently diverge from the Python backend on these cases.
    // Lock the contract: 9.45 → 9.40 (not 9.50), 15.75 → 15.80.
    [9.45, 9.40],
    [15.75, 15.80],
    [12.22, 12.20],   // ← the case the user noticed: 9.40 × 1.30
    [12.87, 12.90],   // e.g. 9.90 × 1.30
    [15.73, 15.70],
    [100.01, 100.00],
  ])("rounds %p → %p (10c grid)", (raw, expected) => {
    expect(roundToSpxTick(raw)).toBeCloseTo(expected, 6);
  });
});

describe("roundToSpxTick — boundary at $3", () => {
  it("exactly $3 uses the 10c grid (per rule: price ≥ $3)", () => {
    expect(roundToSpxTick(3.00)).toBeCloseTo(3.00, 6);
  });
  it("just under $3 still uses 5c grid", () => {
    expect(roundToSpxTick(2.97)).toBeCloseTo(2.95, 6);
  });
  it("just over $3 uses 10c grid", () => {
    expect(roundToSpxTick(3.04)).toBeCloseTo(3.00, 6);
  });
});

// SPY is in the CBOE penny pilot program — $0.01 below $3, $0.05 above.
// These cases pin values that roundToSpxTick would visibly mis-round
// (e.g. $1.37 → $1.35 on SPX's $0.05 grid, but stays $1.37 on SPY's
// $0.01 grid).
describe("roundToSpyTick — small prices (<$3)", () => {
  it.each([
    [0.00, 0.00],
    [0.01, 0.01],
    [0.014, 0.01],   // snaps down
    [0.016, 0.02],   // snaps up
    [1.37, 1.37],    // the case SPX rounding breaks
    [1.374, 1.37],
    [1.376, 1.38],
    [2.25, 2.25],
    [2.99, 2.99],
  ])("rounds %p → %p (1c grid)", (raw, expected) => {
    expect(roundToSpyTick(raw)).toBeCloseTo(expected, 6);
  });
});

describe("roundToSpyTick — large prices (≥$3)", () => {
  it.each([
    [3.00, 3.00],
    [3.02, 3.00],    // snaps down
    [3.03, 3.05],    // snaps up
    [4.25, 4.25],
    [5.13, 5.15],
    [10.00, 10.00],
  ])("rounds %p → %p (5c grid)", (raw, expected) => {
    expect(roundToSpyTick(raw)).toBeCloseTo(expected, 6);
  });
});

describe("roundToSpyTick — boundary at $3", () => {
  it("exactly $3 uses the 5c grid (per rule: price ≥ $3)", () => {
    expect(roundToSpyTick(3.00)).toBeCloseTo(3.00, 6);
  });
  it("just under $3 still uses 1c grid", () => {
    expect(roundToSpyTick(2.99)).toBeCloseTo(2.99, 6);
  });
  it("just over $3 uses 5c grid", () => {
    expect(roundToSpyTick(3.02)).toBeCloseTo(3.00, 6);
  });
});
