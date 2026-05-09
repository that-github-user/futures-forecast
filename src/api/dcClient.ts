/**
 * DC Trading Dashboard API client.
 * Mirrors the existing api/client.ts pattern.
 */

import type {
  DCBrokerState,
  DCCapitalSummary,
  DCExitAlert,
  DCHealthResponse,
  DCPosition,
  DCRiskStatus,
  DCSignalEvent,
  DCSignalsResponse,
  DCStrategySpec,
  DCStrategyStats,
  DCSummary,
  DCTrade,
} from "./dcTypes";

const DC_BASE = import.meta.env.VITE_DC_API_URL || "";
const DC_KEY = import.meta.env.VITE_DC_API_KEY || "";

async function dcGet<T>(path: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = {};
    if (DC_KEY) headers["X-DC-Key"] = DC_KEY;

    const res = await fetch(`${DC_BASE}${path}`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const dcApi = {
  health: () => dcGet<DCHealthResponse>("/dc-api/v1/health"),
  positions: () => dcGet<DCPosition[]>("/dc-api/v1/positions"),
  exitAlerts: () => dcGet<DCExitAlert[]>("/dc-api/v1/exit-alerts"),
  brokerState: () => dcGet<DCBrokerState>("/dc-api/v1/broker-state"),
  trades: (limit = 50, offset = 0) =>
    dcGet<DCTrade[]>(`/dc-api/v1/trades?limit=${limit}&offset=${offset}`),
  strategies: () => dcGet<DCStrategyStats[]>("/dc-api/v1/strategies"),
  strategySpecs: () => dcGet<DCStrategySpec[]>("/dc-api/v1/strategies/specs"),
  signals: () => dcGet<DCSignalsResponse>("/dc-api/v1/signals"),
  risk: () => dcGet<DCRiskStatus>("/dc-api/v1/risk"),
  summary: () => dcGet<DCSummary>("/dc-api/v1/summary"),
  capitalSummary: () => dcGet<DCCapitalSummary>("/dc-api/v1/capital/summary"),
  signalEvents: (opts: {
    date?: string | null;  // YYYY-MM-DD, "all", or null/undefined for today
    strategy?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const params = new URLSearchParams();
    if (opts.date !== undefined && opts.date !== null) params.set("date", opts.date);
    if (opts.strategy) params.set("strategy", opts.strategy);
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return dcGet<DCSignalEvent[]>(`/dc-api/v1/signal-events${qs ? `?${qs}` : ""}`);
  },
};
