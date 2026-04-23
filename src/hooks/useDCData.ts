import { useCallback, useEffect, useState } from "react";
import { dcApi } from "../api/dcClient";
import type {
  DCBrokerState,
  DCPosition,
  DCRiskStatus,
  DCSignalsResponse,
  DCStrategyStats,
  DCSummary,
  DCTrade,
} from "../api/dcTypes";

/** Three-way decision for what to do with brokerState after each
 *  poll. Extracted as a pure function so the staleness-clear contract
 *  (the whole point of the Broker Reality panel's freshness promise)
 *  can be tested without mounting React.
 *
 *  - "update" — fresh payload arrived; swap it in.
 *  - "clear"  — API went offline; cached brokerState is load-bearingly
 *               misleading (its snapshot_at drives the age-color
 *               indicator), so wipe it rather than silently lie.
 *  - "retain" — API is online but THIS endpoint returned null (sidecar
 *               being regenerated). Keep the last-seen value; the
 *               panel's own age-color will shade toward red as the
 *               snapshot ages, cueing staleness without blanking.
 */
export type BrokerStateDecision = "update" | "clear" | "retain";

export function brokerStateDecision(
  fetched: DCBrokerState | null,
  apiOnline: boolean,
): BrokerStateDecision {
  if (fetched) return "update";
  if (!apiOnline) return "clear";
  return "retain";
}

interface DCData {
  summary: DCSummary | null;
  positions: DCPosition[];
  trades: DCTrade[];
  strategies: DCStrategyStats[];
  signals: DCSignalsResponse | null;
  risk: DCRiskStatus | null;
  brokerState: DCBrokerState | null;
  apiOnline: boolean;
  loading: boolean;
}

// Cadence tiers:
//   Fast — summary / positions / signals / risk / brokerState
//     These drive the System Health strip (brokerState age, IV source,
//     drift) and the live Signals-tab countdowns. Stale by more than a
//     tick is a visible problem; polling at 30s matches the sidecar
//     write cadence and the SL-worker's 2min poll.
//   Slow — trades / strategies
//     Trades only change when a position closes (a few times per day).
//     Per-strategy stats likewise. Polling at 30s was bandwidth + CPU
//     for no information-gain on most ticks. 5min cadence picks up a
//     close within that window and slashes the trades payload
//     (100 rows × ~15 fields) from 120 requests/hour to 12/hour.
const FAST_INTERVAL_MS = 30_000;
const SLOW_INTERVAL_MS = 5 * 60_000;

/** Narrow a PromiseSettledResult<T | null> to its value (null on reject
 *  or on the dcGet-returned null). dcGet already swallows fetch errors
 *  to null so today every result is 'fulfilled'; this helper keeps the
 *  hook working if a future dcClient variant throws instead. */
function pickSettled<T>(r: PromiseSettledResult<T | null>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

export function useDCData(): DCData {
  const [summary, setSummary] = useState<DCSummary | null>(null);
  const [positions, setPositions] = useState<DCPosition[]>([]);
  const [trades, setTrades] = useState<DCTrade[]>([]);
  const [strategies, setStrategies] = useState<DCStrategyStats[]>([]);
  const [signals, setSignals] = useState<DCSignalsResponse | null>(null);
  const [risk, setRisk] = useState<DCRiskStatus | null>(null);
  const [brokerState, setBrokerState] = useState<DCBrokerState | null>(null);
  const [apiOnline, setApiOnline] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fast tier. Promise.allSettled so a slow or failing endpoint can't
  // block the others — today dcGet already swallows errors to null, so
  // this is future-proofing for a dcClient variant that throws.
  const fetchFast = useCallback(async () => {
    const results = await Promise.allSettled([
      dcApi.summary(),       // [0]
      dcApi.positions(),     // [1]
      dcApi.signals(),       // [2]
      dcApi.risk(),          // [3]
      dcApi.brokerState(),   // [4]
    ]);
    const s = pickSettled(results[0] as PromiseSettledResult<DCSummary | null>);
    const p = pickSettled(results[1] as PromiseSettledResult<DCPosition[] | null>);
    const sig = pickSettled(results[2] as PromiseSettledResult<DCSignalsResponse | null>);
    const r = pickSettled(results[3] as PromiseSettledResult<DCRiskStatus | null>);
    const bs = pickSettled(results[4] as PromiseSettledResult<DCBrokerState | null>);

    const online = s !== null;
    setApiOnline(online);
    if (s) setSummary(s);
    if (p) setPositions(p);
    if (sig) setSignals(sig);
    if (r) setRisk(r);
    // brokerState staleness matters differently from the other fields.
    // See `brokerStateDecision` above for the three-way contract.
    // Other fields (positions, signals, etc.) rely on the apiOnline
    // pill + the top-of-page offline banner to cue staleness;
    // brokerState's freshness is the whole point of its panel, so
    // it's the only one that has to clear when API drops.
    const decision = brokerStateDecision(bs, online);
    if (decision === "update") {
      setBrokerState(bs);
    } else if (decision === "clear") {
      setBrokerState(null);
    }
    // "retain" — no-op; previous value kept.
    // Flip loading off as soon as fast tier returns — the slow tier
    // can arrive later without blocking the initial render.
    setLoading(false);
  }, []);

  // Slow tier. Independent timer from fast tier so a trades(100) round
  // trip doesn't delay the next summary/signals/brokerState refresh.
  const fetchSlow = useCallback(async () => {
    const results = await Promise.allSettled([
      dcApi.trades(100),   // [0]
      dcApi.strategies(),  // [1]
    ]);
    const t = pickSettled(results[0] as PromiseSettledResult<DCTrade[] | null>);
    const st = pickSettled(results[1] as PromiseSettledResult<DCStrategyStats[] | null>);
    if (t) setTrades(t);
    if (st) setStrategies(st);
  }, []);

  useEffect(() => {
    // Seed both tiers on mount. The fast tier's setLoading(false)
    // flips the dashboard out of its spinner as soon as those five
    // return; trades + strategies can keep loading in the background.
    fetchFast();
    fetchSlow();
    const fastId = setInterval(fetchFast, FAST_INTERVAL_MS);
    const slowId = setInterval(fetchSlow, SLOW_INTERVAL_MS);
    return () => {
      clearInterval(fastId);
      clearInterval(slowId);
    };
  }, [fetchFast, fetchSlow]);

  return { summary, positions, trades, strategies, signals, risk, brokerState, apiOnline, loading };
}
