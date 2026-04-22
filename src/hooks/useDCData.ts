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
    // The Broker Reality panel's whole value is being a freshness
    // signal — `snapshot_at` drives the age-color indicator in the
    // header. Holding a minutes-old cached value while the API is
    // offline makes the safety net silently untrue.
    //
    // Other fields (positions, trades, signals, etc.) rely on the
    // apiOnline pill + the top-of-page offline banner to cue
    // staleness to the operator — those surfaces already exist, so
    // we keep the last-seen values through transient poll blips
    // rather than blanking the dashboard on every hiccup. brokerState
    // is the only field whose own in-panel indicator is the ONLY
    // staleness cue, so it's the only field that has to clear.
    //
    // Subtle case: API online (s !== null) but broker_state fetch
    // returned null (sidecar missing — daemon newly restarted and
    // hasn't written yet). First branch false; second branch `!online`
    // false; previous brokerState retained. Intentional — the
    // BrokerRealityPanel's age-color + stale-tooltip already convey
    // "this snapshot is old" when the sidecar regen is delayed.
    if (bs) {
      setBrokerState(bs);
    } else if (!online) {
      setBrokerState(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return { summary, positions, trades, strategies, signals, risk, brokerState, apiOnline, loading };
}
