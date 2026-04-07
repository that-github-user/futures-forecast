/**
 * DC Trading Dashboard API client.
 * Mirrors the existing api/client.ts pattern.
 */

import type {
  DCHealthResponse,
  DCPosition,
  DCRiskStatus,
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
  trades: (limit = 50, offset = 0) =>
    dcGet<DCTrade[]>(`/dc-api/v1/trades?limit=${limit}&offset=${offset}`),
  strategies: () => dcGet<DCStrategyStats[]>("/dc-api/v1/strategies"),
  strategySpecs: () => dcGet<DCStrategySpec[]>("/dc-api/v1/strategies/specs"),
  signals: () => dcGet<DCSignalsResponse>("/dc-api/v1/signals"),
  risk: () => dcGet<DCRiskStatus>("/dc-api/v1/risk"),
  summary: () => dcGet<DCSummary>("/dc-api/v1/summary"),
};
