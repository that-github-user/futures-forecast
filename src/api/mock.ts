/** Mock prediction data for demo/offline mode.
 *
 * Used when VITE_DEMO_MODE=true or when the API is unreachable.
 * Generates realistic-looking data that updates every 5 minutes.
 */

import type { DailySummary, HindcastResponse, HistoryResponse, PredictionResponse } from "./types";
import type {
  MarkupAlert,
  MarkupBandStrike,
  MarkupReviewAlert,
  MarkupReviewResponse,
  MarkupState,
  ProgramFlowEvent,
  StraddleChainResponse,
  StraddleStrikeRow,
  TerminalIntradayBar,
} from "./terminalTypes";

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

/** Shared candle seed — ensures hindcast and prediction use the same price walk. */
function getCandleSeed(): number {
  const now = new Date();
  const minuteSlot = Math.floor((now.getHours() * 60 + now.getMinutes()) / 5);
  return minuteSlot * 1337 + now.getDate() * 7;
}

interface MockCandle { time: number; open: number; high: number; low: number; close: number; volume: number; }

/** Generate 288 five-minute candles using the shared seed. */
function generateCandles(): MockCandle[] {
  const rand = seededRandom(getCandleSeed());
  const now = new Date();
  const baseTime = Math.floor(now.getTime() / 1000) - 288 * 300;
  const candles: MockCandle[] = [];
  let price = BASE_PRICE + (rand() - 0.5) * 80;
  for (let i = 0; i < 288; i++) {
    const ret = (rand() - 0.5) * 4;
    const open = round(price);
    const close = round(price + ret);
    const high = round(Math.max(open, close) + rand() * 3);
    const low = round(Math.min(open, close) - rand() * 3);
    const volume = Math.floor(5000 + rand() * 30000);
    candles.push({ time: baseTime + i * 300, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

export function generateMockPrediction(): PredictionResponse {
  const now = new Date();
  const contextCandles = generateCandles();
  const lastClose = contextCandles[contextCandles.length - 1].close;

  // Use same seed for forecast portion (advanced past the candle generation)
  const rand = seededRandom(getCandleSeed());
  // Advance rand past the candle generation (1 for initial price + 4 per candle: ret, high, low, volume)
  for (let i = 0; i < 288 * 4 + 1; i++) rand();

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

  const regimeLabels = ["trending", "mean-reverting", "volatile", "quiet"] as const;

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
      // Analytics engine fields (nested in signal to match server)
      regime: regimeLabels[Math.floor(rand() * 4)],
      exhaustion_score: +(0.3 + rand() * 2.2).toFixed(2),
      ensemble_agreement: +(0.3 + rand() * 0.7).toFixed(2),
      signal_strength_percentile: Math.floor(rand() * 100),
      invalidation: {
        price_level: round(
          isLong ? lastClose - (4 + rand() * 8) : lastClose + (4 + rand() * 8),
        ),
        price_direction: isLong ? "below" : isShort ? "above" : "either",
        description: isLong
          ? "Close below support invalidates bullish thesis"
          : isShort
            ? "Close above resistance invalidates bearish thesis"
            : "Breakout from range invalidates neutral stance",
        ensemble_contradiction: +(rand() * 0.4).toFixed(4),
      },
    },
    context_candles: contextCandles,
    // Analytics engine fields
    exhaustion_score: +(0.3 + rand() * 2.2).toFixed(2),
    regime: {
      label: regimeLabels[Math.floor(rand() * 4)],
      confidence: +(0.5 + rand() * 0.5).toFixed(2),
    },
    ensemble_agreement: +(0.3 + rand() * 0.7).toFixed(2),
    signal_percentile: Math.floor(rand() * 100),
    invalidation: {
      price_level: round(
        isLong ? lastClose - (4 + rand() * 8) : lastClose + (4 + rand() * 8),
      ),
      price_direction: isLong ? "below" : isShort ? "above" : "either",
      description: isLong
        ? "Close below support invalidates bullish thesis"
        : isShort
          ? "Close above resistance invalidates bearish thesis"
          : "Breakout from range invalidates neutral stance",
      ensemble_contradiction: +(rand() * 0.4).toFixed(4),
    },
    regime_performance: {
      win_rate: +(0.4 + rand() * 0.25).toFixed(2),
      profit_factor: +(0.8 + rand() * 1.2).toFixed(2),
      n_trades: Math.floor(30 + rand() * 150),
    },
  };
}

export function generateMockHindcast(n = 6): HindcastResponse {
  const now = new Date();
  const rand = seededRandom(77);
  const predictions = [];

  // Use the SAME candle series as the prediction so prices align
  const candles = generateCandles();

  for (let i = n; i >= 1; i--) {
    const predTime = now.getTime() - i * 1_800_000; // 30 min apart
    const barsElapsed = i * 6;

    // Anchor to actual candle close at prediction time
    const predTs = predTime / 1000;
    let anchorBar = 0;
    for (let ci = candles.length - 1; ci >= 0; ci--) {
      if (candles[ci].time <= predTs) { anchorBar = ci; break; }
    }
    const price = candles[anchorBar].close;
    const drift = (rand() - 0.45) * 0.12;

    const horizons = [...Array.from({ length: 26 }, (_, j) => 1 + j * 3), 78]
      .filter((v, j, a) => a.indexOf(v) === j)
      .sort((a, b) => a - b);

    const percentiles: PredictionResponse["percentiles"] = {
      p10: [], p25: [], p50: [], p75: [], p90: [],
    };
    for (const h of horizons) {
      const spread = Math.sqrt(h) * 2.5;
      const mid = price + drift * h * 0.3;
      percentiles.p10.push(round(mid - spread * 1.3));
      percentiles.p25.push(round(mid - spread * 0.7));
      percentiles.p50.push(round(mid));
      percentiles.p75.push(round(mid + spread * 0.7));
      percentiles.p90.push(round(mid + spread * 1.3));
    }

    // Sample paths
    const samplePaths: number[][] = [];
    for (let s = 0; s < 30; s++) {
      const path: number[] = [];
      for (let hi = 0; hi < horizons.length; hi++) {
        const spread = Math.sqrt(horizons[hi]) * 2.5;
        const step = (rand() - 0.5) * spread * 0.8 + drift * horizons[hi] * 0.3;
        path.push(round(price + step));
      }
      samplePaths.push(path);
    }

    // Realized prices: use actual candle closes from the shared price walk
    const realizedPrices: (number | null)[] = horizons.map((h) => {
      if (h <= barsElapsed) {
        const realBar = anchorBar + h;
        if (realBar >= 0 && realBar < candles.length) {
          return candles[realBar].close;
        }
        // Fallback if beyond candle range
        return round(price + drift * h * 0.3 + (rand() - 0.5) * 4);
      }
      return null;
    });

    // Scoring for predictions with enough realized data
    const nRealized = realizedPrices.filter((v) => v != null).length;
    const dirLabels = ["LONG", "SHORT", "NEUTRAL"] as const;
    const sigDir = dirLabels[Math.floor(rand() * 3)];
    const dirCorrect = rand() > 0.4;
    const coverageOuter = +(0.5 + rand() * 0.4).toFixed(4);
    const coverageInner = +(0.3 + rand() * 0.3).toFixed(4);
    const trackDur = Math.floor(3 + rand() * 10);
    const verdict = coverageOuter >= 0.7 && dirCorrect ? "PASS" as const
      : coverageOuter >= 0.5 || dirCorrect ? "PARTIAL" as const : "FAIL" as const;

    // Compute top-10 best paths by RMSE against realized prices
    const pathScores = samplePaths.map((path, idx) => {
      let sumSq = 0;
      let count = 0;
      for (let hi = 0; hi < horizons.length; hi++) {
        const rp = realizedPrices[hi];
        if (rp != null) {
          sumSq += (path[hi] - (rp as number)) ** 2;
          count++;
        }
      }
      return { idx, rmse: count > 0 ? Math.sqrt(sumSq / count) : Infinity };
    }).sort((a, b) => a.rmse - b.rmse).slice(0, 10);

    const bestPathsList = pathScores.map(({ idx, rmse }) => ({
      path_index: idx,
      path_values: samplePaths[idx],
      rmse_pts: +rmse.toFixed(2),
      tracking_duration_bars: trackDur,
      tracking_threshold_pts: 2.0,
      deviations: realizedPrices
        .filter((v): v is number => v != null)
        .map(() => +((rand() - 0.5) * 3).toFixed(2)),
    }));

    predictions.push({
      timestamp: new Date(predTime).toISOString(),
      last_close: round(price),
      horizons,
      percentiles,
      sample_paths: samplePaths,
      realized_prices: realizedPrices,
      bars_elapsed: barsElapsed,
      scoring: nRealized >= 3 ? {
        coverage_p10_p90: coverageOuter,
        coverage_p25_p75: coverageInner,
        direction_correct: dirCorrect,
        median_rmse_pts: +(1 + rand() * 5).toFixed(2),
        best_paths: bestPathsList,
        verdict,
        signal_direction: sigDir,
        expected_return_pts: +((rand() - 0.5) * 8).toFixed(2),
        realized_return_pts: +((rand() - 0.5) * 10).toFixed(2),
      } : null,
    });
  }

  return {
    predictions,
    rolling_accuracy: {
      n_evaluated: predictions.length,
      coverage_p10_p90: 0.78,
      coverage_p25_p75: 0.46,
      direction_hit_rate: 0.58,
      mean_tracking_rmse_pts: 1.9,
    },
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
      realized_returns: null,
      regime: (["trending", "mean-reverting", "volatile", "quiet"] as const)[i % 4],
    });
  }

  return {
    entries,
    live_pf: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : null,
    live_win_rate: total > 0 ? +(wins / total).toFixed(4) : null,
    live_num_trades: total,
    session_stats: {
      n_trades: total,
      n_wins: wins,
      n_losses: total - wins,
      n_flat: 31 - total,
      total_pnl_pts: +(cumPnl * BASE_PRICE).toFixed(2),
      best_trade_pts: +(grossProfit * BASE_PRICE / Math.max(wins, 1)).toFixed(2),
      worst_trade_pts: +(-grossLoss * BASE_PRICE / Math.max(total - wins, 1)).toFixed(2),
      current_streak: wins > total - wins ? 2 : 1,
      streak_type: wins > total - wins ? "W" as const : "L" as const,
      regime_breakdown: {
        trending: { n: 5, wins: 3, pnl_pts: 8.5 },
        "mean-reverting": { n: 4, wins: 2, pnl_pts: -2.0 },
        volatile: { n: 3, wins: 1, pnl_pts: -4.5 },
        quiet: { n: 2, wins: 2, pnl_pts: 6.0 },
      },
    },
  };
}

export function generateMockDailySummaries(): DailySummary[] {
  const rand = seededRandom(99);
  const summaries: DailySummary[] = [];
  const now = new Date();

  // Generate 20 trading days of mock history
  for (let daysAgo = 20; daysAgo >= 1; daysAgo--) {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    // Skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    const nTrades = Math.floor(8 + rand() * 15);
    const winRate = 0.4 + rand() * 0.25;
    const nWins = Math.round(nTrades * winRate);
    const nLosses = nTrades - nWins;
    const totalPnl = +((rand() - 0.4) * 30).toFixed(2);

    summaries.push({
      date: d.toISOString().slice(0, 10),
      n_trades: nTrades,
      n_wins: nWins,
      n_losses: nLosses,
      total_pnl_pts: totalPnl,
      profit_factor: nLosses > 0 ? +(nWins / nLosses).toFixed(2) : null,
      win_rate: +(nWins / nTrades).toFixed(4),
      best_trade_pts: +(2 + rand() * 8).toFixed(2),
      worst_trade_pts: +(-2 - rand() * 6).toFixed(2),
      coverage_p10_p90: +(0.65 + rand() * 0.2).toFixed(4),
      direction_hit_rate: +(0.45 + rand() * 0.2).toFixed(4),
      regime_breakdown: {
        trending: { n: Math.floor(nTrades * 0.3), wins: Math.floor(nWins * 0.35), pnl_pts: +(totalPnl * 0.4).toFixed(2) },
        "mean-reverting": { n: Math.floor(nTrades * 0.3), wins: Math.floor(nWins * 0.25), pnl_pts: +(totalPnl * 0.1).toFixed(2) },
      },
    });
  }

  return summaries;
}

/** Synthetic 0DTE straddle-chain snapshot for the `/straddle` page in
 *  demo mode (or when the terminal API is unreachable).
 *
 *  Mirrors a plausible mid-session SPX state: spot ≈ 5180, ATM straddle
 *  ≈ 22 pts, 40 strikes on a 5pt grid centered on ATM, OI skewed toward
 *  call-side (5200-5220) and put-side (5100-5140). Fresh-flow is signed
 *  so the chart can show opening (positive tint) vs closing (negative
 *  tint) flow per side. The XYLD monthly-roll window appears as an
 *  active windowed event when current ET time sits in 11:30-13:30 —
 *  otherwise it's surfaced in `upcoming`. Two upcoming JHEQX-quarterly
 *  events are seeded so `UpcomingProgramFlow` has content to render. */
export function mockStraddleSnapshot(): StraddleChainResponse {
  const rand = seededRandom(31415);
  const spot = 5180 + (rand() - 0.5) * 4;
  const atmStrike = Math.round(spot / 5) * 5;
  const atmStraddleMid = 22 + (rand() - 0.5) * 2;
  const emUpper = +(spot + atmStraddleMid).toFixed(2);
  const emLower = +(spot - atmStraddleMid).toFixed(2);

  // 40 strikes on a 5pt grid centered on ATM (covers ~±100pts).
  //
  // Distribution is tuned for the single-bar net-OI chart (#314): above
  // spot, calls dominate (net > 0 → blue bars right); below spot, puts
  // dominate (net < 0 → amber bars left). Per-side OI still has a
  // realistic mix of both option types at every strike — net is just
  // the visual representation, the underlying values back the tooltip.
  const strikes: StraddleStrikeRow[] = [];
  for (let i = -20; i < 20; i++) {
    const strike = atmStrike + i * 5;
    const distance = strike - atmStrike;
    // Call OI peaks above spot in the 5200-5220 cluster (large).
    const callPeakFactor = Math.exp(-Math.pow((distance - 25) / 30, 2));
    // Smaller call OI cluster below spot (puts dominate there).
    const callBelow = distance < 0 ? Math.exp(-Math.pow(distance / 60, 2)) * 0.25 : 0;
    const callOi = Math.floor(
      400 + callPeakFactor * 9000 + callBelow * 3000 + rand() * 500,
    );
    // Put OI peaks below spot in the 5100-5140 cluster (large).
    const putPeakFactor = Math.exp(-Math.pow((distance + 50) / 35, 2));
    // Smaller put OI cluster above spot (calls dominate there).
    const putAbove = distance > 0 ? Math.exp(-Math.pow(distance / 60, 2)) * 0.22 : 0;
    const putOi = Math.floor(
      350 + putPeakFactor * 8500 + putAbove * 2800 + rand() * 500,
    );
    // Fresh flow signed: positive (opening) on the side closer to ATM,
    // negative (closing) on the far side — produces a plausible
    // dealers-hedging-up posture. The chart's net-flow glyph fires when
    // |fresh_flow_call - fresh_flow_put| > 50 contracts, so these
    // magnitudes (hundreds-to-thousands) reliably trip the threshold.
    const freshFlowCall = distance > 0 && distance < 30
      ? Math.floor(200 + rand() * 1400)
      : Math.floor(-300 + (rand() - 0.5) * 400);
    const freshFlowPut = distance < 0 && distance > -40
      ? Math.floor(150 + rand() * 1200)
      : Math.floor(-250 + (rand() - 0.5) * 400);
    strikes.push({
      strike,
      call_oi: callOi,
      call_volume: Math.floor(callOi * (0.1 + rand() * 0.4)),
      call_iv: +(0.10 + rand() * 0.08).toFixed(4),
      call_delta: +Math.min(0.95, Math.max(0.05,
        0.5 + (spot - strike) / 60,
      )).toFixed(3),
      call_bid: +Math.max(0.05, atmStraddleMid / 2 - distance * 0.4).toFixed(2),
      call_ask: +Math.max(0.05, atmStraddleMid / 2 - distance * 0.4 + 0.3).toFixed(2),
      fresh_flow_call: freshFlowCall,
      put_oi: putOi,
      put_volume: Math.floor(putOi * (0.1 + rand() * 0.4)),
      put_iv: +(0.11 + rand() * 0.08).toFixed(4),
      put_delta: +Math.max(-0.95, Math.min(-0.05,
        -0.5 + (spot - strike) / 60,
      )).toFixed(3),
      put_bid: +Math.max(0.05, atmStraddleMid / 2 + distance * 0.4).toFixed(2),
      put_ask: +Math.max(0.05, atmStraddleMid / 2 + distance * 0.4 + 0.3).toFixed(2),
      fresh_flow_put: freshFlowPut,
    });
  }

  // Pin candidates — top 5 OI+volume strikes within EM band.
  const withinEm = strikes.filter((s) => s.strike >= emLower && s.strike <= emUpper);
  const sortedByDensity = [...withinEm].sort(
    (a, b) =>
      ((b.call_oi ?? 0) + (b.put_oi ?? 0)) -
      ((a.call_oi ?? 0) + (a.put_oi ?? 0)),
  );
  const topDensity = ((sortedByDensity[0]?.call_oi ?? 0) +
    (sortedByDensity[0]?.put_oi ?? 0)) || 1;
  const pinCandidates = sortedByDensity.slice(0, 5).map((s) => ({
    strike: s.strike,
    density_score: +(
      ((s.call_oi ?? 0) + (s.put_oi ?? 0)) / topDensity
    ).toFixed(3),
    within_em: true,
  }));

  // Program flow: synthesize XYLD active window if current ET time is
  // in the 11:30-13:30 ET roll window; otherwise surface as upcoming.
  const now = new Date();
  const etHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const xyldActive = etHour >= 11 && etHour < 14;
  const todayET = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const xyldEvent: ProgramFlowEvent = {
    name: "xyld_monthly_roll",
    intensity: "windowed",
    window_start: `${todayET}T11:30:00-04:00`,
    window_end: `${todayET}T13:30:00-04:00`,
  };

  // Upcoming events — 2 JHEQX quarterly rolls + 2 future XYLD rolls.
  const futureDays = (offset: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  };
  const upcoming: ProgramFlowEvent[] = [
    {
      name: "jheqx_quarterly_roll",
      intensity: "windowed",
      window_start: `${futureDays(4)}T09:30:00-04:00`,
      window_end: `${futureDays(4)}T16:00:00-04:00`,
    },
    {
      name: "xyld_monthly_roll",
      intensity: "windowed",
      window_start: `${futureDays(11)}T11:30:00-04:00`,
      window_end: `${futureDays(11)}T13:30:00-04:00`,
    },
    {
      name: "jheqx_quarterly_roll",
      intensity: "windowed",
      window_start: `${futureDays(13)}T09:30:00-04:00`,
      window_end: `${futureDays(13)}T16:00:00-04:00`,
    },
  ];
  if (!xyldActive) {
    upcoming.unshift(xyldEvent);
  }

  const sessionOpenSpot = spot - 6;
  const realizedRangePts = 12 + rand() * 6;
  const realizedVsImpliedPct = +((realizedRangePts / atmStraddleMid) * 100).toFixed(1);

  return {
    snapshot_time: now.toISOString(),
    expiry: todayET.replace(/-/g, ""),
    spot: +spot.toFixed(2),
    atm_strike: atmStrike,
    atm_straddle_mid: +atmStraddleMid.toFixed(2),
    em_upper: emUpper,
    em_lower: emLower,
    session_open_spot: +sessionOpenSpot.toFixed(2),
    session_open_straddle: +(atmStraddleMid + 1).toFixed(2),
    realized_range_pts: +realizedRangePts.toFixed(2),
    realized_vs_implied_pct: realizedVsImpliedPct,
    strikes,
    pin_candidates: pinCandidates,
    program_flow: {
      active_windowed: xyldActive ? [xyldEvent] : [],
      active_continuous: [
        {
          name: "jepi_continuous",
          intensity: "continuous",
          window_start: `${todayET}T09:30:00-04:00`,
          window_end: `${todayET}T16:00:00-04:00`,
        },
      ],
      upcoming,
    },
    stale: false,
    data_age_seconds: 30,
    preview_mode: false,
  };
}

/** Synthetic live markup state for demo mode. The ATM call shows a
 *  market-maker markup blowout (a ~60s bid/ask series that's tight for
 *  ~48s then the ask runs away from the bid) plus a matching UP alert;
 *  the other band strikes stay calm. Exercises the alert feed + the
 *  gradient sparkline fanning open. Time-anchored to now so the panel
 *  reads fresh (stale=false). */
export function mockMarkupState(): MarkupState {
  const rand = seededRandom(31415);
  const now = Date.now();
  const isoAt = (secsAgo: number) =>
    new Date(now - secsAgo * 1000).toISOString().replace("Z", "-04:00");
  const atm = 7515;
  // The demo markup fires ~35s ago — consistent across the call gradient,
  // the alert marker, and the spot rise so the panels tell one story.
  const MARKUP_AGO = 35;
  // 120 gradient samples (~1s cadence) to match the live 2-min window.
  const calm = (base: number): [string, number, number][] =>
    Array.from({ length: 120 }, (_, i) => {
      const b = base + (rand() - 0.5) * 0.1;
      return [isoAt(120 - i), +b.toFixed(2), +(b + (i % 2 ? 0.2 : 0.1)).toFixed(2)];
    });
  // ATM call: calm, then the ask-runaway starting ~35s ago (the validated
  // 7515C shape) — ramps up over ~12s then holds elevated.
  const callSeries: [string, number, number][] = [];
  for (let i = 0; i < 120; i++) {
    const secsAgo = 120 - i;
    let bid = 14.7 + (rand() - 0.5) * 0.1;
    let ask = bid + (i % 2 ? 0.2 : 0.1);
    if (secsAgo <= MARKUP_AGO) {
      const k = MARKUP_AGO - secsAgo; // 0 at the blowout start
      bid = 15.0 + Math.min(k, 12) * 0.4;
      ask = bid + Math.min(0.4 + k * 0.6, 6.8);
    }
    callSeries.push([isoAt(secsAgo), +bid.toFixed(2), +ask.toFixed(2)]);
  }
  const last = (s: [string, number, number][]) => s[s.length - 1];
  const entry = (
    strike: number, side: "call" | "put", s: [string, number, number][],
  ): MarkupBandStrike => ({
    strike, side, bid: last(s)[1], ask: last(s)[2],
    spread: +(last(s)[2] - last(s)[1]).toFixed(2), baseline_spread: 0.15, series: s,
  });
  const band: MarkupBandStrike[] = [];
  for (let off = -2; off <= 2; off++) {
    const strike = atm + off * 5;
    band.push(entry(strike, "call", off === 0 ? callSeries : calm(14 - off)));
    band.push(entry(strike, "put", calm(16 + off)));
  }
  const recent_alerts: MarkupAlert[] = [
    {
      // fires ~2s into the blowout (≈33s ago) → the marker lands at the
      // FOOT of the spot rise below.
      ts: isoAt(MARKUP_AGO - 2), strike: atm, side: "call", direction: "up",
      spread: 2.2, baseline_spread: 0.15, spread_z: 27.6, ask_jump: 2.5,
    },
  ];
  const todayET = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
  // SPX spot: 25 samples over 120s (5s cadence), newest at now. Flat near
  // 7519 until the markup, then climbs — so the alert marker sits at the
  // foot of the rise and spot visibly moves to its RIGHT (after the σ shift).
  const spot_series: [string, number][] = [];
  for (let k = 0; k <= 24; k++) {
    const secsAgo = 120 - k * 5; // 120 → 0
    const rise = secsAgo < MARKUP_AGO ? (MARKUP_AGO - secsAgo) * 0.42 : 0;
    spot_series.push([isoAt(secsAgo), +(7519 + (rand() - 0.5) * 0.3 + rise).toFixed(2)]);
  }
  return {
    session_date: todayET, active_expiry: todayET, center_atm: atm,
    updated_at: isoAt(2), age_seconds: 2, stale: false, band, recent_alerts,
    spot_series,
  };
}

/** Demo fixture for the Markup Review pane: one synthetic RTH session of SPX
 *  1-min candles + a handful of alerts with MFE/MAE outcomes. Deterministic
 *  per date so the demo is stable. */
export function mockMarkupReview(date: string): MarkupReviewResponse {
  const rand = seededRandom(
    Number(date.replace(/[^0-9]/g, "").slice(-6)) || 424242,
  );
  // 390 1-min RTH bars (09:30–16:00 ET) as a UTC day; random walk around 7530.
  const startUtcMs = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    13,
    30,
  ); // 09:30 ET ≈ 13:30Z
  const bars: TerminalIntradayBar[] = [];
  let px = 7530;
  for (let i = 0; i < 390; i++) {
    const drift = (rand() - 0.5) * 1.6;
    const o = px;
    const c = o + drift;
    const h = Math.max(o, c) + rand() * 0.6;
    const l = Math.min(o, c) - rand() * 0.6;
    px = c;
    const t = new Date(startUtcMs + i * 60_000).toISOString().replace(".000Z", "Z");
    bars.push({
      time: t,
      open: round2(o),
      high: round2(h),
      low: round2(l),
      close: round2(c),
      volume: 0,
    });
  }
  const center = 7530;
  const alerts: MarkupReviewAlert[] = [];
  const nAlerts = 9;
  for (let k = 0; k < nAlerts; k++) {
    const barIdx = Math.floor(20 + rand() * 360);
    const bar = bars[barIdx];
    const up = rand() > 0.5;
    const strike = center + Math.round((rand() - 0.5) * 6) * 5;
    const mfe = Math.round(rand() * rand() * 14 * 10) / 10; // skew small
    const mae = -Math.round(rand() * 5 * 10) / 10;
    // Mirror the backend's ET-offset alert_ts (June = EDT, −04:00) for the same
    // instant as the bar, so the demo exercises the real offset format.
    const alertMs = Date.parse(bar.time) + Math.floor(rand() * 50) * 1000;
    const isoEt = new Date(alertMs - 4 * 3600 * 1000)
      .toISOString()
      .replace(".000Z", "-04:00")
      .replace("Z", "-04:00");
    alerts.push({
      alert_ts: isoEt,
      bar_time: bar.time,
      side: up ? "call" : "put",
      direction: up ? "up" : "down",
      status: "finalized",
      strike,
      dist_from_atm: strike - center,
      spread_z: round2(5 + rand() * 35),
      ask_jump: round2(1.2 + rand() * 2),
      spot_at_alert: bar.close,
      realized_move: round2((up ? 1 : 1) * (mfe - 2 - rand() * 4)),
      mfe,
      t_mfe_s: Math.floor(30 + rand() * 270),
      mae,
      t_mae_s: Math.floor(rand() * 60),
    });
  }
  alerts.sort((a, b) => Date.parse(a.alert_ts) - Date.parse(b.alert_ts));
  return {
    session_date: date,
    timeframe: "1m",
    bars,
    alerts,
    pending_count: 0,
    bars_stale: false,
    bars_age_seconds: 12,
    asof: new Date().toISOString().replace(".000Z", "Z"),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
