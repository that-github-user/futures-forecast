/**
 * DC Trading Dashboard API client.
 * Mirrors the existing api/client.ts pattern.
 */

import type {
  DCBrokerState,
  DCCapitalSummary,
  DCExitAlert,
  DCGreekSnapshotsResponse,
  DCHealthResponse,
  DCPhantomPosition,
  DCPosition,
  DCRiskStatus,
  DCSignalEvent,
  DCSignalsResponse,
  DCStrategySpec,
  DCStrategyStats,
  DCSummary,
  DCTentBundleResponse,
  DCTentResponse,
  DCTrade,
} from "./dcTypes";
import { notifyUnauthorized } from "../hooks/useAuth";

const DC_BASE = import.meta.env.VITE_DC_API_URL || "";

async function dcGet<T>(path: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = {};
    // Auth is the HttpOnly session cookie only (set by terminal-api
    // /auth/login, scoped to .denoisedalpha.com so it rides to dc-api).
    // credentials:include sends it; no API key is bundled anymore (PR-3).
    const res = await fetch(`${DC_BASE}${path}`, {
      headers,
      credentials: "include",
    });
    if (!res.ok) {
      // 401 → session cookie gone/expired; re-lock so the operator is
      // sent to the lander.
      if (res.status === 401) notifyUnauthorized();
      return null;
    }
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
  // Phantom (would-have-entered) trades — rows the daemon recorded
  // when every signal-side gate cleared but the broker-fill phase
  // failed. The Tent tab surfaces these in a "missed entries" section
  // so operators see the play they SHOULD have been holding even when
  // automation couldn't fill. Default 30-day lookback.
  phantoms: (days = 30) =>
    dcGet<DCPhantomPosition[]>(`/dc-api/v1/phantoms?days=${days}`),
  strategies: () => dcGet<DCStrategyStats[]>("/dc-api/v1/strategies"),
  strategySpecs: () => dcGet<DCStrategySpec[]>("/dc-api/v1/strategies/specs"),
  signals: () => dcGet<DCSignalsResponse>("/dc-api/v1/signals"),
  risk: () => dcGet<DCRiskStatus>("/dc-api/v1/risk"),
  summary: () => dcGet<DCSummary>("/dc-api/v1/summary"),
  capitalSummary: () => dcGet<DCCapitalSummary>("/dc-api/v1/capital/summary"),
  // Tent-PnL endpoints (PR 4–6). `iv_source` defaults match the API:
  //   - position / phantom default to "latest" (overlays live-drift
  //     curve when greek_snapshots has rows for the UID)
  //   - trade default to "entry" (trade_history doesn't carry
  //     position_uid for the greek_snapshots join, so the API only
  //     accepts "entry" on this endpoint)
  positionTent: (
    positionUid: string,
    opts: { ivSource?: "entry" | "latest"; asOf?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.ivSource) params.set("iv_source", opts.ivSource);
    if (opts.asOf) params.set("as_of", opts.asOf);
    const qs = params.toString();
    return dcGet<DCTentResponse>(
      `/dc-api/v1/positions/${encodeURIComponent(positionUid)}/tent${qs ? `?${qs}` : ""}`,
    );
  },
  phantomTent: (
    positionUid: string,
    opts: { ivSource?: "entry" | "latest"; asOf?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.ivSource) params.set("iv_source", opts.ivSource);
    if (opts.asOf) params.set("as_of", opts.asOf);
    const qs = params.toString();
    return dcGet<DCTentResponse>(
      `/dc-api/v1/phantoms/${encodeURIComponent(positionUid)}/tent${qs ? `?${qs}` : ""}`,
    );
  },
  tradeTent: (tradeId: number, opts: { asOf?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.asOf) params.set("as_of", opts.asOf);
    const qs = params.toString();
    return dcGet<DCTentResponse>(
      `/dc-api/v1/trades/${tradeId}/tent${qs ? `?${qs}` : ""}`,
    );
  },
  // Bundled tent endpoints (PR #178 backend). Single roundtrip
  // returns all 4 curves; modal uses these instead of 4 separate
  // fetches. Per-curve endpoints above stay for back-compat /
  // ad-hoc inspection.
  positionTentBundle: (positionUid: string) =>
    dcGet<DCTentBundleResponse>(
      `/dc-api/v1/positions/${encodeURIComponent(positionUid)}/tent/bundle`,
    ),
  phantomTentBundle: (positionUid: string) =>
    dcGet<DCTentBundleResponse>(
      `/dc-api/v1/phantoms/${encodeURIComponent(positionUid)}/tent/bundle`,
    ),
  tradeTentBundle: (tradeId: number) =>
    dcGet<DCTentBundleResponse>(
      `/dc-api/v1/trades/${tradeId}/tent/bundle`,
    ),
  positionGreeks: (positionUid: string) =>
    dcGet<DCGreekSnapshotsResponse>(
      `/dc-api/v1/positions/${encodeURIComponent(positionUid)}/greeks`,
    ),
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
