/** Timeframe aggregation utilities for multi-timeframe chart display.
 *
 * The model always generates predictions on 5-min bars. These utilities
 * aggregate context candles and subsample forecast data to present
 * the chart at the user's selected timeframe.
 */

import type { CandleData, PredictionResponse } from "./types";

export type Timeframe = "5m" | "15m" | "30m" | "1h";

/** Number of 5-min bars per timeframe bar */
export const TIMEFRAME_FACTORS: Record<Timeframe, number> = {
  "5m": 1,
  "15m": 3,
  "30m": 6,
  "1h": 12,
};

export const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1H" },
];

/** Number of aggregated context bars to display */
const DISPLAY_BARS = 24;

/** Aggregate 5-min candles into larger timeframe bars, aligned from the end. */
export function aggregateCandles(candles: CandleData[], factor: number): CandleData[] {
  if (factor <= 1) return candles;

  const result: CandleData[] = [];
  // Align from the end so the last group is complete
  const alignedStart = candles.length % factor;
  for (let i = alignedStart; i < candles.length; i += factor) {
    const group = candles.slice(i, i + factor);
    if (group.length === 0) continue;
    result.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return result;
}

/** Get display-ready context candles for a timeframe. */
export function getContextCandles(
  rawCandles: CandleData[],
  timeframe: Timeframe,
): CandleData[] {
  const factor = TIMEFRAME_FACTORS[timeframe];
  const needed = DISPLAY_BARS * factor;
  const sliced = rawCandles.slice(-needed);
  return aggregateCandles(sliced, factor);
}

/**
 * Compute which indices into the forecast arrays to keep for a given timeframe.
 * Horizons are spaced ~3 bars (15min) apart. Subsampling:
 *   5m/15m: all points (stride=1)
 *   30m: every 2nd (stride=2)
 *   1h: every 4th (stride=4)
 */
export function getForecastIndices(horizonsLength: number, timeframe: Timeframe): number[] {
  const factor = TIMEFRAME_FACTORS[timeframe];
  // Horizons are ~3 bars apart, so stride = factor/3 (min 1)
  const stride = Math.max(1, Math.round(factor / 3));
  if (stride <= 1) {
    return Array.from({ length: horizonsLength }, (_, i) => i);
  }

  const indices: number[] = [];
  for (let i = 0; i < horizonsLength; i += stride) {
    indices.push(i);
  }
  // Always include the last index
  const lastIdx = horizonsLength - 1;
  if (indices.length === 0 || indices[indices.length - 1] !== lastIdx) {
    indices.push(lastIdx);
  }
  return indices;
}

/** Subsample forecast data (percentiles, sample_paths, horizons) for a timeframe. */
export function subsampleForecast(
  prediction: PredictionResponse,
  timeframe: Timeframe,
): {
  horizons: number[];
  percentiles: PredictionResponse["percentiles"];
  samplePaths: number[][] | null;
} {
  const indices = getForecastIndices(prediction.horizons.length, timeframe);

  const pick = <T>(arr: T[]) => indices.map((i) => arr[i]);

  return {
    horizons: pick(prediction.horizons),
    percentiles: {
      p10: pick(prediction.percentiles.p10),
      p25: pick(prediction.percentiles.p25),
      p50: pick(prediction.percentiles.p50),
      p75: pick(prediction.percentiles.p75),
      p90: pick(prediction.percentiles.p90),
    },
    samplePaths: prediction.sample_paths?.map((path) => pick(path)) ?? null,
  };
}

/** Context label for the header badge. */
export function getTimeframeLabel(timeframe: Timeframe): string {
  const labels: Record<Timeframe, string> = {
    "5m": "5min bars | 2hr context | 6.5hr forecast",
    "15m": "15min bars | 6hr context | 6.5hr forecast",
    "30m": "30min bars | 12hr context | 6.5hr forecast",
    "1h": "1hr bars | 24hr context | 6.5hr forecast",
  };
  return labels[timeframe];
}
