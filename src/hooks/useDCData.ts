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

  const fetchAll = useCallback(async () => {
    const [s, p, t, st, sig, r, bs] = await Promise.all([
      dcApi.summary(),
      dcApi.positions(),
      dcApi.trades(100),
      dcApi.strategies(),
      dcApi.signals(),
      dcApi.risk(),
      dcApi.brokerState(),
    ]);

    const online = s !== null;
    setApiOnline(online);
    if (s) setSummary(s);
    if (p) setPositions(p);
    if (t) setTrades(t);
    if (st) setStrategies(st);
    if (sig) setSignals(sig);
    if (r) setRisk(r);
    // brokerState staleness matters differently from the other fields.
    // See `brokerStateDecision` above for the three-way contract.
    // Other fields (positions, trades, signals, etc.) rely on the
    // apiOnline pill + the top-of-page offline banner to cue
    // staleness; brokerState's freshness is the whole point of its
    // panel, so it's the only one that has to clear when API drops.
    const decision = brokerStateDecision(bs, online);
    if (decision === "update") {
      setBrokerState(bs);
    } else if (decision === "clear") {
      setBrokerState(null);
    }
    // "retain" — no-op; previous value kept
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return { summary, positions, trades, strategies, signals, risk, brokerState, apiOnline, loading };
}
