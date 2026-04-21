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
    // brokerState staleness matters differently from the other fields:
    // the whole Broker Reality panel is a freshness signal (snapshot_at
    // drives the age-color indicator). Holding a minutes-old cached
    // value while the API is offline renders the safety net silently
    // untrue. Clear it when the API drops so the "no snapshot" empty
    // state shows instead of lying with stale data. Positions/trades
    // etc. can tolerate transient blips — blanking the dashboard on
    // every poll hiccup would be worse UX.
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
