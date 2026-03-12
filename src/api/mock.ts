/** Mock prediction data for demo/offline mode.
 *
 * Used when VITE_DEMO_MODE=true or when the API is unreachable.
 * Generates realistic-looking data that updates every 5 minutes.
 */

import type { HistoryResponse, PredictionResponse } from "./types";

const BASE_PRICE = 5850;
const TICK = 0.25;

function round(v: number): number {
  return Math.round(v / TICK) * TICK;
}

/** Seeded pseudo-random for deterministic demo. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export function generateMockPrediction(): PredictionResponse {
  // Use minute-of-day as seed so it changes every 5 minutes but is stable within
  const now = new Date();
  const minuteSlot = Math.floor(
    (now.getHours() * 60 + now.getMinutes()) / 5,
  );
  const rand = seededRandom(minuteSlot * 1337 + now.getDate() * 7);

  // Random walk for context candles (24 hours = 288 five-min bars)
  const contextCandles = [];
  let price = BASE_PRICE + (rand() - 0.5) * 80;
  const baseTime = Math.floor(now.getTime() / 1000) - 288 * 300;

  for (let i = 0; i < 288; i++) {
    const ret = (rand() - 0.5) * 4;
    const open = round(price);
    const close = round(price + ret);
    const high = round(Math.max(open, close) + rand() * 3);
    const low = round(Math.min(open, close) - rand() * 3);
    const volume = Math.floor(5000 + rand() * 30000);
    contextCandles.push({
      time: baseTime + i * 300,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }

  const lastClose = price;

  // Forecast: slight drift + expanding uncertainty
  const drift = (rand() - 0.45) * 0.15; // slight long bias
  // Dense horizons matching server: every 3 bars + endpoint
  const horizons = [...Array.from({ length: 26 }, (_, i) => 1 + i * 3), 78]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);
  const percentiles: PredictionResponse["percentiles"] = {
    p10: [],
    p25: [],
    p50: [],
    p75: [],
    p90: [],
  };

  for (const h of horizons) {
    const spread = Math.sqrt(h) * 2.5;
    const mid = lastClose + drift * h * 0.3;
    percentiles.p10.push(round(mid - spread * 1.3));
    percentiles.p25.push(round(mid - spread * 0.7));
    percentiles.p50.push(round(mid));
    percentiles.p75.push(round(mid + spread * 0.7));
    percentiles.p90.push(round(mid + spread * 1.3));
  }

  // Generate sample paths (30 trajectories)
  const samplePaths: number[][] = [];
  for (let s = 0; s < 30; s++) {
    const path: number[] = [];
    let p = lastClose;
    for (let hi = 0; hi < horizons.length; hi++) {
      const spread = Math.sqrt(horizons[hi]) * 2.5;
      const step = (rand() - 0.5) * spread * 0.8 + drift * horizons[hi] * 0.3;
      p = lastClose + step;
      path.push(round(p));
    }
    samplePaths.push(path);
  }

  const expectedReturn = drift * 0.001;
  const isLong = drift > 0.02;
  const isShort = drift < -0.05;
  const compositeScore = isLong
    ? 0.15 + rand() * 0.4
    : isShort
      ? -(0.15 + rand() * 0.4)
      : (rand() - 0.5) * 0.2;

  return {
    timestamp: now.toISOString(),
    instrument: "ES",
    last_close: lastClose,
    horizons,
    percentiles,
    sample_paths: samplePaths,
    signal: {
      composite_score: +compositeScore.toFixed(4),
      direction: isLong ? "LONG" : isShort ? "SHORT" : "FLAT",
      confidence: +Math.abs(compositeScore).toFixed(4),
      expected_return: +expectedReturn.toFixed(6),
      ensemble_sharpe: +(expectedReturn * 30 + (rand() - 0.5) * 0.3).toFixed(4),
      p10_return: +((drift - 0.08) * 0.01).toFixed(6),
      p90_return: +((drift + 0.08) * 0.01).toFixed(6),
      long_frac: +(0.5 + drift * 2).toFixed(4),
    },
    context_candles: contextCandles,
  };
}

export function generateMockHistory(): HistoryResponse {
  const entries = [];
  const now = Date.now();
  const rand = seededRandom(42);

  let cumPnl = 0;
  let wins = 0;
  let total = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (let i = 30; i >= 0; i--) {
    const ts = new Date(now - i * 300_000).toISOString();
    const score = (rand() - 0.45) * 0.8;
    const dir =
      score > 0.15 ? "LONG" as const : score < -0.15 ? "SHORT" as const : "FLAT" as const;
    const ret = (rand() - 0.48) * 0.004;

    const correct =
      (dir === "LONG" && ret > 0) || (dir === "SHORT" && ret < 0);
    if (dir !== "FLAT") {
      total++;
      const pnl = dir === "LONG" ? ret : -ret;
      cumPnl += pnl;
      if (correct) {
        wins++;
        grossProfit += Math.abs(pnl);
      } else {
        grossLoss += Math.abs(pnl);
      }
    }

    entries.push({
      timestamp: ts,
      instrument: "ES",
      last_close: BASE_PRICE + (rand() - 0.5) * 60,
      signal: {
        composite_score: +score.toFixed(4),
        direction: dir,
        confidence: +Math.abs(score).toFixed(4),
        expected_return: +(score * 0.002).toFixed(6),
        ensemble_sharpe: +(score * 0.8).toFixed(4),
        p10_return: -0.003,
        p90_return: 0.003,
        long_frac: +(0.5 + score).toFixed(4),
      },
      realized_return: i > 0 ? ret : null,
      realized_direction: i > 0 ? (ret > 0 ? "UP" as const : "DOWN" as const) : null,
    });
  }

  return {
    entries,
    live_pf: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : null,
    live_win_rate: total > 0 ? +(wins / total).toFixed(4) : null,
    live_num_trades: total,
  };
}
