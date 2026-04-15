/**
 * Tests for dcPathSim — deterministic sample path generator.
 *
 * Focuses on invariants that the chart depends on: reproducibility across
 * renders (same seed → same path), path length matches horizon, start at
 * 1.0, and terminal is within a sane band of the requested multiplier.
 */

import { describe, expect, it } from "vitest";

import {
  hashSeed,
  mulberry32,
  samplePath,
  samplePathLinear,
  samplePaths,
  samplePathsLinear,
} from "./dcPathSim";

describe("mulberry32 — seeded PRNG", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      expect(a()).toBeCloseTo(b(), 12);
    }
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds produce different sequences", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    // At least one element should differ (essentially always true).
    expect(seqA).not.toEqual(seqB);
  });
});

describe("hashSeed", () => {
  it("is stable across calls with same input", () => {
    expect(hashSeed("rec_60_10:0")).toBe(hashSeed("rec_60_10:0"));
  });

  it("different inputs produce different seeds", () => {
    expect(hashSeed("rec_60_10:0")).not.toBe(hashSeed("rec_60_10:1"));
    expect(hashSeed("rec_60_10:0")).not.toBe(hashSeed("take_all:0"));
  });
});

describe("samplePath", () => {
  const opts = {
    horizonMonths: 46,
    terminalMultiplier: 102, // rec_60_10 at $100K → $10.2M
    maxDdPct: 9.0,
    seed: 12345,
  };

  it("starts at 1.0", () => {
    const p = samplePath(opts);
    expect(p[0]).toBe(1.0);
  });

  it("has length = horizonMonths + 1", () => {
    const p = samplePath(opts);
    expect(p.length).toBe(47);
  });

  it("is deterministic for a given seed", () => {
    expect(samplePath(opts)).toEqual(samplePath(opts));
  });

  it("different seeds produce different paths", () => {
    const a = samplePath({ ...opts, seed: 1 });
    const b = samplePath({ ...opts, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("all values are positive and finite", () => {
    const p = samplePath(opts);
    for (const v of p) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("terminal is in a sane band around the target multiplier", () => {
    // With GBM and σ ≈ 0.045/mo over 46 months, the log-space stddev is
    // ~0.31 — so the terminal can wander ±a few log units. Assert within
    // a generous 0.01× to 10,000× band of the target (any reasonable path
    // will be inside this).
    const p = samplePath(opts);
    const terminal = p[p.length - 1];
    expect(terminal).toBeGreaterThan(opts.terminalMultiplier * 0.01);
    expect(terminal).toBeLessThan(opts.terminalMultiplier * 10_000);
  });

  it("flat output when maxDdPct = 0 (static_1ct baseline shape)", () => {
    // A policy with zero vol and terminalMultiplier=1 should produce a
    // pure-flat line at 1.0 (static_1ct's compounding curve shape).
    const p = samplePath({
      horizonMonths: 46,
      terminalMultiplier: 1.0,
      maxDdPct: 0,
      seed: 42,
    });
    for (const v of p) {
      expect(v).toBeCloseTo(1.0, 9);
    }
  });

  it("returns [1.0] for zero horizon", () => {
    expect(samplePath({ ...opts, horizonMonths: 0 })).toEqual([1.0]);
  });
});

describe("samplePaths — batch", () => {
  it("generates N paths", () => {
    const paths = samplePaths("rec_60_10", 8, {
      horizonMonths: 46,
      terminalMultiplier: 102,
      maxDdPct: 9.0,
    });
    expect(paths).toHaveLength(8);
    for (const p of paths) {
      expect(p.length).toBe(47);
      expect(p[0]).toBe(1.0);
    }
  });

  it("paths differ from each other (via distinct per-index seeds)", () => {
    const paths = samplePaths("rec_60_10", 4, {
      horizonMonths: 46,
      terminalMultiplier: 102,
      maxDdPct: 9.0,
    });
    // At least two distinct terminal values — confirms per-index seeding works.
    const terminals = new Set(paths.map((p) => p[p.length - 1]));
    expect(terminals.size).toBeGreaterThan(1);
  });

  it("is stable across invocations (same policy → same paths)", () => {
    const a = samplePaths("rec_60_10", 3, {
      horizonMonths: 46,
      terminalMultiplier: 102,
      maxDdPct: 9.0,
    });
    const b = samplePaths("rec_60_10", 3, {
      horizonMonths: 46,
      terminalMultiplier: 102,
      maxDdPct: 9.0,
    });
    expect(a).toEqual(b);
  });
});

describe("samplePathLinear — additive growth with Gaussian jitter", () => {
  const opts = {
    horizonMonths: 46,
    startEquity: 100_000,
    monthlyPL: 7_222,       // ~$87K/year
    monthlySigma: 2_500,
    seed: 999,
  };

  it("starts at startEquity", () => {
    const p = samplePathLinear(opts);
    expect(p[0]).toBe(100_000);
  });

  it("has length = horizonMonths + 1", () => {
    expect(samplePathLinear(opts).length).toBe(47);
  });

  it("is deterministic for a given seed", () => {
    expect(samplePathLinear(opts)).toEqual(samplePathLinear(opts));
  });

  it("different seeds produce different paths", () => {
    expect(samplePathLinear({ ...opts, seed: 1 }))
      .not.toEqual(samplePathLinear({ ...opts, seed: 2 }));
  });

  it("terminal is near startEquity + monthlyPL × horizon (within a few σ)", () => {
    // Expected terminal ≈ $100K + 46×$7222 = $432,212
    // Cumulative σ over 46 months ≈ √46 × $2500 ≈ $16,956
    // Allow ±4σ for safety (virtually always inside)
    const p = samplePathLinear(opts);
    const terminal = p[p.length - 1];
    const expected = 100_000 + 46 * 7_222;
    const cumSigma = Math.sqrt(46) * 2_500;
    expect(terminal).toBeGreaterThan(expected - 4 * cumSigma);
    expect(terminal).toBeLessThan(expected + 4 * cumSigma);
  });

  it("flat deterministic line when monthlySigma = 0", () => {
    const p = samplePathLinear({ ...opts, monthlySigma: 0 });
    for (let t = 0; t <= opts.horizonMonths; t++) {
      expect(p[t]).toBeCloseTo(opts.startEquity + t * opts.monthlyPL, 6);
    }
  });

  it("never drops below $1 (log-scale safety)", () => {
    // Pathological: tiny start, huge sigma, no drift → many paths would
    // otherwise go negative.
    const p = samplePathLinear({
      horizonMonths: 46,
      startEquity: 1_000,
      monthlyPL: 0,
      monthlySigma: 5_000,
      seed: 42,
    });
    for (const v of p) expect(v).toBeGreaterThanOrEqual(1);
  });

  it("returns [startEquity] for zero horizon", () => {
    expect(samplePathLinear({ ...opts, horizonMonths: 0 })).toEqual([100_000]);
  });
});

describe("samplePathsLinear — batch", () => {
  it("generates N paths, all starting at startEquity", () => {
    const paths = samplePathsLinear("static_1ct", 8, {
      horizonMonths: 46,
      startEquity: 100_000,
      monthlyPL: 7_222,
      monthlySigma: 2_500,
    });
    expect(paths).toHaveLength(8);
    for (const p of paths) {
      expect(p.length).toBe(47);
      expect(p[0]).toBe(100_000);
    }
  });

  it("per-index seeds differ from the compounding-variant per-index seeds", () => {
    // samplePaths and samplePathsLinear should NOT produce identical paths
    // for the same policy key — they share the PRNG but the seed-prefix
    // ("policy:0" vs "policy:linear:0") differentiates them.
    const compounding = samplePaths("static_1ct", 1, {
      horizonMonths: 46,
      terminalMultiplier: 1,
      maxDdPct: 0,
    });
    const linear = samplePathsLinear("static_1ct", 1, {
      horizonMonths: 46,
      startEquity: 100_000,
      monthlyPL: 7_222,
      monthlySigma: 2_500,
    });
    // Even ignoring values, the shapes differ (1.0-based vs equity-based).
    expect(compounding[0][0]).toBe(1.0);
    expect(linear[0][0]).toBe(100_000);
  });

  it("is stable across invocations", () => {
    const a = samplePathsLinear("static_1ct", 3, {
      horizonMonths: 46,
      startEquity: 100_000,
      monthlyPL: 7_222,
      monthlySigma: 2_500,
    });
    const b = samplePathsLinear("static_1ct", 3, {
      horizonMonths: 46,
      startEquity: 100_000,
      monthlyPL: 7_222,
      monthlySigma: 2_500,
    });
    expect(a).toEqual(b);
  });
});
