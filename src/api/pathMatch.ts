/** Best-match path selection for spaghetti forecast visualization.
 *
 * Finds sample paths that most closely track realized prices,
 * then projects their remaining trajectory as the "most likely" outcome.
 */

export interface PathMatch {
  index: number;
  rmse: number;
}

/**
 * Find the top N sample paths closest to realized prices (by RMSE).
 *
 * @param samplePaths - All sample trajectories (30 paths, each with values at horizons)
 * @param realizedPrices - Realized prices at each horizon (null if not yet realized)
 * @param topN - Number of best matches to return (default 3)
 * @returns Sorted array of {index, rmse} for the best-matching paths
 */
export function findBestMatchPaths(
  samplePaths: number[][],
  realizedPrices: (number | null)[],
  topN = 3,
): PathMatch[] {
  // Collect indices where we have realized prices
  const realizedIndices: number[] = [];
  const realizedValues: number[] = [];
  for (let i = 0; i < realizedPrices.length; i++) {
    if (realizedPrices[i] != null) {
      realizedIndices.push(i);
      realizedValues.push(realizedPrices[i] as number);
    }
  }

  // Need at least 3 realized points for meaningful matching
  if (realizedIndices.length < 3) return [];

  // Compute RMSE for each sample path
  const scores: PathMatch[] = samplePaths.map((path, idx) => {
    let sumSqErr = 0;
    for (let i = 0; i < realizedIndices.length; i++) {
      const hi = realizedIndices[i];
      if (hi < path.length) {
        const err = path[hi] - realizedValues[i];
        sumSqErr += err * err;
      }
    }
    const rmse = Math.sqrt(sumSqErr / realizedIndices.length);
    return { index: idx, rmse };
  });

  // Sort by RMSE ascending, take top N
  scores.sort((a, b) => a.rmse - b.rmse);
  return scores.slice(0, Math.min(topN, scores.length));
}
