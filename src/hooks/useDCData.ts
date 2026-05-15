import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dcApi } from "../api/dcClient";
import type {
  DCBrokerState,
  DCExitAlert,
  DCPhantomPosition,
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
  // Would-have-entered positions — the daemon's blocked_order rows.
  // Surfaced in the Tent tab's "missed entries" section so operators
  // see plays they SHOULD have been holding even when automation
  // couldn't fill. Polled on the slow tier (changes only on blocked
  // entries — a few per day at most).
  phantoms: DCPhantomPosition[];
  strategies: DCStrategyStats[];
  signals: DCSignalsResponse | null;
  risk: DCRiskStatus | null;
  brokerState: DCBrokerState | null;
  exitAlerts: DCExitAlert[];
  apiOnline: boolean;
  loading: boolean;
}

/** Browser Notification API permission state-check + request. Returns
 *  the user's current permission ("granted" / "denied" / "default").
 *  Idempotent — Notification.requestPermission() is a no-op when
 *  permission is already granted or denied. Caller should debounce so
 *  this doesn't fire on every render. */
async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission !== "default") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Fire a browser notification for a newly-detected exit alert. The
 *  permission request is best-effort: if the user has dismissed it
 *  permanently or the browser blocks the API, we silently no-op
 *  (the in-page Positions-tab badge still surfaces the alert
 *  visually, so this is purely an attention-amplifier for traders
 *  with the tab in the background). */
function fireExitAlertNotification(alert: DCExitAlert): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(`DC Exit: ${alert.strategy_name}`, {
      body: alert.exit_reason,
      tag: `dc-exit-${alert.id}`,  // dedup if user has multiple tabs
    });
  } catch {
    // Some browsers throw on certain platform setups; swallow.
  }
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
// Tighter fast-tier cadence when any visible strategy is in its
// T-60s pre-entry window. The 30s default produces only 1-2 fresh
// LIVE-badge readings per 60s window — makes "LIVE · 230ms" feel
// ironic. 5s during a window gives the operator ~12 fresh values
// before entry, comfortably within IBKR's rate limits at the
// gateway. Drops back to 30s as soon as no strategies are active.
const FAST_INTERVAL_PRE_ENTRY_MS = 5_000;
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
  const [phantoms, setPhantoms] = useState<DCPhantomPosition[]>([]);
  const [strategies, setStrategies] = useState<DCStrategyStats[]>([]);
  const [signals, setSignals] = useState<DCSignalsResponse | null>(null);
  const [risk, setRisk] = useState<DCRiskStatus | null>(null);
  const [brokerState, setBrokerState] = useState<DCBrokerState | null>(null);
  const [exitAlerts, setExitAlerts] = useState<DCExitAlert[]>([]);
  const [apiOnline, setApiOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  // Track the set of alert IDs we've already notified for so we
  // don't re-fire the browser notification on every poll cycle.
  // Keyed by alert.id (server-issued, monotonic). Cleared alerts
  // stay in this set; re-exits get a fresh id from the daemon.
  //
  // Per-instance: resets on dashboard unmount (e.g., hash route to
  // `#/` and back). On remount the server still surfaces alerts
  // cleared in the last ~5min — those re-arrive as `cleared_at !=
  // null` rows, which the fire-loop below skips, so no spurious
  // re-notify. Active alerts at remount time WILL re-notify
  // (treated as a refresher for an operator returning to the tab).
  //
  // Pruned on every fetch against the live `ea` payload so the set
  // doesn't grow unboundedly across a long-running tab (R2 caught
  // this — without pruning, a multi-day open dashboard accumulates
  // every alert id ever observed).
  const notifiedAlertIdsRef = useRef<Set<number>>(new Set());

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
      dcApi.exitAlerts(),    // [5]
    ]);
    const s = pickSettled(results[0] as PromiseSettledResult<DCSummary | null>);
    const p = pickSettled(results[1] as PromiseSettledResult<DCPosition[] | null>);
    const sig = pickSettled(results[2] as PromiseSettledResult<DCSignalsResponse | null>);
    const r = pickSettled(results[3] as PromiseSettledResult<DCRiskStatus | null>);
    const bs = pickSettled(results[4] as PromiseSettledResult<DCBrokerState | null>);
    const ea = pickSettled(results[5] as PromiseSettledResult<DCExitAlert[] | null>);

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

    // Exit alerts: detect newly-arrived alerts (id not in notified
    // set) and fire a browser notification for each. ACTIVE alerts
    // (cleared_at == null) only — a row that arrives already
    // cleared (e.g., user reloaded after the close completed) is
    // historical and shouldn't ping.
    if (ea) {
      setExitAlerts(ea);
      const seen = notifiedAlertIdsRef.current;
      // Prune ids that are no longer in the live payload — server
      // drops cleared alerts past the 5min window, so accumulating
      // their ids in `seen` is pure memory bloat. Bounded by alert
      // churn rate × 5min on the steady-state.
      const liveIds = new Set(ea.map((a) => a.id));
      for (const id of seen) {
        if (!liveIds.has(id)) seen.delete(id);
      }
      for (const alert of ea) {
        if (alert.cleared_at != null) continue;
        if (seen.has(alert.id)) continue;
        seen.add(alert.id);
        fireExitAlertNotification(alert);
      }
    }

    // Flip loading off as soon as fast tier returns — the slow tier
    // can arrive later without blocking the initial render.
    setLoading(false);
  }, []);

  // Slow tier. Independent timer from fast tier so a trades(100) round
  // trip doesn't delay the next summary/signals/brokerState refresh.
  // Phantoms ride this tier — blocked_order events fire at most a
  // handful of times per day on vol-spike sessions; 5min latency to
  // the dashboard is well inside the operator's awareness budget.
  const fetchSlow = useCallback(async () => {
    const results = await Promise.allSettled([
      dcApi.trades(100),   // [0]
      dcApi.strategies(),  // [1]
      dcApi.phantoms(30),  // [2]
    ]);
    const t = pickSettled(results[0] as PromiseSettledResult<DCTrade[] | null>);
    const st = pickSettled(results[1] as PromiseSettledResult<DCStrategyStats[] | null>);
    const ph = pickSettled(results[2] as PromiseSettledResult<DCPhantomPosition[] | null>);
    if (t) setTrades(t);
    if (st) setStrategies(st);
    if (ph) setPhantoms(ph);
  }, []);

  // Adaptive fast-tier cadence (Phase 4 follow-up). When any
  // strategy is in its pre-entry window, the daemon publishes live
  // S/L values that move tick-by-tick; the dashboard should pick
  // those up at a finer cadence than the 30s default so the LIVE
  // badge shows fresh values throughout the 60s window. As soon as
  // every window closes (next-entry > 60s away, or strategy
  // entered), cadence drops back to 30s.
  const hasActivePreEntryWindow = useMemo(() => {
    return (signals?.signals ?? []).some(
      (s) => s.pre_entry_window_active === true,
    );
  }, [signals]);

  // Mount-only seed + permission prompt. Separated from the
  // interval effect so a cadence-flip (re-creating the interval)
  // doesn't trigger an extra fetch.
  useEffect(() => {
    fetchFast();
    fetchSlow();
    void ensureNotificationPermission();
  }, [fetchFast, fetchSlow]);

  // Fast tier interval. Re-creates whenever the active-window flag
  // flips so cadence can switch between FAST_INTERVAL_MS and
  // FAST_INTERVAL_PRE_ENTRY_MS without unmount/remount churn.
  useEffect(() => {
    const interval = hasActivePreEntryWindow
      ? FAST_INTERVAL_PRE_ENTRY_MS
      : FAST_INTERVAL_MS;
    const fastId = setInterval(fetchFast, interval);
    return () => clearInterval(fastId);
  }, [fetchFast, hasActivePreEntryWindow]);

  // Slow tier interval (independent timer).
  useEffect(() => {
    const slowId = setInterval(fetchSlow, SLOW_INTERVAL_MS);
    return () => clearInterval(slowId);
  }, [fetchSlow]);

  return {
    summary, positions, trades, phantoms, strategies, signals, risk,
    brokerState, exitAlerts, apiOnline, loading,
  };
}
