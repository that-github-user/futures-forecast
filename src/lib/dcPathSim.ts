/**
 * dcPathSim — deterministic client-side sample-path generator for the
 * Capital tab's compounding projection.
 *
 * The `/capital/summary` endpoint only carries a single median curve (plus
 * a p5/p95 band for rec_60_10). Rendering a smooth exponential median
 * makes the chart look like a deterministic projection — not the noisy
 * equity curve a trader actually experiences. This module synthesizes
 * illustrative sample paths using the policy's documented MaxDD% as the
 * volatility anchor, via Geometric Brownian Motion.
 *
 * DETERMINISTIC + PURE. The same (policyKey, pathIndex, horizon, terminal,
 * maxDdPct) inputs always produce the same path. This means:
 *   - The chart is stable across renders and page reloads.
 *   - No server CPU cost.
 *   - Paths are "illustrative" rather than "sampled" — the subtitle labels
 *     them as such. The p5/p95 bands remain the authoritative variance
 *     story from vega-prime's actual 10K-path Monte Carlo.
 */

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32, well-known good-distribution 32-bit generator.
// https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string-hash → 32-bit seed so policy keys like "rec_60_10:3" map to deterministic PRNGs. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Box-Muller normal sampler — generates N(0, 1) from two uniform draws.
// ---------------------------------------------------------------------------

function standardNormal(rng: () => number): number {
  // Clamp u1 away from 0 to avoid log(0) = -Infinity.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------------------
// Geometric Brownian Motion single-path generator
// ---------------------------------------------------------------------------

export interface SamplePathInput {
  /** Number of months (steps) in the path. Result length = months + 1. */
  horizonMonths: number;
  /** Expected terminal multiplier at month = horizonMonths (e.g. 102 for rec_60_10). */
  terminalMultiplier: number;
  /** Policy's documented historical MaxDD percentage (e.g. 9.0 for rec_60_10). */
  maxDdPct: number;
  /** Deterministic seed — typically `hashSeed(`${policyKey}:${pathIndex}`)`. */
  seed: number;
}

/**
 * Generate one illustrative monthly equity-multiplier path.
 *
 * The path starts at 1.0 and has drift μ chosen so the *mean* path terminal
 * matches `terminalMultiplier`. Volatility σ is heuristically `maxDdPct/200`
 * per month — produces peak-to-trough swings in the MaxDD neighborhood over
 * the horizon without exploding. The GBM step is
 *   S[t+1] = S[t] * exp((μ - σ²/2) + σ * Z[t])
 * with Z[t] ~ N(0,1) sampled from a seeded Box-Muller.
 *
 * Every step is clamped to ≥ 1e-6 so the log-scale chart axis never receives
 * a zero (would otherwise require axis-level guards on the consumer).
 */
export function samplePath({
  horizonMonths,
  terminalMultiplier,
  maxDdPct,
  seed,
}: SamplePathInput): number[] {
  if (horizonMonths <= 0) return [1.0];

  const rng = mulberry32(seed);
  // σ: rough monthly volatility. MaxDD is a worst-observed-path number, so
  // dividing by ~2 gives a reasonable per-step stddev that produces visible
  // drawdowns without spiraling. Floor at a tiny positive value for the
  // static_1ct case (maxDdPct=0) so the path is exactly flat.
  const sigma = Math.max(maxDdPct / 200, 0);
  // μ: drift that lands the *expected* terminal at terminalMultiplier.
  // For a lognormal process, E[S_T] = S_0 * exp(μ*T) when we use the
  // (μ - σ²/2) convention in the exponent below.
  const drift = Math.log(Math.max(terminalMultiplier, 1e-12)) / horizonMonths;

  const path: number[] = new Array(horizonMonths + 1);
  path[0] = 1.0;
  for (let t = 1; t <= horizonMonths; t++) {
    if (sigma === 0) {
      // Degenerate case — static_1ct or zero-vol policy. Pure exponential.
      path[t] = path[t - 1] * Math.exp(drift);
    } else {
      const z = standardNormal(rng);
      const step = Math.exp(drift - 0.5 * sigma * sigma + sigma * z);
      path[t] = Math.max(path[t - 1] * step, 1e-6);
    }
  }
  return path;
}

/**
 * Generate N sample paths for a policy. Each path's seed is derived from
 * `${policyKey}:${pathIndex}` so the set is stable across renders and
 * consistent between any two users viewing the same policy.
 */
export function samplePaths(
  policyKey: string,
  nPaths: number,
  opts: Omit<SamplePathInput, "seed">,
): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < nPaths; i++) {
    out.push(samplePath({ ...opts, seed: hashSeed(`${policyKey}:${i}`) }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Linear-growth sample paths (for non-compounding policies like static_1ct)
// ---------------------------------------------------------------------------

export interface LinearSamplePathInput {
  /** Number of months (steps) in the path. Result length = months + 1. */
  horizonMonths: number;
  /** Starting equity in dollars. */
  startEquity: number;
  /** Expected monthly P/L in dollars (policy.linear_growth.monthly_pl). */
  monthlyPL: number;
  /** Per-month P/L standard deviation in dollars (policy.linear_growth.monthly_sigma). */
  monthlySigma: number;
  /** Deterministic seed. */
  seed: number;
}

/**
 * Generate one linear-growth sample path with Gaussian noise.
 *
 * For non-compounding policies (e.g. static 1-contract sizing), each month
 * adds a draw from N(monthlyPL, monthlySigma²) to equity. There's no
 * multiplicative effect — the median is a straight line and the variance
 * comes from per-month P/L jitter. Returns a path in dollar terms (not
 * multipliers) so the chart axis is unambiguous.
 *
 * Each equity value is floored at $1 so the log-scale yAxis never sees
 * a zero or negative from a deep pathological draw.
 */
export function samplePathLinear({
  horizonMonths,
  startEquity,
  monthlyPL,
  monthlySigma,
  seed,
}: LinearSamplePathInput): number[] {
  if (horizonMonths <= 0) return [startEquity];
  const rng = mulberry32(seed);
  const path: number[] = new Array(horizonMonths + 1);
  path[0] = startEquity;
  for (let t = 1; t <= horizonMonths; t++) {
    const z = monthlySigma > 0 ? standardNormal(rng) : 0;
    const delta = monthlyPL + monthlySigma * z;
    path[t] = Math.max(path[t - 1] + delta, 1);
  }
  return path;
}

/** Batch variant of samplePathLinear. Same stable seeding as `samplePaths`. */
export function samplePathsLinear(
  policyKey: string,
  nPaths: number,
  opts: Omit<LinearSamplePathInput, "seed">,
): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < nPaths; i++) {
    out.push(samplePathLinear({ ...opts, seed: hashSeed(`${policyKey}:linear:${i}`) }));
  }
  return out;
}
