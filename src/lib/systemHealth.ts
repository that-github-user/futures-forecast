/**
 * Aggregate health indicators for the DC dashboard's always-visible
 * System Health strip. Three independent signals:
 *
 *   1. IV source  — did any strategy's resolver fall back from `chain`
 *                   to `vix` or `default`? The 21/28 strike incident
 *                   (2026-04-21) was silent VIX-anchored resolution
 *                   producing mis-priced longs; the audit columns make
 *                   it visible per-row but the strip surfaces it tab-wide.
 *
 *   2. Broker     — broker_state sidecar freshness + any orphan legs or
 *                   conId collisions from groupBrokerLegs.
 *
 *   3. Drift      — max |debit_drift| across open positions. Same
 *                   thresholds as the Broker Δ column (see
 *                   DCPositionsTab DRIFT_WARN / DRIFT_ERROR).
 *
 * Pure functions — no React, no date.now() leaking through (caller
 * supplies `now`). This keeps the aggregation testable in a unit
 * environment and lets the strip avoid re-renders driven by
 * monotonically-advancing time.
 */

import type {
  DCBrokerState,
  DCPosition,
  DCSignalsResponse,
} from "../api/dcTypes";
import { groupBrokerLegs } from "./brokerGrouping";

export type HealthLevel = "ok" | "warn" | "error" | "unknown";

export interface IVSourceHealth {
  level: HealthLevel;
  chain: number;
  vix: number;
  default_: number;
  pending: number; // iv_source === null
  total: number;
}

export interface BrokerHealth {
  level: HealthLevel;
  ageSec: number | null; // null if no snapshot_at
  collisions: number;
  orphans: number;
}

export interface DriftHealth {
  level: HealthLevel;
  maxAbsDrift: number | null; // null if no position has drift set
  worstStrategy: string | null;
}

export interface SystemHealth {
  iv: IVSourceHealth;
  broker: BrokerHealth;
  drift: DriftHealth;
  overall: HealthLevel;
}

// Drift thresholds — kept in lockstep with DCPositionsTab.
export const DRIFT_WARN = 0.05;
export const DRIFT_ERROR = 0.15;
// Broker sidecar age thresholds (seconds). Amber at 10min, red at 30min.
// Cadence: scheduler writes the sidecar every 1min during RTH / every 5min
// off-hours, so >10min = two missed writes during RTH or sidecar job dead.
export const BROKER_AGE_WARN_SEC = 10 * 60;
export const BROKER_AGE_ERROR_SEC = 30 * 60;

export function computeIVHealth(signals: DCSignalsResponse | null): IVSourceHealth {
  const out: IVSourceHealth = {
    level: "unknown", chain: 0, vix: 0, default_: 0, pending: 0, total: 0,
  };
  if (!signals?.signals?.length) return out;
  for (const s of signals.signals) {
    out.total++;
    if (s.iv_source === "chain") out.chain++;
    else if (s.iv_source === "vix") out.vix++;
    else if (s.iv_source === "default") out.default_++;
    else out.pending++;
  }
  if (out.default_ > 0) out.level = "error";
  else if (out.vix > 0) out.level = "warn";
  else if (out.chain > 0) out.level = "ok";
  // All pending → level stays "unknown"
  return out;
}

export function computeBrokerHealth(
  brokerState: DCBrokerState | null,
  positions: DCPosition[],
  now: Date = new Date(),
): BrokerHealth {
  const out: BrokerHealth = {
    level: "unknown", ageSec: null, collisions: 0, orphans: 0,
  };
  if (!brokerState) return out;
  if (brokerState.snapshot_at) {
    const snap = new Date(brokerState.snapshot_at).getTime();
    if (!Number.isNaN(snap)) {
      out.ageSec = Math.max(0, Math.floor((now.getTime() - snap) / 1000));
    }
  }
  const { unmatched, collisions } = groupBrokerLegs(brokerState.positions, positions);
  out.orphans = unmatched.length;
  out.collisions = collisions.length;
  // Collisions always trump age — a conId claimed by two daemon rows is a
  // correctness concern, not just a freshness one.
  if (out.collisions > 0) { out.level = "error"; return out; }
  if (out.ageSec != null && out.ageSec > BROKER_AGE_ERROR_SEC) { out.level = "error"; return out; }
  if (out.ageSec != null && out.ageSec > BROKER_AGE_WARN_SEC) { out.level = "warn"; return out; }
  if (out.ageSec != null) { out.level = "ok"; return out; }
  return out; // snapshot_at missing → unknown
}

export function computeDriftHealth(positions: DCPosition[]): DriftHealth {
  const out: DriftHealth = { level: "unknown", maxAbsDrift: null, worstStrategy: null };
  let worstMag = -1;
  let worstName: string | null = null;
  for (const p of positions) {
    if (p.debit_drift == null) continue;
    const mag = Math.abs(p.debit_drift);
    if (mag > worstMag) { worstMag = mag; worstName = p.strategy_name; }
  }
  if (worstName == null) return out;
  out.maxAbsDrift = worstMag;
  out.worstStrategy = worstName;
  if (worstMag >= DRIFT_ERROR) out.level = "error";
  else if (worstMag >= DRIFT_WARN) out.level = "warn";
  else out.level = "ok";
  return out;
}

const LEVEL_RANK: Record<HealthLevel, number> = {
  unknown: 0,
  ok: 1,
  warn: 2,
  error: 3,
};

function worstLevel(...levels: HealthLevel[]): HealthLevel {
  let acc: HealthLevel = "unknown";
  for (const lv of levels) {
    if (LEVEL_RANK[lv] > LEVEL_RANK[acc]) acc = lv;
  }
  return acc;
}

export function computeSystemHealth(
  signals: DCSignalsResponse | null,
  brokerState: DCBrokerState | null,
  positions: DCPosition[],
  now: Date = new Date(),
): SystemHealth {
  const iv = computeIVHealth(signals);
  const broker = computeBrokerHealth(brokerState, positions, now);
  const drift = computeDriftHealth(positions);
  const overall = worstLevel(iv.level, broker.level, drift.level);
  return { iv, broker, drift, overall };
}
